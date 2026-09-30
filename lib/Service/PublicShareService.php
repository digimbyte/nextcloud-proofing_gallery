<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Service;

use DateTime;
use InvalidArgumentException;
use OCA\ProofingGallery\Db\Gallery;
use OCA\ProofingGallery\Db\GalleryMapper;
use OCA\ProofingGallery\Dto\GallerySettings;
use OCA\ProofingGallery\Domain\GalleryStatus;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\AppFramework\Db\TTransactional;
use OCP\Constants;
use OCP\Share\IManager;
use OCP\Share\IShare;
use OCP\Share\Exceptions\ShareNotFound;
use OCP\IDBConnection;
use Throwable;
use OCA\ProofingGallery\BackgroundJob\RebuildMediaIndexJob;
use OCP\BackgroundJob\IJobList;
use OCA\ProofingGallery\BackgroundJob\WarmGalleryPreviewJob;

final class PublicShareService {
	use TTransactional;

	public function __construct(
		private IManager $shareManager,
		private GalleryMapper $galleries,
		private FolderService $folders,
		private MediaSummaryService $summaries,
		private CollectionService $collections,
		private ITimeFactory $clock,
		private CapabilityPolicyService $capabilities,
		private PrimaryPublicLinkSynchronizer $publicLinks,
		private IJobList $jobs,
		private GalleryReadinessService $readiness,
		private PreviewWarmService $previewWarm,
		private IDBConnection $db,
		private LifecycleScheduleService $lifecycleSchedule,
		private PublicLinkAnchorService $linkAnchors,
		private PublicShareRecoveryService $recovery,
	) {
	}

	public function publish(
		Gallery $gallery,
		?string $password,
		?string $expiresAt,
		string $downloadScope,
		bool $recoverMissingShare = false,
		?string &$recoveryResult = null,
	): Gallery {
		$recoveryResult = null;
		return $this->recovery->locked((int)$gallery->getId(), function () use ($gallery, $password, $expiresAt, $downloadScope, $recoverMissingShare, &$recoveryResult): Gallery {
			$current = $this->galleries->find((int)$gallery->getId());
			if ($current->getRevision() !== $gallery->getRevision()) throw new \OCA\ProofingGallery\Exception\GalleryConflictException('The gallery changed before it could be published');
			return $this->publishLocked($current, $password, $expiresAt, $downloadScope, $recoverMissingShare, $recoveryResult);
		});
	}

	private function publishLocked(Gallery $gallery, ?string $password, ?string $expiresAt, string $downloadScope, bool $recoverMissingShare, ?string &$recoveryResult): Gallery {
		$this->capabilities->assertCanPublish($gallery->getOwnerUid());
		$this->readiness->assertPublishable($gallery);
		if ($downloadScope !== 'none') $this->capabilities->assertFeature('downloads');
		if ($gallery->getStatus() === GalleryStatus::Archived->value) {
			throw new InvalidArgumentException('Archived galleries cannot be published');
		}
		if ($gallery->getSourceType() === 'collection' && $this->collections->availableItems($gallery) === []) {
			throw new InvalidArgumentException('A collection needs at least one available file before publishing');
		}

		$isNewShare = $gallery->getShareToken() === null;
		$previousToken = $gallery->getShareToken();
		$existingLink = $isNewShare ? null : $this->publicLinks->ensurePrimary($gallery);
		$eventAnchor = null;
		if ($gallery->getDeliveryMode() === 'event') {
			if (!$isNewShare) {
				$existingLink = $this->publicLinks->ensurePrimary($gallery);
				if ($existingLink?->getScopeAnchorId() !== null) {
					$eventAnchor = $this->linkAnchors->resolve($gallery->getOwnerUid(), $existingLink->getScopeAnchorId());
				}
			}
			if ($isNewShare) $eventAnchor ??= $this->linkAnchors->create($gallery->getOwnerUid());
		}
		$share = $this->createShare($gallery, $eventAnchor);
		if ($eventAnchor === null && $existingLink !== null && $existingLink->getStartPath() !== '') {
			$share->setNode($this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId())->get($existingLink->getStartPath()));
		}
		if (!$isNewShare) {
			try {
				$share = $this->recovery->resolve($gallery, $existingLink, (string)$previousToken, (int)$share->getNodeId());
			} catch (\OCA\ProofingGallery\Exception\PublicShareMissingException $exception) {
				if (!$recoverMissingShare) throw $exception;
				if ($password === null || $expiresAt === null) throw new InvalidArgumentException('Choose a replacement password or no password, and an expiry or no expiry');
				$isNewShare = true;
				if ($gallery->getDeliveryMode() === 'event' && $eventAnchor === null && $existingLink?->getScopeMode() === 'empty') {
					$eventAnchor = $this->linkAnchors->create($gallery->getOwnerUid());
				}
			}
		}
		if ($eventAnchor !== null) $share->setNode($eventAnchor);

		$share->setLabel($this->recovery->label($gallery, $existingLink?->getName() ?? 'Primary link'));
		$share->setPermissions(Constants::PERMISSION_READ);
		if (!in_array($downloadScope, ['none', 'individual', 'selection', 'all'], true)) {
			throw new InvalidArgumentException('Invalid download scope');
		}
		$share->setHideDownload(!in_array($downloadScope, ['individual', 'all'], true));
		if ($gallery->getShareToken() === null || $password !== null) {
			$share->setPassword($password === '' ? null : $password);
		}
		$share->setExpirationDate($this->expirationDate($expiresAt));

		$share = $isNewShare
			? ($previousToken === null ? $this->shareManager->createShare($share) : $this->recovery->create($share, $previousToken))
			: $this->shareManager->updateShare($share);

		$settings = GallerySettings::fromArray(json_decode($gallery->getSettings(), true, flags: JSON_THROW_ON_ERROR));
		$gallery->setSettings(json_encode(GallerySettings::merge($settings, [
			'delivery' => ['downloadScope' => $downloadScope],
		]), JSON_THROW_ON_ERROR));
		$gallery->setShareToken($share->getToken());
		$gallery->setStatus(GalleryStatus::Published->value);
		$gallery->setWorkflowState('live');
		$gallery->setPublishedAt($gallery->getPublishedAt() ?? $this->clock->getTime());
		$gallery->setRevokedAt(null);
		$gallery->setUpdatedAt($this->clock->getTime());
		$gallery->setRevision($gallery->getRevision() + 1);
		$this->lifecycleSchedule->project($gallery, $this->clock->getTime());

		try {
			$updated = $this->atomic(function () use ($gallery, $share, $eventAnchor): Gallery {
				$updated = $this->galleries->update($gallery);
				$this->publicLinks->ensurePrimary($updated, (int)$share->getId(), $eventAnchor?->getId());
				return $updated;
			}, $this->db);
		} catch (Throwable $exception) {
			$this->failClosedPublishShare($gallery, $share, $isNewShare);
			throw $exception;
		}
		if ($isNewShare && $previousToken !== null) $recoveryResult = $previousToken === $updated->getShareToken() ? 'restored' : 'replaced';
		try {
			$this->previewWarm->warm($updated);
		} catch (\Throwable) {
			// Publishing remains successful; the queued retry repairs derivatives.
		}
		$this->jobs->add(WarmGalleryPreviewJob::class, ['galleryId' => $updated->getId()]);
		return $updated;
	}

	private function failClosedPublishShare(Gallery $gallery, IShare $share, bool $isNewShare): void {
		if ($isNewShare) {
			try {
				$this->shareManager->deleteShare($share);
				return;
			} catch (Throwable) {
				// Fall through to permission removal and app-side registration so the
				// core share page cannot expose an orphaned token.
			}
		}
		try {
			$share->setPermissions(0);
			$this->shareManager->updateShare($share);
		} catch (Throwable) {
		}
		try {
			$link = $this->publicLinks->ensurePrimary($gallery, (int)$share->getId());
			$this->publicLinks->suspend($link);
		} catch (Throwable) {
			// Nothing more can be changed safely here. The original exception is
			// retained and health reconciliation can surface the orphaned share.
		}
	}

	public function revoke(Gallery $gallery): Gallery {
		return $this->recovery->locked((int)$gallery->getId(), fn (): Gallery => $this->revokeLocked($this->galleries->find((int)$gallery->getId())));
	}

	private function revokeLocked(Gallery $gallery): Gallery {
		foreach ($this->publicLinks->list($gallery) as $link) {
			if ($link->getStatus() !== 'active') continue;
			try {
				$this->recovery->revoke($gallery, $link);
			} catch (ShareNotFound) {
				// External deletion has already removed access; finish local revocation.
			}
			if ($link->getScopeAnchorId() !== null) {
				try {
					$this->linkAnchors->delete($this->linkAnchors->resolve($gallery->getOwnerUid(), $link->getScopeAnchorId()));
				} catch (\Throwable) {
					// The native share is already gone. Orphan reconciliation can remove
					// an anchor whose best-effort cleanup failed.
				}
				$link->setScopeAnchorId(null);
			}
			$this->publicLinks->markRevoked($link);
		}
		$gallery->setShareToken(null);
		$gallery->setStatus(GalleryStatus::Draft->value);
		$gallery->setRevokedAt($this->clock->getTime());
		$gallery->setUpdatedAt($this->clock->getTime());
		$gallery->setRevision($gallery->getRevision() + 1);
		$this->lifecycleSchedule->project($gallery, $this->clock->getTime());

		return $this->galleries->update($gallery);
	}

	/**
	 * Suspend app-managed link shares without changing their tokens or passwords.
	 * Native permissions are removed before the archived state is committed so
	 * WebDAV and the default Files Sharing page fail closed as well.
	 */
	public function archive(Gallery $gallery): Gallery {
		if ($gallery->getStatus() === GalleryStatus::Archived->value) return $gallery;
		$links = $this->publicLinks->list($gallery);
		/** @var list<array{share: IShare, permissions: int}> $changed */
		$changed = [];
		try {
			foreach ($links as $link) {
				if ($link->getStatus() !== 'active') continue;
				try {
					$share = $this->shareManager->getShareByToken($link->getToken());
				} catch (ShareNotFound) {
					// A missing native share is already inaccessible. Reconciliation can
					// surface it before a later restore attempt.
					continue;
				}
				$permissions = (int)$share->getPermissions();
				if ($permissions === 0) continue;
				$share->setPermissions(0);
				$this->shareManager->updateShare($share);
				$changed[] = ['share' => $share, 'permissions' => $permissions];
			}

			return $this->atomic(function () use ($gallery, $links): Gallery {
				foreach ($links as $link) $this->publicLinks->suspend($link);
				$now = $this->clock->getTime();
				$gallery->setStatus(GalleryStatus::Archived->value);
				$gallery->setArchivedAt($now);
				$gallery->setUpdatedAt($now);
				$gallery->setRevision($gallery->getRevision() + 1);
				$this->lifecycleSchedule->project($gallery, $now);
				return $this->galleries->update($gallery);
			}, $this->db);
		} catch (Throwable $exception) {
			$this->restorePermissions($changed);
			throw $exception;
		}
	}

	public function reconcileArchived(Gallery $gallery): int {
		if ($gallery->getStatus() !== GalleryStatus::Archived->value) return 0;
		$links = array_values(array_filter(
			$this->publicLinks->list($gallery),
			static fn ($link): bool => $link->getStatus() === 'active',
		));
		foreach ($links as $link) {
			try {
				$share = $this->shareManager->getShareByToken($link->getToken());
				if ((int)$share->getPermissions() !== 0) {
					$share->setPermissions(0);
					$this->shareManager->updateShare($share);
				}
			} catch (ShareNotFound) {
				// Missing native shares are already inaccessible and can be suspended.
			}
		}
		return $this->atomic(function () use ($links): int {
			foreach ($links as $link) $this->publicLinks->suspend($link);
			return count($links);
		}, $this->db);
	}

	/** Restore all suspended native shares before making app routes public. */
	public function restore(Gallery $gallery): Gallery {
		if ($gallery->getStatus() !== GalleryStatus::Archived->value) {
			throw new InvalidArgumentException('Only archived galleries can be restored');
		}
		$links = array_values(array_filter(
			$this->publicLinks->list($gallery),
			static fn ($link): bool => $link->getStatus() === 'suspended',
		));
		/** @var list<array{share: IShare, permissions: int}> $changed */
		$changed = [];
		try {
			foreach ($links as $link) {
				try {
					$share = $this->shareManager->getShareByToken($link->getToken());
				} catch (ShareNotFound $exception) {
					throw new InvalidArgumentException('A suspended native share is missing and must be repaired before restore', previous: $exception);
				}
				$permissions = (int)$share->getPermissions();
				if ($permissions !== Constants::PERMISSION_READ) {
					$share->setPermissions(Constants::PERMISSION_READ);
					$this->shareManager->updateShare($share);
					$changed[] = ['share' => $share, 'permissions' => $permissions];
				}
			}

			return $this->atomic(function () use ($gallery, $links): Gallery {
				foreach ($links as $link) $this->publicLinks->activate($link);
				$gallery->setStatus($links === [] ? GalleryStatus::Draft->value : GalleryStatus::Published->value);
				$gallery->setArchivedAt(null);
				$gallery->setUpdatedAt($this->clock->getTime());
				$gallery->setRevision($gallery->getRevision() + 1);
				$this->lifecycleSchedule->project($gallery, $this->clock->getTime());
				return $this->galleries->update($gallery);
			}, $this->db);
		} catch (Throwable $exception) {
			$this->restorePermissions($changed);
			throw $exception;
		}
	}

	/** @param list<array{share: IShare, permissions: int}> $changed */
	private function restorePermissions(array $changed): void {
		foreach (array_reverse($changed) as $snapshot) {
			try {
				$snapshot['share']->setPermissions($snapshot['permissions']);
				$this->shareManager->updateShare($snapshot['share']);
			} catch (Throwable) {
				// The original error remains authoritative. Health/reconciliation
				// reports any cross-store drift for an administrator to repair.
			}
		}
	}

	public function synchronizePrimaryNavigation(Gallery $gallery): void {
		$this->publicLinks->synchronizePrimaryNavigation($gallery);
		if ($gallery->getDeliveryMode() === 'event') {
			$this->publicLinks->synchronizeEventDownloadRestriction($gallery);
			return;
		}
		if ($gallery->getShareToken() === null) return;
		try {
			$share = $this->shareManager->getShareByToken($gallery->getShareToken());
			$settings = GallerySettings::fromArray(json_decode($gallery->getSettings(), true, flags: JSON_THROW_ON_ERROR));
			$share->setHideDownload(!$settings->delivery->downloadScope->allowsIndividual());
			$this->shareManager->updateShare($share);
		} catch (ShareNotFound) {
			// The public-link policy remains authoritative until the native share is
			// recreated or repaired by the normal publishing flow.
		}
	}

	/**
	 * Move the gallery and its native link share as one logical operation.
	 *
	 * The share is moved first so a published gallery never points at a folder
	 * different from its public token. If persisting the gallery fails, the
	 * original share node is restored best-effort before the error is rethrown.
	 */
	public function rebindSource(Gallery $gallery, int $folderId): Gallery {
		if ($gallery->getDeliveryMode() === 'event' && $gallery->getShareToken() !== null) {
			throw new InvalidArgumentException('Revoke event links before changing the source folder');
		}
		$newFolder = $this->folders->resolveFolder($gallery->getOwnerUid(), $folderId);
		$oldFolderId = $gallery->getFolderId();
		$share = null;
		$oldNode = null;

		if ($gallery->getShareToken() !== null) {
			$share = $this->shareManager->getShareByToken($gallery->getShareToken());
			try {
				$oldNode = $share->getNode();
			} catch (Throwable) {
				// A missing old source is the primary recovery use case.
			}
			$share->setNode($newFolder);
			$this->shareManager->updateShare($share);
		}

		try {
			$gallery->setFolderId($folderId);
			$gallery->setUpdatedAt($this->clock->getTime());
			$gallery->setRevision($gallery->getRevision() + 1);
			$this->lifecycleSchedule->project($gallery, $this->clock->getTime());
			$updated = $this->galleries->update($gallery);
			$this->summaries->invalidate($gallery->getId());
			$this->jobs->add(RebuildMediaIndexJob::class, ['galleryId' => $gallery->getId()]);
			return $updated;
		} catch (Throwable $exception) {
			$gallery->setFolderId($oldFolderId);
			if ($share !== null && $oldNode !== null) {
				try {
					$share->setNode($oldNode);
					$this->shareManager->updateShare($share);
				} catch (Throwable) {
					// Preserve the original persistence exception.
				}
			}
			throw $exception;
		}
	}

	private function createShare(Gallery $gallery, ?\OCP\Files\Folder $shareRoot = null): IShare {
		$share = $this->shareManager->newShare();
		$share->setShareType(IShare::TYPE_LINK);
		$share->setNode($shareRoot ?? $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId()));
		$share->setSharedBy($gallery->getOwnerUid());
		$share->setShareOwner($gallery->getOwnerUid());
		return $share;
	}

	private function expirationDate(?string $expiresAt): ?DateTime {
		if ($expiresAt === null || $expiresAt === '') {
			return null;
		}
		$date = DateTime::createFromFormat('!Y-m-d', $expiresAt);
		if ($date === false || $date->format('Y-m-d') !== $expiresAt) {
			throw new InvalidArgumentException('Expiration date must use YYYY-MM-DD');
		}
		return $date;
	}
}
