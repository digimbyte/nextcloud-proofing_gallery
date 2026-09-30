<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Controller;

use OCA\ProofingGallery\AppInfo\Application;
use OCA\ProofingGallery\Exception\AuthorizationException;
use OCA\ProofingGallery\Exception\GalleryConflictException;
use OCA\ProofingGallery\Exception\PolicyViolationException;
use OCA\ProofingGallery\Service\EventDeliveryService;
use OCA\ProofingGallery\Service\EventCsvPreview;
use OCA\ProofingGallery\Service\EventWaveService;
use OCA\ProofingGallery\Service\EventRecipientService;
use OCA\ProofingGallery\Service\EventSetupService;
use OCA\ProofingGallery\Service\EventWorkflowService;
use OCA\ProofingGallery\Service\GalleryService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\IRequest;
use OCP\IUserSession;

final class EventController extends Controller {
	public function __construct(IRequest $request, private GalleryService $galleries, private EventDeliveryService $events, private EventWaveService $waves, private EventCsvPreview $csvPreview, private EventRecipientService $recipients, private EventSetupService $setups, private EventWorkflowService $workflow, private IUserSession $userSession) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/galleries/{id}/event')]
	public function show(int $id): DataResponse { return $this->respond(fn () => [...$this->events->preview($this->gallery($id)), ...$this->events->list($this->gallery($id)), 'waves' => $this->waves->list($this->gallery($id))]); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/setup')]
	public function setup(int $id): DataResponse { return $this->respond(fn () => $this->setups->get($this->gallery($id))); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/design-media')]
	public function designMedia(int $id, string $scope = 'shared', string $query = '', int $limit = 60, int $offset = 0): DataResponse {
		return $this->respond(fn () => $this->setups->designMedia($this->gallery($id), $scope, $query, $limit, $offset));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/operations')]
	public function operations(int $id): DataResponse { return $this->respond(fn () => $this->waves->operations($this->gallery($id))); }

	/** @param array<string, mixed> $setup */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v2/galleries/{id}/event/setup')]
	public function saveSetup(int $id, array $setup, int $expectedRevision): DataResponse {
		try { return new DataResponse($this->setups->save($this->gallery($id), $setup, $expectedRevision)); }
		catch (GalleryConflictException $exception) { return new DataResponse(['code' => 'revision_conflict', 'message' => $exception->getMessage(), 'setup' => $this->setups->get($this->gallery($id))], Http::STATUS_CONFLICT); }
		catch (DoesNotExistException|AuthorizationException) { return new DataResponse(['message' => 'Gallery not found'], Http::STATUS_NOT_FOUND); }
		catch (\InvalidArgumentException|\OCP\Files\NotFoundException $exception) { return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY); }
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/deliver')]
	public function deliver(int $id, int $setupRevision, string $requestKey): DataResponse {
		try {
			$result = $this->workflow->deliver($this->gallery($id), $setupRevision, $requestKey);
			return new DataResponse(['gallery' => $this->galleries->present($this->userId(), $result['gallery']), 'wave' => $result['wave']], Http::STATUS_CREATED);
		} catch (GalleryConflictException $exception) {
			return new DataResponse(['code' => 'revision_conflict', 'message' => $exception->getMessage(), 'setup' => $this->setups->get($this->gallery($id))], Http::STATUS_CONFLICT);
		} catch (DoesNotExistException|AuthorizationException) { return new DataResponse(['message' => 'Gallery not found'], Http::STATUS_NOT_FOUND); }
		catch (PolicyViolationException $exception) { return new DataResponse(['code' => $exception->policyCode, 'message' => $exception->getMessage()], Http::STATUS_FORBIDDEN); }
		catch (\InvalidArgumentException|\OCP\Files\NotFoundException $exception) { return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY); }
	}

	/**
	 * @param list<string> $sharedRoots
	 * @param list<array<string, mixed>> $recipients
	 * @param array<string, mixed> $policy
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/event/waves')]
	public function createWave(int $id, array $sharedRoots = [], array $recipients = [], array $policy = [], ?string $expiresAt = null, ?string $releaseAt = null, bool $sendInvitations = false, bool $releaseNow = false): DataResponse {
		return $this->respond(fn () => $this->waves->create($this->gallery($id), $sharedRoots, $recipients, $policy, $expiresAt, $this->releaseTimestamp($releaseAt), $sendInvitations, $releaseNow), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/event/import-preview')]
	public function importPreview(int $id, string $csv, string $matchMode = 'exact'): DataResponse {
		return $this->respond(function () use ($id, $csv, $matchMode): array {
			$gallery = $this->gallery($id);
			return $this->csvPreview->preview($csv, $this->events->preview($gallery)['folders'], $matchMode);
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/event/waves/{waveId}/release')]
	public function releaseWave(int $id, int $waveId): DataResponse { return $this->respond(fn () => $this->waves->release($this->gallery($id), $waveId), Http::STATUS_ACCEPTED); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/waves/{waveId}/release')]
	public function releaseWorkflowWave(int $id, int $waveId): DataResponse {
		return $this->respond(function () use ($id, $waveId): array {
			$result = $this->workflow->release($this->gallery($id), $waveId);
			return ['gallery' => $this->galleries->present($this->userId(), $result['gallery']), 'wave' => $result['wave']];
		}, Http::STATUS_ACCEPTED);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/galleries/{id}/event/waves/{waveId}/schedule')]
	public function scheduleWave(int $id, int $waveId, string $releaseAt): DataResponse {
		return $this->respond(fn () => $this->waves->schedule($this->gallery($id), $waveId, $this->releaseTimestamp($releaseAt) ?? throw new \InvalidArgumentException('Release time is required')));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/event/waves/{waveId}/retry')]
	public function retryWave(int $id, int $waveId): DataResponse { return $this->respond(fn () => $this->waves->retry($this->gallery($id), $waveId), Http::STATUS_ACCEPTED); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/galleries/{id}/event/waves/{waveId}')]
	public function cancelWave(int $id, int $waveId): DataResponse { return $this->respond(fn () => $this->waves->cancel($this->gallery($id), $waveId)); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/galleries/{id}/event/waves/{waveId}/pin-export')]
	public function pinExport(int $id, int $waveId): DataDisplayResponse {
		try {
			return new DataDisplayResponse($this->waves->consumePinCsv($this->gallery($id), $waveId), Http::STATUS_OK, [
				'Content-Type' => 'text/csv; charset=utf-8',
				'Content-Disposition' => 'attachment; filename="event-pins-' . $waveId . '.csv"',
				'Cache-Control' => 'no-store',
			]);
		} catch (DoesNotExistException|AuthorizationException) { return new DataDisplayResponse('', Http::STATUS_NOT_FOUND); }
		catch (\InvalidArgumentException $exception) { return new DataDisplayResponse($exception->getMessage(), Http::STATUS_GONE, ['Content-Type' => 'text/plain; charset=utf-8', 'Cache-Control' => 'no-store']); }
	}

	/**
	 * @param list<string> $sharedRoots
	 * @param list<array<string, mixed>> $recipients
	 * @param array<string, mixed> $policy
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/event/recipients')]
	public function create(int $id, array $sharedRoots = [], array $recipients = [], array $policy = [], ?string $expiresAt = null): DataResponse {
		return $this->respond(fn () => $this->events->create($this->gallery($id), $sharedRoots, $recipients, $policy, $expiresAt), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/event/recipients/{recipientId}/invite')]
	public function invite(int $id, int $recipientId, string $message = ''): DataResponse { return $this->respond(fn () => $this->events->invite($this->gallery($id), $recipientId, $message)); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/recipients')]
	public function recipientPage(int $id, int $limit = 50, ?string $cursor = null, ?string $status = null, string $query = '', ?string $setupKey = null): DataResponse {
		return $this->respond(fn () => $this->recipients->page($this->gallery($id), $limit, $cursor, $status, $query, $setupKey));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/recipient-links')]
	public function recipientLinks(int $id, string $keys = ''): DataResponse {
		return $this->respond(fn () => $this->recipients->latestForSetupKeys($this->gallery($id), $keys === '' ? [] : explode(',', $keys)));
	}

	/** @param list<string> $groupRoots */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v2/galleries/{id}/event/recipients/{recipientId}')]
	public function editRecipient(int $id, int $recipientId, string $folderPath, array $groupRoots, string $name, string $email = '', ?string $locale = null, bool $recoverMissingShare = false, ?string $password = null, ?string $expiresAt = null): DataResponse {
		return $this->respond(fn () => $this->recipients->edit($this->gallery($id), $recipientId, $folderPath, $groupRoots, $name, $email, $locale, $this->userId(), $recoverMissingShare, $password, $expiresAt));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/recipients/{recipientId}/resend')]
	public function resendRecipient(int $id, int $recipientId, string $message = ''): DataResponse { return $this->respond(fn () => $this->recipients->resend($this->gallery($id), $recipientId, $message, $this->userId())); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/recipients/{recipientId}/rotate')]
	public function rotateRecipient(int $id, int $recipientId, string $mode): DataResponse { return $this->respond(fn () => $this->recipients->rotate($this->gallery($id), $recipientId, $mode, $this->userId())); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/recipients/{recipientId}/revoke')]
	public function revokeRecipient(int $id, int $recipientId): DataResponse { return $this->respond(fn () => $this->recipients->revoke($this->gallery($id), $recipientId, $this->userId())); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v2/galleries/{id}/event/recipients/{recipientId}')]
	public function deleteRecipient(int $id, int $recipientId): DataResponse { return $this->respond(function () use ($id, $recipientId): array { $this->recipients->delete($this->gallery($id), $recipientId, $this->userId()); return ['deleted' => true]; }); }

	/** @param list<int> $recipientIds */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/recipients/bulk')]
	public function bulkRecipients(int $id, array $recipientIds, string $action): DataResponse { return $this->respond(fn () => $this->recipients->bulk($this->gallery($id), $recipientIds, $action, $this->userId())); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/download-policy')]
	public function applyDownloadPolicy(int $id, string $downloadScope): DataResponse { return $this->respond(fn () => $this->recipients->applyDownloadPolicy($this->gallery($id), $downloadScope, $this->userId())); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v2/galleries/{id}/event/reconcile')]
	public function reconcile(int $id): DataResponse { return $this->respond(fn () => $this->recipients->reconcile($this->gallery($id), $this->userId())); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/audit')]
	public function audit(int $id, int $limit = 100): DataResponse { return $this->respond(fn () => ['items' => $this->recipients->audit($this->gallery($id), $limit)]); }

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v2/galleries/{id}/event/status-export')]
	public function statusExport(int $id): DataDisplayResponse {
		try {
			return new DataDisplayResponse($this->recipients->statusCsv($this->gallery($id), $this->userId()), Http::STATUS_OK, [
				'Content-Type' => 'text/csv; charset=utf-8', 'Content-Disposition' => 'attachment; filename="event-recipient-status.csv"', 'Cache-Control' => 'no-store',
			]);
		} catch (DoesNotExistException|AuthorizationException) { return new DataDisplayResponse('', Http::STATUS_NOT_FOUND); }
		catch (\InvalidArgumentException $exception) { return new DataDisplayResponse($exception->getMessage(), Http::STATUS_UNPROCESSABLE_ENTITY, ['Content-Type' => 'text/plain; charset=utf-8', 'Cache-Control' => 'no-store']); }
	}

	private function gallery(int $id): \OCA\ProofingGallery\Db\Gallery { return $this->galleries->get($this->userId(), $id); }

	private function userId(): string {
		$user = $this->userSession->getUser();
		if ($user === null) throw new AuthorizationException('Authentication required');
		return $user->getUID();
	}

	private function releaseTimestamp(?string $value): ?int {
		if ($value === null || trim($value) === '') return null;
		try { return (new \DateTimeImmutable($value))->getTimestamp(); }
		catch (\Throwable) { throw new \InvalidArgumentException('Invalid release time'); }
	}

	/** @param Http::STATUS_OK|Http::STATUS_CREATED|Http::STATUS_ACCEPTED $status */
	private function respond(callable $callback, int $status = Http::STATUS_OK): DataResponse {
		try { return new DataResponse($callback(), $status); }
		catch (\OCA\ProofingGallery\Exception\PublicShareMissingException $exception) { return new DataResponse(['code' => 'public_share_missing', 'message' => $exception->getMessage()], Http::STATUS_CONFLICT); }
		catch (GalleryConflictException $exception) { return new DataResponse(['code' => 'revision_conflict', 'message' => $exception->getMessage()], Http::STATUS_CONFLICT); }
		catch (DoesNotExistException|AuthorizationException) { return new DataResponse(['message' => 'Gallery not found'], Http::STATUS_NOT_FOUND); }
		catch (PolicyViolationException $exception) { return new DataResponse(['code' => $exception->policyCode, 'message' => $exception->getMessage()], Http::STATUS_FORBIDDEN); }
		catch (\OCP\HintException|\OCP\Share\Exceptions\GenericShareException $exception) {
			return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		} catch (\InvalidArgumentException|\OCP\Files\NotFoundException $exception) { return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY); }
	}
}
