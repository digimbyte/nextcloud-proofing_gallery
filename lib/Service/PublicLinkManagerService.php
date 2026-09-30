<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Service;

use DateTime;
use OCA\ProofingGallery\AppInfo\Application;
use OCA\ProofingGallery\Db\Gallery;
use OCA\ProofingGallery\Db\GalleryMapper;
use OCA\ProofingGallery\Db\CustomDomainRepository;
use OCA\ProofingGallery\Db\PublicLink;
use OCA\ProofingGallery\Db\PublicLinkMapper;
use OCA\ProofingGallery\Db\PublicLinkRootRepository;
use OCA\ProofingGallery\Domain\DownloadScope;
use OCA\ProofingGallery\Domain\PublicLinkPolicy;
use OCA\ProofingGallery\Dto\PublicLinkConfiguration;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Constants;
use OCP\Files\Folder;
use OCP\IURLGenerator;
use OCP\IDBConnection;
use OCP\Share\IManager;
use OCP\Share\IShare;
use OCP\Share\Exceptions\ShareNotFound;
use Psr\Log\LoggerInterface;

final class PublicLinkManagerService {
	use TTransactional;

	public function __construct(
		private PublicLinkMapper $links,
		private GalleryMapper $galleries,
		private PublicLinkPolicyService $policies,
		private PublicLinkScopeService $scopes,
		private PrimaryPublicLinkSynchronizer $primaryLinks,
		private FolderService $folders,
		private IManager $shareManager,
		private ITimeFactory $clock,
		private IURLGenerator $urls,
		private ShareAuditService $audit,
		private IDBConnection $db,
		private LoggerInterface $logger,
		private CustomDomainRepository $customDomains,
		private CapabilityPolicyService $capabilities,
		private GalleryReadinessService $readiness,
		private ReviewWorkflowService $reviews,
		private PublicLinkAnchorService $anchors,
		private PublicLinkRootRepository $rootRows,
		private PolicyService $instancePolicies,
		private PublicShareRecoveryService $recovery,
	) {
	}

	/** @return array{items: list<array<string, mixed>>, presets: array<string, array<string, bool|string>>} */
	public function list(Gallery $gallery): array {
		return [
			'items' => array_map(fn (PublicLink $link): array => $this->present($gallery, $link), $this->primaryLinks->list($gallery)),
			'presets' => $this->policies->presets(),
		];
	}

	/** @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	public function create(Gallery $gallery, PublicLinkConfiguration $config, bool $eventOperation = false, ?string $privateRoot = null, array $groupRoots = []): array {
		if ($gallery->getDeliveryMode() === 'event' && !$eventOperation) {
			throw new \InvalidArgumentException('Event links are managed by event delivery');
		}
		$this->assertLinkManagementAllowed($gallery, $config, true);
		if (!$eventOperation) $this->primaryLinks->assertBelowLimit($gallery);
		$config = $this->validateScope($gallery, $config);
		$anchor = $config->allowedRoots === [] ? null : $this->anchors->create($gallery->getOwnerUid());
		$share = $this->newShare($gallery);
		try {
			$this->applyShare($share, $gallery, $config, true, $anchor);
			$share = $this->shareManager->createShare($share);
		} catch (\Throwable $exception) {
			if ($anchor !== null) $this->deleteAnchor($anchor, $exception);
			throw $exception;
		}
		$now = $this->clock->getTime();
		$link = new PublicLink();
		$link->setGalleryId($gallery->getId());
		$link->setCoreShareId((int)$share->getId());
		$link->setScopeAnchorId($anchor?->getId());
		$link->setToken($share->getToken());
		$link->setName($config->name);
		$link->setStatus('active');
		$link->setIsPrimary(false);
		$link->setPolicy(json_encode($config->policy, JSON_THROW_ON_ERROR));
		$link->setStartPath($config->startPath);
		$link->setAllowedRootList($config->allowedRoots);
		$link->setScopeMode($config->allowedRoots === [] ? 'legacy' : 'nodes');
		$link->setViewMode($config->viewMode);
		$link->setGroupDepth($config->groupDepth);
		$link->setMinOwnerRating($config->minOwnerRating);
		$link->setPublicLocale($config->publicLocale);
		$link->setReviewEnabled($config->reviewEnabled);
		$link->setReviewDueDate($config->reviewEnabled ? $config->reviewDueDate : null);
		$link->setReviewSelectionMin($config->reviewEnabled ? $config->reviewSelectionMinimum : null);
		$link->setReviewSelectionMax($config->reviewEnabled ? $config->reviewSelectionMaximum : null);
		$link->setCreatedAt($now);
		$link->setUpdatedAt($now);
		try {
			$link = $this->links->insert($link);
			$this->rootRows->replace((int)$link->getId(), $this->stableRoots($gallery, $config->allowedRoots, $privateRoot, $groupRoots));
			$this->reviews->synchronize($gallery, $link);
			return $this->present($gallery, $link);
		} catch (\Throwable $exception) {
			try {
				$this->shareManager->deleteShare($share);
			} catch (\Throwable $compensation) {
				$this->logCompensationFailure('delete a newly created public share', $compensation, $exception);
			}
			if ($anchor !== null) $this->deleteAnchor($anchor, $exception);
			throw $exception;
		}
	}

	/** @return array<string, mixed> */
	public function update(Gallery $gallery, int $linkId, PublicLinkConfiguration $config, bool $recoverMissingShare = false): array {
		if ($gallery->getDeliveryMode() === 'event') throw new \InvalidArgumentException('Event links are managed by event delivery');
		return $this->updateInternal($gallery, $linkId, $config, recoverMissingShare: $recoverMissingShare);
	}

	/**
	 * Update an event-managed link while retaining its private-root classification.
	 * @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	public function updateEvent(Gallery $gallery, int $linkId, PublicLinkConfiguration $config, string $privateRoot, array $groupRoots = [], bool $recoverMissingShare = false): array {
		if ($gallery->getDeliveryMode() !== 'event') throw new \InvalidArgumentException('Event link operation requires an event project');
		return $this->updateInternal($gallery, $linkId, $config, $privateRoot, $groupRoots, $recoverMissingShare);
	}

	/**
	 * @param list<string> $allowedRoots
	 * @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	public function updateEventRecipient(Gallery $gallery, int $linkId, string $name, array $allowedRoots, string $privateRoot, ?string $locale, ?string $password = null, array $groupRoots = [], bool $recoverMissingShare = false, ?string $expiresAt = null): array {
		$link = $this->owned($gallery, $linkId);
		return $this->updateEvent($gallery, $linkId, $this->eventConfiguration($link, $name, $allowedRoots, $locale, $password, $recoverMissingShare, $expiresAt), $privateRoot, $groupRoots, $recoverMissingShare);
	}

	/** @return array{updated: int, skipped: int} */
	public function applyEventDownloadPolicy(Gallery $gallery, string $downloadScope): array {
		if ($gallery->getDeliveryMode() !== 'event') throw new \InvalidArgumentException('Download policy application requires an event project');
		$scope = DownloadScope::tryFrom($downloadScope);
		if ($scope === null) throw new \InvalidArgumentException('Invalid event download scope');
		if ($scope !== DownloadScope::None) $this->capabilities->assertFeature('downloads');
		$settings = \OCA\ProofingGallery\Dto\GallerySettings::fromArray(json_decode($gallery->getSettings(), true, flags: JSON_THROW_ON_ERROR));
		if ($settings->delivery->downloadScope->restrict($scope) !== $scope) {
			throw new \InvalidArgumentException('The active-link policy cannot exceed the gallery download policy');
		}
		$updated = 0; $skipped = 0;
		foreach ($this->links->findForGallery($gallery->getId()) as $link) {
			if ($link->getIsPrimary() || $link->getStatus() !== 'active') { $skipped++; continue; }
			$policy = PublicLinkPolicy::fromArray(json_decode($link->getPolicy(), true, flags: JSON_THROW_ON_ERROR))->jsonSerialize();
			$policy['downloadScope'] = $scope->value;
			$policy = $this->policies->validate($policy);
			$share = $this->shareManager->getShareByToken($link->getToken());
			$snapshot = $this->shareSnapshot($share);
			try {
				$share->setHideDownload(!$scope->allowsIndividual());
				$this->shareManager->updateShare($share);
				$link->setPolicy(json_encode($policy, JSON_THROW_ON_ERROR));
				$link->setUpdatedAt($this->clock->getTime());
				$this->links->update($link);
			} catch (\Throwable $exception) {
				$this->compensateShare($share, $snapshot, $exception);
				throw $exception;
			}
			$updated++;
		}
		return compact('updated', 'skipped');
	}

	/**
	 * Create an event replacement link. The caller switches its recipient reference before revoking the old link.
	 * @param list<string> $allowedRoots
	 * @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	public function createEventRecipientReplacement(Gallery $gallery, int $linkId, string $name, array $allowedRoots, string $privateRoot, ?string $locale, string $password, array $groupRoots = []): array {
		$old = $this->owned($gallery, $linkId);
		return $this->create($gallery, $this->eventConfiguration($old, $name, $allowedRoots, $locale, $password), true, $privateRoot, $groupRoots);
	}

	/** @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	private function updateInternal(Gallery $gallery, int $linkId, PublicLinkConfiguration $config, ?string $privateRoot = null, array $groupRoots = [], bool $recoverMissingShare = false): array {
		return $this->recovery->locked((int)$gallery->getId(), fn (): array => $this->updateLocked($this->galleries->find((int)$gallery->getId()), $linkId, $config, $privateRoot, $groupRoots, $recoverMissingShare));
	}

	/** @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	private function updateLocked(Gallery $gallery, int $linkId, PublicLinkConfiguration $config, ?string $privateRoot, array $groupRoots, bool $recoverMissingShare): array {
		$link = $this->owned($gallery, $linkId);
		$this->assertLinkManagementAllowed($gallery, $config, false);
		if (!$link->getIsPrimary()) $this->capabilities->assertFeature('multiplePublicLinks');
		if ($link->getStatus() !== 'active') throw new \InvalidArgumentException('Revoked links cannot be edited');
		$config = $this->validateScope($gallery, $config);
		$oldAnchor = $link->getScopeAnchorId() === null ? null : $this->anchors->resolve($gallery->getOwnerUid(), $link->getScopeAnchorId());
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId());
		$expectedNode = $oldAnchor ?? ($link->getStartPath() === '' ? $root : $root->get($link->getStartPath()));
		$previousToken = $link->getToken();
		$recreated = false;
		try {
			$share = $this->recovery->resolve($gallery, $link, $previousToken, (int)$expectedNode->getId());
		} catch (\OCA\ProofingGallery\Exception\PublicShareMissingException $exception) {
			if (!$recoverMissingShare) throw $exception;
			if ($config->password === null) throw new \InvalidArgumentException('Choose a replacement password or no password');
			$share = $this->newShare($gallery);
			$recreated = true;
		}
		$snapshot = $recreated ? null : $this->shareSnapshot($share);
		$newAnchor = $config->allowedRoots === [] ? null : ($oldAnchor ?? $this->anchors->create($gallery->getOwnerUid()));
		try {
			$this->applyShare($share, $gallery, $config, $recreated, $newAnchor);
			$share = $recreated ? $this->recovery->create($share, $previousToken) : $this->shareManager->updateShare($share);
		} catch (\Throwable $exception) {
			if ($oldAnchor === null && $newAnchor !== null) $this->deleteAnchor($newAnchor, $exception);
			throw $exception;
		}
		$link->setName($config->name);
		$link->setCoreShareId((int)$share->getId());
		$link->setToken($share->getToken());
		$link->setPolicy(json_encode($config->policy, JSON_THROW_ON_ERROR));
		$link->setStartPath($config->startPath);
		$link->setAllowedRootList($config->allowedRoots);
		$link->setScopeMode($config->allowedRoots === [] ? 'legacy' : 'nodes');
		$link->setScopeAnchorId($newAnchor?->getId());
		$link->setViewMode($config->viewMode);
		$link->setGroupDepth($config->groupDepth);
		$link->setMinOwnerRating($config->minOwnerRating);
		$link->setPublicLocale($config->publicLocale);
		$link->setReviewEnabled($config->reviewEnabled);
		$link->setReviewDueDate($config->reviewEnabled ? $config->reviewDueDate : null);
		$link->setReviewSelectionMin($config->reviewEnabled ? $config->reviewSelectionMinimum : null);
		$link->setReviewSelectionMax($config->reviewEnabled ? $config->reviewSelectionMaximum : null);
		$link->setUpdatedAt($this->clock->getTime());
		try {
			$link = $this->atomic(function () use ($gallery, $link, $config, $privateRoot, $groupRoots): PublicLink {
				$link = $this->links->update($link);
				$this->rootRows->replace((int)$link->getId(), $this->stableRoots($gallery, $config->allowedRoots, $privateRoot, $groupRoots));
				$this->reviews->synchronize($gallery, $link);
				if ($link->getIsPrimary()) {
					$gallery->setShareToken($link->getToken());
					$gallery->setUpdatedAt($this->clock->getTime());
					$gallery->setRevision($gallery->getRevision() + 1);
					$this->galleries->update($gallery);
				}
				return $link;
			}, $this->db);
		} catch (\Throwable $exception) {
			if ($recreated) {
				try { $this->shareManager->deleteShare($share); }
				catch (\Throwable $compensation) { $this->logCompensationFailure('delete a replacement public share', $compensation, $exception); }
			} elseif ($snapshot !== null) $this->compensateShare($share, $snapshot, $exception);
			if ($oldAnchor === null && $newAnchor !== null) $this->deleteAnchor($newAnchor, $exception);
			throw $exception;
		}
		if ($oldAnchor !== null && $newAnchor === null) $this->deleteAnchor($oldAnchor);
		return [...$this->present($gallery, $link), 'recovery' => $recreated ? ($link->getToken() === $previousToken ? 'restored' : 'replaced') : null];
	}

	/** @param list<string> $allowedRoots */
	private function eventConfiguration(PublicLink $link, string $name, array $allowedRoots, ?string $locale, ?string $password, bool $recoverMissingShare = false, ?string $expiresAt = null): PublicLinkConfiguration {
		$gallery = $this->galleries->find($link->getGalleryId());
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId());
		$node = $link->getScopeAnchorId() === null ? $root : $this->anchors->resolve($gallery->getOwnerUid(), $link->getScopeAnchorId());
		$share = null;
		try { $share = $this->recovery->resolve($gallery, $link, $link->getToken(), (int)$node->getId()); }
		catch (\OCA\ProofingGallery\Exception\PublicShareMissingException $exception) { if (!$recoverMissingShare) throw $exception; }
		if ($recoverMissingShare && ($password === null || $expiresAt === null)) throw new \InvalidArgumentException('Choose a replacement password or no password, and an expiry or no expiry');
		return PublicLinkConfiguration::fromArray([
			'name' => $name, 'policy' => json_decode($link->getPolicy(), true, flags: JSON_THROW_ON_ERROR),
			'startPath' => '', 'allowedRoots' => $allowedRoots, 'viewMode' => 'folder', 'groupDepth' => $link->getGroupDepth(),
			'minOwnerRating' => $link->getMinOwnerRating(), 'publicLocale' => $locale, 'password' => $password,
			'expiresAt' => $recoverMissingShare ? $expiresAt : $share?->getExpirationDate()?->format('Y-m-d'), 'reviewEnabled' => $link->getReviewEnabled(), 'reviewDueDate' => $link->getReviewDueDate(),
			'reviewSelectionMinimum' => $link->getReviewSelectionMin(), 'reviewSelectionMaximum' => $link->getReviewSelectionMax(),
		]);
	}

	/** @return array<string, mixed> */
	public function makePrimary(Gallery $gallery, int $linkId): array {
		if ($gallery->getDeliveryMode() === 'event') throw new \InvalidArgumentException('The event master link cannot be replaced');
		$this->capabilities->assertCanPublish($gallery->getOwnerUid());
		$this->capabilities->assertFeature('multiplePublicLinks');
		$link = $this->owned($gallery, $linkId);
		if ($link->getStatus() !== 'active') throw new \InvalidArgumentException('Only active links can be primary');
		$link = $this->atomic(function () use ($gallery, $link): PublicLink {
			$this->links->clearPrimary($gallery->getId());
			$link->setIsPrimary(true);
			$link->setUpdatedAt($this->clock->getTime());
			$link = $this->links->update($link);
			$gallery->setShareToken($link->getToken());
			$gallery->setUpdatedAt($this->clock->getTime());
			$gallery->setRevision($gallery->getRevision() + 1);
			$this->galleries->update($gallery);
			return $link;
		}, $this->db);
		return $this->present($gallery, $link);
	}

	/** @return array<string, mixed> */
	public function revoke(Gallery $gallery, int $linkId, string $actorUid): array {
		return $this->recovery->locked((int)$gallery->getId(), fn (): array => $this->revokeLocked($this->galleries->find((int)$gallery->getId()), $linkId, $actorUid));
	}

	/** @return array<string, mixed> */
	private function revokeLocked(Gallery $gallery, int $linkId, string $actorUid): array {
		$link = $this->owned($gallery, $linkId);
		if ($link->getIsPrimary()) throw new \InvalidArgumentException('Use the legacy revoke action for the primary link');
		if ($link->getStatus() === 'active') {
			try {
				$this->recovery->revoke($gallery, $link);
			} catch (ShareNotFound) {
				// An already absent native share is safe to finalize as revoked locally.
			}
			$this->audit->record($link, 'revoke', actorUid: $actorUid);
			$link->setStatus('revoked');
			if ($link->getScopeAnchorId() !== null) {
				$this->deleteAnchor($this->anchors->resolve($gallery->getOwnerUid(), $link->getScopeAnchorId()));
				$link->setScopeAnchorId(null);
			}
			$link->setRevokedAt($this->clock->getTime());
			$link->setUpdatedAt($this->clock->getTime());
			$link = $this->links->update($link);
		}
		return $this->present($gallery, $link);
	}

	/** @return array<string, mixed> */
	private function present(Gallery $gallery, PublicLink $link): array {
		$domain = $this->customDomains->activeLink((int)$link->getId());
		return [
			...$link->jsonSerialize(),
			'allowedRoots' => $this->scopes->roots($link),
			'url' => $domain !== null && $domain['status'] === 'verified'
				? 'https://' . $domain['domain'] . '/'
				: $this->urls->linkToRouteAbsolute('files_sharing.sharecontroller.showShare', ['token' => $link->getToken()]),
			'customDomain' => $domain === null ? null : [
				'id' => (int)$domain['id'], 'domain' => (string)$domain['domain'], 'status' => (string)$domain['status'],
				'verificationName' => '_proofing-gallery.' . $domain['domain'], 'verificationValue' => (string)$domain['verification_token'],
			],
			'review' => $this->reviews->publicState($gallery, $link),
			'scopeHealth' => $this->scopes->health($link),
		];
	}

	/** @param list<string> $sharedRoots */
	public function configureEventPrimary(Gallery $gallery, array $sharedRoots): void {
		if ($gallery->getDeliveryMode() !== 'event' || $gallery->getShareToken() === null) return;
		$link = $this->links->findPrimary((int)$gallery->getId());
		// New event projects use a deliberately empty technical base share. Existing
		// event links with a visible scope remain compatible and keep being updated.
		if ($link->getScopeMode() === 'empty' && $link->allowedRootList() === []) return;
		$config = $this->validateScope($gallery, PublicLinkConfiguration::fromArray([
			'name' => 'Primary link', 'policy' => $this->policies->presets()['presentation'],
			'allowedRoots' => $sharedRoots, 'startPath' => '', 'viewMode' => 'folder', 'groupDepth' => 1,
		]));
		$share = $this->shareManager->getShareByToken($link->getToken());
		$oldAnchor = $link->getScopeAnchorId() === null ? null : $this->anchors->resolve($gallery->getOwnerUid(), $link->getScopeAnchorId());
		$anchor = $oldAnchor ?? $this->anchors->create($gallery->getOwnerUid());
		$snapshot = $this->shareSnapshot($share);
		try {
			$share->setNode($anchor);
			$this->shareManager->updateShare($share);
			$link->setScopeAnchorId($anchor->getId());
			$link->setStartPath('');
			$link->setAllowedRootList($config->allowedRoots);
			$link->setScopeMode($config->allowedRoots === [] ? 'empty' : 'nodes');
			$link->setViewMode('folder');
			$link->setGroupDepth(1);
			$link->setUpdatedAt($this->clock->getTime());
			$this->links->update($link);
			$this->rootRows->replace((int)$link->getId(), $this->stableRoots($gallery, $config->allowedRoots));
		} catch (\Throwable $exception) {
			$this->compensateShare($share, $snapshot, $exception);
			if ($oldAnchor === null) $this->deleteAnchor($anchor, $exception);
			throw $exception;
		}
	}

	public function assertEventCapacity(Gallery $gallery, int $additional, int $reserved = 0): void {
		if ($additional < 1 || $this->links->countUsableForGallery((int)$gallery->getId()) + $reserved + $additional > $this->instancePolicies->get('maxEventPublicLinks')) {
			throw new \InvalidArgumentException('The event does not have enough public link capacity');
		}
	}

	public function eventCapacity(Gallery $gallery): int {
		if ($gallery->getDeliveryMode() !== 'event') return 0;
		return max(0, $this->instancePolicies->get('maxEventPublicLinks') - $this->links->countUsableForGallery((int)$gallery->getId()));
	}

	/**
	 * @param list<string> $paths
	 * @param list<string> $groupRoots
	 * @return list<array{folder: Folder, path: string, role: string}>
	 */
	private function stableRoots(Gallery $gallery, array $paths, ?string $privateRoot = null, array $groupRoots = []): array {
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId());
		$result = [];
		foreach ($paths as $path) {
			$node = $root->get($path);
			if (!$node instanceof Folder || !$root->isSubNode($node)) throw new \InvalidArgumentException('Allowed event folder not found');
			$role = $path === $privateRoot ? 'private' : (in_array($path, $groupRoots, true) ? 'group' : 'shared');
			$result[] = ['folder' => $node, 'path' => $path, 'role' => $role];
		}
		return $result;
	}

	private function owned(Gallery $gallery, int $linkId): PublicLink {
		try { $link = $this->links->find($linkId); } catch (DoesNotExistException) { throw new \InvalidArgumentException('Public link not found'); }
		if ($link->getGalleryId() !== $gallery->getId()) throw new \InvalidArgumentException('Public link not found');
		return $link;
	}

	private function validateScope(Gallery $gallery, PublicLinkConfiguration $config): PublicLinkConfiguration {
		$startPath = $this->scopes->normalize($config->startPath);
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId());
		$allowedRoots = [];
		foreach ($config->allowedRoots as $candidate) {
			$path = $this->scopes->normalize($candidate);
			if ($path === '') throw new \InvalidArgumentException('Event delivery roots cannot expose the gallery root');
			$node = $root->get($path);
			if (!$node instanceof Folder || !$root->isSubNode($node)) throw new \InvalidArgumentException('Allowed event folder not found');
			$allowedRoots[] = $path;
		}
		$allowedRoots = array_values(array_unique($allowedRoots));
		foreach ($allowedRoots as $index => $candidate) {
			foreach (array_slice($allowedRoots, $index + 1) as $other) {
				if (str_starts_with($candidate . '/', $other . '/') || str_starts_with($other . '/', $candidate . '/')) {
					throw new \InvalidArgumentException('Allowed event folders cannot contain one another');
				}
			}
		}
		if ($allowedRoots !== [] && $config->viewMode !== 'folder') throw new \InvalidArgumentException('Multi-folder links use folder view');
		if ($startPath !== '') {
			$node = $root->get($startPath);
			if (!$node instanceof Folder || !$root->isSubNode($node)) throw new \InvalidArgumentException('Public link start folder not found');
		}
		return $config->withScope($allowedRoots === [] ? $startPath : '', $allowedRoots);
	}

	private function assertLinkManagementAllowed(Gallery $gallery, PublicLinkConfiguration $config, bool $creating): void {
		$this->capabilities->assertCanPublish($gallery->getOwnerUid());
		if ($creating) $this->capabilities->assertFeature('multiplePublicLinks');
		if ($config->viewMode === 'recursive') $this->capabilities->assertFeature('recursiveGalleries');
		if ($gallery->getStatus() !== \OCA\ProofingGallery\Domain\GalleryStatus::Published->value
			|| $gallery->getArchivedAt() !== null) {
			throw new \InvalidArgumentException('Only published galleries can manage active public links');
		}
		$this->readiness->assertPublishable($gallery);
	}

	private function newShare(Gallery $gallery): IShare {
		$share = $this->shareManager->newShare();
		$share->setShareType(IShare::TYPE_LINK);
		$share->setNode($this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId()));
		$share->setSharedBy($gallery->getOwnerUid());
		$share->setShareOwner($gallery->getOwnerUid());
		return $share;
	}

	private function applyShare(IShare $share, Gallery $gallery, PublicLinkConfiguration $config, bool $creating, ?Folder $anchor = null): void {
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId());
		if ($config->allowedRoots !== [] && $anchor === null) throw new \LogicException('Multi-folder links require a native share anchor');
		$share->setNode($config->allowedRoots !== [] ? $anchor : ($config->startPath === '' ? $root : $root->get($config->startPath)));
		$share->setLabel($this->recovery->label($gallery, $config->name));
		$share->setPermissions(Constants::PERMISSION_READ);
		$share->setHideDownload(!$config->policy->downloadScope->allowsIndividual());
		if ($creating || $config->password !== null) $share->setPassword($config->password === '' ? null : $config->password);
		$share->setExpirationDate($config->expiresAt);
	}

	/** @return array{node: \OCP\Files\Node, label: string, permissions: int, hideDownload: bool, password: ?string, expiration: ?DateTime} */
	private function shareSnapshot(IShare $share): array {
		return [
			'node' => $share->getNode(),
			'label' => (string)$share->getLabel(),
			'permissions' => (int)$share->getPermissions(),
			'hideDownload' => $share->getHideDownload(),
			'password' => $share->getPassword(),
			'expiration' => $share->getExpirationDate(),
		];
	}

	/** @param array{node: \OCP\Files\Node, label: string, permissions: int, hideDownload: bool, password: ?string, expiration: ?DateTime} $snapshot */
	private function compensateShare(IShare $share, array $snapshot, \Throwable $original): void {
		try {
			$share->setNode($snapshot['node']);
			$share->setLabel($snapshot['label']);
			$share->setPermissions($snapshot['permissions']);
			$share->setHideDownload($snapshot['hideDownload']);
			$share->setPassword($snapshot['password']);
			$share->setExpirationDate($snapshot['expiration']);
			$this->shareManager->updateShare($share);
		} catch (\Throwable $compensation) {
			$this->logCompensationFailure('restore a public share', $compensation, $original);
		}
	}

	private function logCompensationFailure(string $action, \Throwable $compensation, \Throwable $original): void {
		$this->logger->error('Failed to ' . $action . ' after app persistence failed', [
			'app' => Application::APP_ID,
			'exception' => $compensation,
			'originalException' => $original,
		]);
	}

	private function deleteAnchor(Folder $anchor, ?\Throwable $original = null): void {
		try {
			$this->anchors->delete($anchor);
		} catch (\Throwable $exception) {
			$this->logger->error('Failed to delete an unused public link anchor', [
				'app' => Application::APP_ID,
				'exception' => $exception,
				'originalException' => $original,
			]);
		}
	}
}
