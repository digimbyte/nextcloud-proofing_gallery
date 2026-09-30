<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Service;

use OCA\ProofingGallery\Db\EventAuditRepository;
use OCA\ProofingGallery\Db\EventWaveRepository;
use OCA\ProofingGallery\Db\Gallery;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\Folder;
use OCP\Security\ICrypto;

final class EventRecipientService {
	public function __construct(
		private EventWaveRepository $repository,
		private EventAuditRepository $audit,
		private FolderService $folders,
		private PublicLinkManagerService $links,
		private EventDeliveryService $deliveries,
		private ScopedCursorCodec $cursors,
		private CsvEncoder $csv,
		private ITimeFactory $clock,
		private ICrypto $crypto,
	) {
	}

	/** @return array{items: list<array<string, mixed>>, total: int, nextCursor: ?string, health: array<string, int>} */
	public function page(Gallery $gallery, int $limit = 50, ?string $cursor = null, ?string $status = null, string $query = '', ?string $setupKey = null): array {
		$this->assertEvent($gallery);
		$query = mb_substr(trim($query), 0, 120);
		$setupKey = $setupKey === null || trim($setupKey) === '' ? null : trim($setupKey);
		if ($setupKey !== null && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $setupKey) !== 1) throw new \InvalidArgumentException('Invalid recipient setup key');
		$status = $status === null || trim($status) === '' ? null : trim($status);
		if ($status !== null && !in_array($status, ['draft', 'published', 'invited', 'failed', 'revoked'], true)) throw new \InvalidArgumentException('Invalid recipient status filter');
		$scope = 'event-recipients:' . $gallery->getId() . ':' . ($status ?? '') . ':' . ($setupKey ?? '') . ':' . hash('sha256', $query);
		$page = $this->repository->recipientPage((int)$gallery->getId(), $limit, $this->cursors->decode($cursor, $scope), $status, $query, $setupKey);
		$linkMap = $this->linkMap($gallery);
		$items = array_map(fn (array $row): array => $this->present($gallery, $row, $linkMap), $page['items']);
		$health = ['healthy' => 0, 'degraded' => 0, 'revoked' => 0, 'unpublished' => 0];
		foreach ($items as $item) $health[$item['health']]++;
		return ['items' => $items, 'total' => $page['total'], 'nextCursor' => $page['nextId'] === null ? null : $this->cursors->encode($scope, $page['nextId']), 'health' => $health];
	}

	/** @param list<string> $setupKeys
	 * @return array{items: list<array<string, mixed>>}
	 */
	public function latestForSetupKeys(Gallery $gallery, array $setupKeys): array {
		$this->assertEvent($gallery);
		$setupKeys = array_values(array_unique(array_filter($setupKeys, static fn (mixed $key): bool => is_string($key) && preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key) === 1)));
		if (count($setupKeys) > 50) throw new \InvalidArgumentException('At most 50 recipient setup keys may be requested');
		$linkMap = $this->linkMap($gallery);
		return ['items' => array_map(fn (array $row): array => $this->present($gallery, $row, $linkMap), $this->repository->latestRecipientsForSetupKeys((int)$gallery->getId(), $setupKeys))];
	}

	/**
	 * @param list<string> $groupRoots
	 * @return array<string, mixed>
	 */
	public function edit(Gallery $gallery, int $recipientId, string $folderPath, array $groupRoots, string $name, string $email, ?string $locale, string $actorUid, bool $recoverMissingShare = false, ?string $password = null, ?string $expiresAt = null): array {
		$row = $this->recipient($gallery, $recipientId);
		if ($row['wave_id'] === null || in_array($row['publication_status'], ['revoked'], true)) throw new \InvalidArgumentException('This recipient can no longer be edited');
		try {
			$recovery = null;
			$prepared = $this->prepare($gallery, (int)$row['wave_id'], $folderPath, $groupRoots, $name, $email, $locale);
			if ($row['public_link_id'] !== null) {
				$updatedLink = $this->links->updateEventRecipient($gallery, (int)$row['public_link_id'], $prepared['name'], [...$prepared['sharedRoots'], ...array_column($prepared['groupRoots'], 'path'), $prepared['folderPath']], $prepared['folderPath'], $prepared['locale'], $password, groupRoots: array_column($prepared['groupRoots'], 'path'), recoverMissingShare: $recoverMissingShare, expiresAt: $expiresAt);
				$recovery = $updatedLink['recovery'] ?? null;
			}
			$this->repository->updateRecipient((int)$row['wave_id'], $recipientId, $prepared['folderId'], $prepared['folderPath'], $prepared['groupRoots'], $prepared['name'], $prepared['emailCipher'], $prepared['locale'], $this->clock->getTime());
			$this->record($gallery, $row, $actorUid, 'recipient_edit', 'success');
			return [...$this->present($gallery, $this->recipient($gallery, $recipientId), $this->linkMap($gallery)), 'recovery' => $recovery];
		} catch (\Throwable $exception) {
			$this->record($gallery, $row, $actorUid, 'recipient_edit', 'failed', 'operation_failed');
			throw $exception;
		}
	}

	/** @return array<string, mixed> */
	public function resend(Gallery $gallery, int $recipientId, string $message, string $actorUid): array {
		$row = $this->recipient($gallery, $recipientId);
		try {
			$this->deliveries->invite($gallery, $recipientId, $message);
			$this->record($gallery, $row, $actorUid, 'recipient_invite', 'success');
			return $this->present($gallery, $this->recipient($gallery, $recipientId), $this->linkMap($gallery));
		} catch (\Throwable $exception) {
			$this->record($gallery, $row, $actorUid, 'recipient_invite', 'failed', 'delivery_failed');
			throw $exception;
		}
	}

	/**
	 * Rotate either the PIN in place or both link and PIN.
	 * @return array{recipient: array<string, mixed>, pin: string}
	 */
	public function rotate(Gallery $gallery, int $recipientId, string $mode, string $actorUid): array {
		if (!in_array($mode, ['pin', 'link'], true)) throw new \InvalidArgumentException('Invalid rotation mode');
		$row = $this->recipient($gallery, $recipientId);
		if ($row['public_link_id'] === null || in_array($row['publication_status'], ['revoked'], true)) throw new \InvalidArgumentException('Recipient link is unavailable');
		$pin = $this->strongPin();
		try {
			$roots = $this->recipientRoots($gallery, $row);
			if ($mode === 'pin') {
				$link = $this->links->updateEventRecipient($gallery, (int)$row['public_link_id'], (string)$row['display_name'], $roots['all'], $roots['private'], is_string($row['locale']) ? $row['locale'] : null, $pin, $roots['groups']);
			} else {
				$oldLinkId = (int)$row['public_link_id'];
				$link = $this->links->createEventRecipientReplacement($gallery, $oldLinkId, (string)$row['display_name'], $roots['all'], $roots['private'], is_string($row['locale']) ? $row['locale'] : null, $pin, $roots['groups']);
				try {
					$this->repository->replaceLink($recipientId, (int)$link['id'], $this->clock->getTime());
					$this->links->revoke($gallery, $oldLinkId, $actorUid);
				} catch (\Throwable $exception) {
					$this->repository->replaceLink($recipientId, $oldLinkId, $this->clock->getTime());
					try { $this->links->revoke($gallery, (int)$link['id'], $actorUid); } catch (\Throwable) {}
					throw $exception;
				}
			}
			$this->record($gallery, $row, $actorUid, $mode === 'pin' ? 'recipient_pin_rotate' : 'recipient_link_rotate', 'success', null, (int)$link['id']);
			return ['recipient' => $this->present($gallery, $this->recipient($gallery, $recipientId), $this->linkMap($gallery)), 'pin' => $pin];
		} catch (\Throwable $exception) {
			$this->record($gallery, $row, $actorUid, $mode === 'pin' ? 'recipient_pin_rotate' : 'recipient_link_rotate', 'failed', 'rotation_failed');
			throw $exception;
		}
	}

	/** @return array<string, mixed> */
	public function revoke(Gallery $gallery, int $recipientId, string $actorUid): array {
		$row = $this->recipient($gallery, $recipientId);
		try {
			if ($row['public_link_id'] !== null) $this->links->revoke($gallery, (int)$row['public_link_id'], $actorUid);
			$this->repository->revokeRecipient($recipientId, $this->clock->getTime());
			$this->record($gallery, $row, $actorUid, 'recipient_revoke', 'success');
			return $this->present($gallery, $this->recipient($gallery, $recipientId), $this->linkMap($gallery));
		} catch (\Throwable $exception) {
			$this->record($gallery, $row, $actorUid, 'recipient_revoke', 'failed', 'revoke_failed');
			throw $exception;
		}
	}

	public function delete(Gallery $gallery, int $recipientId, string $actorUid): void {
		$row = $this->recipient($gallery, $recipientId);
		try {
			if ($row['public_link_id'] !== null) $this->links->revoke($gallery, (int)$row['public_link_id'], $actorUid);
			$this->record($gallery, $row, $actorUid, 'recipient_delete', 'success');
			$this->repository->deleteRecipient($recipientId);
		} catch (\Throwable $exception) {
			$this->record($gallery, $row, $actorUid, 'recipient_delete', 'failed', 'delete_failed');
			throw $exception;
		}
	}

	/**
	 * @param list<int> $recipientIds
	 * @return array{processed: int, failed: int, results: list<array{id: int, status: string, errorCode: ?string}>}
	 */
	public function bulk(Gallery $gallery, array $recipientIds, string $action, string $actorUid): array {
		if (!in_array($action, ['resend', 'revoke', 'delete'], true) || $recipientIds === [] || count($recipientIds) > 100) throw new \InvalidArgumentException('Select between 1 and 100 recipients and a supported bulk action');
		$results = []; $processed = 0; $failed = 0;
		foreach (array_values(array_unique(array_map('intval', $recipientIds))) as $id) {
			try {
				if ($action === 'resend') $this->resend($gallery, $id, '', $actorUid);
				elseif ($action === 'revoke') $this->revoke($gallery, $id, $actorUid);
				else $this->delete($gallery, $id, $actorUid);
				$processed++; $results[] = ['id' => $id, 'status' => 'success', 'errorCode' => null];
			} catch (\Throwable) { $failed++; $results[] = ['id' => $id, 'status' => 'failed', 'errorCode' => 'operation_failed']; }
		}
		return compact('processed', 'failed', 'results');
	}

	/** @return array{updated: int, skipped: int} */
	public function applyDownloadPolicy(Gallery $gallery, string $downloadScope, string $actorUid): array {
		$this->assertEvent($gallery);
		try {
			$result = $this->links->applyEventDownloadPolicy($gallery, $downloadScope);
			$this->audit->record((int)$gallery->getId(), null, null, $actorUid, 'download_policy_apply', 'success', null, $this->clock->getTime());
			return $result;
		} catch (\Throwable $exception) {
			$this->audit->record((int)$gallery->getId(), null, null, $actorUid, 'download_policy_apply', 'failed', 'operation_failed', $this->clock->getTime());
			throw $exception;
		}
	}

	public function statusCsv(Gallery $gallery, string $actorUid): string {
		$this->assertEvent($gallery);
		$rows = [['Recipient ID', 'Name', 'Email', 'Private folder', 'Groups', 'Status', 'Invitation', 'Health', 'Error', 'Updated at']];
		$linkMap = $this->linkMap($gallery);
		$after = null;
		do {
			$page = $this->repository->recipientPage((int)$gallery->getId(), 100, $after, null, '');
			foreach ($page['items'] as $row) {
				$item = $this->present($gallery, $row, $linkMap);
				$rows[] = [strval($item['id']), $item['name'], $item['email'] ?? '', $item['folderPath'], implode('|', $item['groupRoots']), $item['status'], $item['invitationStatus'], $item['health'], $item['errorCode'] ?? '', gmdate(DATE_ATOM, (int)$row['updated_at'])];
			}
			$after = $page['nextId'];
		} while ($after !== null);
		$this->audit->record((int)$gallery->getId(), null, null, $actorUid, 'recipient_export', 'success', null, $this->clock->getTime());
		return $this->csv->encode($rows);
	}

	/** @return array{changed: int, healthy: int, degraded: int} */
	public function reconcile(Gallery $gallery, string $actorUid): array {
		$this->assertEvent($gallery);
		$linkMap = $this->linkMap($gallery);
		$changed = 0; $healthy = 0; $degraded = 0; $after = null;
		do {
			$page = $this->repository->recipientPage((int)$gallery->getId(), 100, $after, null, '');
			foreach ($page['items'] as $row) {
				if ($row['public_link_id'] === null) continue;
				$link = $linkMap[(int)$row['public_link_id']] ?? null;
				if ($link === null || $link['status'] !== 'active') {
					$degraded++;
					if ($row['publication_status'] !== 'revoked') { $this->repository->reconcileRecipient((int)$row['id'], 'revoked', 'revoked', 'link_unavailable', $this->clock->getTime()); $changed++; }
				} elseif (($link['scopeHealth']['state'] ?? 'degraded') !== 'healthy') {
					$degraded++;
					if ($row['error_code'] !== 'scope_unavailable') { $this->repository->reconcileRecipient((int)$row['id'], 'failed', 'failed', 'scope_unavailable', $this->clock->getTime()); $changed++; }
				} else { $healthy++; }
			}
			$after = $page['nextId'];
		} while ($after !== null);
		$this->audit->record((int)$gallery->getId(), null, null, $actorUid, 'recipient_reconcile', 'success', null, $this->clock->getTime());
		return compact('changed', 'healthy', 'degraded');
	}

	/** @return list<array<string, mixed>> */
	public function audit(Gallery $gallery, int $limit = 100): array {
		$this->assertEvent($gallery);
		return array_map(static fn (array $row): array => [
			'recipientId' => $row['recipient_id'] === null ? null : (int)$row['recipient_id'], 'publicLinkId' => $row['public_link_id'] === null ? null : (int)$row['public_link_id'],
			'actorUid' => (string)$row['actor_uid'], 'action' => (string)$row['action'], 'outcome' => (string)$row['outcome'],
			'reasonCode' => $row['reason_code'] === null ? null : (string)$row['reason_code'], 'createdAt' => (int)$row['created_at'],
		], $this->audit->gallery((int)$gallery->getId(), $limit));
	}

	/** @return array<string, mixed> */
	private function recipient(Gallery $gallery, int $recipientId): array {
		$this->assertEvent($gallery);
		$row = $this->repository->recipient((int)$gallery->getId(), $recipientId);
		if ($row === false) throw new \InvalidArgumentException('Event recipient not found');
		return $row;
	}

	/**
	 * @param list<string> $groupPaths
	 * @return array{folderId: int, folderPath: string, groupRoots: list<array{folderId: int, path: string, name: string}>, sharedRoots: list<string>, name: string, emailCipher: ?string, locale: ?string}
	 */
	private function prepare(Gallery $gallery, int $waveId, string $folderPath, array $groupPaths, string $name, string $email, ?string $locale): array {
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId());
		$folderPath = $this->folder($root, $folderPath)['path']; $name = trim($name); $email = mb_strtolower(trim($email));
		if ($name === '' || mb_strlen($name) > 120) throw new \InvalidArgumentException('Recipient name is invalid');
		if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) throw new \InvalidArgumentException('Recipient email address is invalid');
		if ($locale !== null && !in_array($locale, ['de', 'en'], true)) throw new \InvalidArgumentException('Recipient locale is invalid');
		$private = $this->folder($root, $folderPath); $groups = [];
		foreach (array_values(array_unique($groupPaths)) as $path) { $folder = $this->folder($root, $path); $groups[] = ['folderId' => $folder['folderId'], 'path' => $folder['path'], 'name' => mb_substr($folder['name'], 0, 120)]; }
		$shared = $this->resolvedRoots($gallery, $waveId, null, 'shared');
		if (in_array($folderPath, $shared, true) || in_array($folderPath, array_column($groups, 'path'), true) || array_intersect($shared, array_column($groups, 'path')) !== []) throw new \InvalidArgumentException('Shared, group, and private folders must be distinct');
		return ['folderId' => $private['folderId'], 'folderPath' => $folderPath, 'groupRoots' => $groups, 'sharedRoots' => $shared, 'name' => $name, 'emailCipher' => $email === '' ? null : $this->crypto->encrypt($email), 'locale' => $locale];
	}

	/** @return array{folderId: int, path: string, name: string} */
	private function folder(Folder $root, string $path): array {
		$path = trim($path, '/');
		if ($path === '' || str_contains($path, "\0") || in_array('..', explode('/', $path), true)) throw new \InvalidArgumentException('Invalid event folder path');
		$node = $root->get($path);
		if (!$node instanceof Folder || !$root->isSubNode($node)) throw new \InvalidArgumentException('Event folder not found');
		return ['folderId' => (int)$node->getId(), 'path' => $path, 'name' => $node->getName()];
	}

	/**
	 * @param array<string, mixed> $row
	 * @return array{all: list<string>, private: string, groups: list<string>}
	 */
	private function recipientRoots(Gallery $gallery, array $row): array {
		if ($row['wave_id'] === null) {
			$private = $this->resolvedFolder($gallery, $row);
			$link = $row['public_link_id'] === null ? null : ($this->linkMap($gallery)[(int)$row['public_link_id']] ?? null);
			if ($private['state'] !== 'readable' || $link === null || !is_array($link['allowedRoots'] ?? null)) throw new \InvalidArgumentException('Recipient scope is unavailable');
			return ['all' => array_values(array_filter($link['allowedRoots'], 'is_string')), 'private' => $private['path'], 'groups' => []];
		}
		$waveId = (int)$row['wave_id']; $recipientId = (int)$row['id'];
		$private = $this->resolvedRoots($gallery, $waveId, $recipientId, 'private')[0] ?? throw new \InvalidArgumentException('Private event folder is unavailable');
		$groups = $this->resolvedRoots($gallery, $waveId, $recipientId, 'group');
		return ['all' => [...$this->resolvedRoots($gallery, $waveId, null, 'shared'), ...$groups, $private], 'private' => $private, 'groups' => $groups];
	}

	/** @return list<string> */
	private function resolvedRoots(Gallery $gallery, int $waveId, ?int $recipientId, string $role): array {
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId()); $prefix = rtrim($root->getPath(), '/') . '/'; $result = [];
		foreach ($this->repository->roots($waveId, $recipientId, $role) as $reference) {
			$node = null;
			foreach ($root->getById((int)$reference['folder_id']) as $candidate) if ($candidate instanceof Folder && $root->isSubNode($candidate)) { $node = $candidate; break; }
			if ($node === null) throw new \InvalidArgumentException('Referenced event folder is unavailable');
			$result[] = substr($node->getPath(), strlen($prefix));
		}
		return $result;
	}

	/**
	 * @param array<string, mixed> $row
	 * @param array<int, array<string, mixed>> $links
	 * @return array<string, mixed>
	 */
	private function present(Gallery $gallery, array $row, array $links): array {
		$link = $row['public_link_id'] === null ? null : ($links[(int)$row['public_link_id']] ?? null);
		$folder = $this->resolvedFolder($gallery, $row);
		$health = $link === null ? ($row['public_link_id'] === null ? 'unpublished' : 'degraded') : ($link['status'] === 'active' && ($link['scopeHealth']['state'] ?? '') === 'healthy' ? 'healthy' : ($link['status'] === 'revoked' ? 'revoked' : 'degraded'));
		return ['id' => (int)$row['id'], 'setupKey' => is_string($row['setup_key'] ?? null) ? $row['setup_key'] : null, 'folderPath' => $folder['path'], 'folderState' => $folder['state'], 'groupRoots' => is_string($row['group_roots'] ?? null) ? json_decode($row['group_roots'], true, flags: JSON_THROW_ON_ERROR) : [],
			'name' => (string)$row['display_name'], 'email' => $row['email_cipher'] === null ? null : $this->crypto->decrypt((string)$row['email_cipher']), 'locale' => $row['locale'],
			'status' => (string)$row['delivery_status'], 'publicationStatus' => (string)$row['publication_status'], 'invitationStatus' => (string)$row['invitation_status'],
			'invitedAt' => $row['invited_at'] === null ? null : (int)$row['invited_at'], 'waveId' => $row['wave_id'] === null ? null : (int)$row['wave_id'], 'errorCode' => $row['error_code'], 'attempts' => (int)$row['attempts'], 'link' => $link, 'health' => $health,
			'allowedActions' => $this->actions($row, $link), 'updatedAt' => (int)$row['updated_at']];
	}

	/**
	 * @param array<string, mixed> $row
	 * @return array{path: string, state: 'readable'|'missing'}
	 */
	private function resolvedFolder(Gallery $gallery, array $row): array {
		$root = $this->folders->resolveFolder($gallery->getOwnerUid(), $gallery->getFolderId()); $prefix = rtrim($root->getPath(), '/') . '/';
		foreach ($root->getById((int)$row['folder_id']) as $node) if ($node instanceof Folder && $root->isSubNode($node)) return ['path' => substr($node->getPath(), strlen($prefix)), 'state' => 'readable'];
		return ['path' => (string)$row['folder_path'], 'state' => 'missing'];
	}

	/**
	 * @param array<string, mixed> $row
	 * @param ?array<string, mixed> $link
	 * @return list<string>
	 */
	private function actions(array $row, ?array $link): array {
		if ($row['publication_status'] === 'revoked') return ['delete'];
		if ($link === null) return ['edit', 'delete'];
		$actions = ['edit', 'rotate_pin', 'rotate_link', 'revoke', 'delete'];
		if ($row['email_cipher'] !== null) $actions[] = 'resend';
		return $actions;
	}

	/** @return array<int, array<string, mixed>> */
	private function linkMap(Gallery $gallery): array { $result = []; foreach ($this->links->list($gallery)['items'] as $link) $result[(int)$link['id']] = $link; return $result; }
	/** @param array<string, mixed> $row */
	private function record(Gallery $gallery, array $row, string $actor, string $action, string $outcome, ?string $reason = null, ?int $linkId = null): void { $this->audit->record((int)$gallery->getId(), (int)$row['id'], $linkId ?? ($row['public_link_id'] === null ? null : (int)$row['public_link_id']), $actor, $action, $outcome, $reason, $this->clock->getTime()); }
	private function strongPin(): string { return 'Aa2!' . rtrim(strtr(base64_encode(random_bytes(12)), '+/', '-_'), '='); }
	private function assertEvent(Gallery $gallery): void { if ($gallery->getDeliveryMode() !== 'event') throw new \InvalidArgumentException('Event recipients are only available for event projects'); }
}
