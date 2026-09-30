<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Controller;

use InvalidArgumentException;
use OCA\ProofingGallery\AppInfo\Application;
use OCA\ProofingGallery\Exception\AuthorizationException;
use OCA\ProofingGallery\Exception\GalleryConflictException;
use OCA\ProofingGallery\Exception\PolicyViolationException;
use OCA\ProofingGallery\Exception\GalleryNotReadyException;
use OCA\ProofingGallery\Service\CapabilityPolicyService;
use OCA\ProofingGallery\Dto\GallerySettings;
use OCA\ProofingGallery\Service\GalleryService;
use OCA\ProofingGallery\Service\InvitationService;
use OCA\ProofingGallery\Service\PublicShareService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Share\Exceptions\ShareNotFound;

final class ShareController extends Controller {
	public function __construct(
		IRequest $request,
		private GalleryService $galleries,
		private PublicShareService $shares,
		private InvitationService $invitations,
		private IUserSession $userSession,
		private IURLGenerator $urlGenerator,
		private CapabilityPolicyService $capabilities,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/invite')]
	public function invite(int $id, string $recipient, string $message = ''): DataResponse {
		try {
			$this->capabilities->assertFeature('emailInvitations');
			$this->invitations->send($this->galleries->get($this->userId(), $id), $recipient, $message);
			return new DataResponse([], Http::STATUS_ACCEPTED);
		} catch (PolicyViolationException $exception) {
			return new DataResponse(['code' => $exception->policyCode, 'message' => $exception->getMessage()], Http::STATUS_FORBIDDEN);
		} catch (DoesNotExistException|AuthorizationException) {
			return new DataResponse(['message' => 'Gallery not found'], Http::STATUS_NOT_FOUND);
		} catch (InvalidArgumentException $exception) {
			return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/galleries/{id}/publish')]
	public function publish(
		int $id,
		?string $password = null,
		?string $expiresAt = null,
		?string $downloadScope = null,
		?bool $allowDownloads = null,
		?int $expectedRevision = null,
		bool $recoverMissingShare = false,
	): DataResponse {
		try {
			$userId = $this->userId();
			$gallery = $this->galleries->get($userId, $id);
			if ($expectedRevision !== null && $gallery->getRevision() !== $expectedRevision) {
				throw new GalleryConflictException('The gallery changed before it could be published');
			}
			$currentSettings = GallerySettings::fromArray(json_decode($gallery->getSettings(), true, flags: JSON_THROW_ON_ERROR));
			$scope = $downloadScope
				?? ($allowDownloads === null ? $currentSettings->delivery->downloadScope->value : ($allowDownloads ? 'all' : 'none'));
			$recovery = null;
			$gallery = $this->shares->publish($gallery, $password, $expiresAt, $scope, $recoverMissingShare, $recovery);
			return new DataResponse([
				'gallery' => $this->galleries->present($userId, $gallery),
				'recovery' => $recovery,
				'url' => $this->urlGenerator->linkToRouteAbsolute('files_sharing.sharecontroller.showShare', [
					'token' => $gallery->getShareToken(),
				]),
			]);
		} catch (\OCA\ProofingGallery\Exception\PublicShareMissingException $exception) {
			return new DataResponse(['code' => 'public_share_missing', 'message' => $exception->getMessage()], Http::STATUS_CONFLICT);
		} catch (GalleryConflictException $exception) {
			$userId = $this->userId();
			return new DataResponse([
				'code' => 'revision_conflict',
				'message' => $exception->getMessage(),
				'gallery' => $this->galleries->present($userId, $this->galleries->view($userId, $id)),
			], Http::STATUS_CONFLICT);
		} catch (PolicyViolationException $exception) {
			return new DataResponse(['code' => $exception->policyCode, 'message' => $exception->getMessage()], Http::STATUS_FORBIDDEN);
		} catch (GalleryNotReadyException $exception) {
			return new DataResponse([
				'code' => 'gallery_not_ready',
				'message' => $exception->getMessage(),
				...$exception->report,
			], Http::STATUS_UNPROCESSABLE_ENTITY);
		} catch (DoesNotExistException|ShareNotFound|AuthorizationException) {
			return new DataResponse(['message' => 'Gallery or share not found'], Http::STATUS_NOT_FOUND);
		} catch (\OCP\HintException|\OCP\Share\Exceptions\GenericShareException $exception) {
			return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		} catch (InvalidArgumentException $exception) {
			return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/galleries/{id}/publish')]
	public function revoke(int $id): DataResponse {
		try {
			$userId = $this->userId();
			return new DataResponse($this->galleries->present(
				$userId,
				$this->shares->revoke($this->galleries->get($userId, $id)),
			));
		} catch (DoesNotExistException|ShareNotFound|AuthorizationException) {
			return new DataResponse(['message' => 'Gallery or share not found'], Http::STATUS_NOT_FOUND);
		} catch (GalleryConflictException $exception) {
			return new DataResponse(['code' => 'revision_conflict', 'message' => $exception->getMessage()], Http::STATUS_CONFLICT);
		} catch (\OCP\HintException|\OCP\Share\Exceptions\GenericShareException $exception) {
			return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		} catch (InvalidArgumentException $exception) {
			return new DataResponse(['message' => $exception->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}

	private function userId(): string {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new \RuntimeException('Authenticated user required');
		}
		return $user->getUID();
	}
}
