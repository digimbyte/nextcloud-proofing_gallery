<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Tests\Unit\Service;

use OCA\ProofingGallery\Db\Gallery;
use OCA\ProofingGallery\Db\PublicLink;
use OCA\ProofingGallery\Exception\GalleryConflictException;
use OCA\ProofingGallery\Exception\PolicyViolationException;
use OCA\ProofingGallery\Exception\PublicShareMissingException;
use OCA\ProofingGallery\Service\PublicShareRecoveryService;
use OCP\DB\IResult;
use OCP\DB\QueryBuilder\IExpressionBuilder;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use OCP\IUserManager;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use OCP\Share\IManager;
use OCP\Share\IShare;
use PHPUnit\Framework\TestCase;

final class PublicShareRecoveryServiceTest extends TestCase {
	private function database(mixed $nativeId): IDBConnection {
		$result = $this->createMock(IResult::class);
		$result->method('fetchOne')->willReturn($nativeId);
		$qb = $this->createMock(IQueryBuilder::class);
		foreach (['select', 'from', 'where', 'setMaxResults'] as $method) $qb->method($method)->willReturnSelf();
		$qb->method('expr')->willReturn($this->createMock(IExpressionBuilder::class));
		$qb->method('executeQuery')->willReturn($result);
		$db = $this->createMock(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		return $db;
	}

	private function manager(): IManager {
		$manager = $this->createMock(IManager::class);
		$manager->method('shareApiEnabled')->willReturn(true);
		$manager->method('shareApiAllowLinks')->willReturn(true);
		return $manager;
	}

	private function service(IManager $manager, mixed $id = false, ?ILockingProvider $locks = null): PublicShareRecoveryService {
		$users = $this->createMock(IUserManager::class);
		$users->method('get')->willReturn($this->createMock(\OCP\IUser::class));
		return new PublicShareRecoveryService($manager, $this->database($id), $locks ?? $this->createMock(ILockingProvider::class), $users);
	}

	private function gallery(): Gallery {
		$gallery = new Gallery(); $gallery->setId(3); $gallery->setOwnerUid('owner');
		return $gallery;
	}

	private function link(): PublicLink {
		$link = new PublicLink(); $link->setCoreShareId(7); $link->setToken('old-key');
		return $link;
	}

	public function testMissingNativeRecordOffersRecoveryWithoutCreatingAnything(): void {
		$manager = $this->manager();
		$manager->expects(self::never())->method('createShare');
		$this->expectException(PublicShareMissingException::class);
		$this->service($manager)->resolve($this->gallery(), $this->link(), 'old-key', 9);
	}

	public function testDisabledSharingIsNotMissing(): void {
		$manager = $this->createMock(IManager::class);
		$manager->expects(self::never())->method('createShare');
		$this->expectException(PolicyViolationException::class);
		$this->service($manager)->resolve($this->gallery(), $this->link(), 'old-key', 9);
	}

	public function testExistingShareRetainsNativeValidityChecks(): void {
		$manager = $this->manager(); $share = $this->matchingShare();
		$manager->expects(self::once())->method('getShareById')->with('ocinternal:7', null, false)->willReturn($share);
		$manager->expects(self::once())->method('getShareByToken')->with('old-key')->willReturn($share);
		self::assertSame($share, $this->service($manager, 7)->resolve($this->gallery(), $this->link(), 'old-key', 9));
	}

	private function matchingShare(bool $expired = false, string $owner = 'owner', string $sharedBy = 'owner'): IShare {
		$share = $this->createMock(IShare::class);
		$share->method('getShareType')->willReturn(IShare::TYPE_LINK);
		$share->method('getShareOwner')->willReturn($owner);
		$share->method('getSharedBy')->willReturn($sharedBy);
		$share->method('getToken')->willReturn('old-key');
		$share->method('getNodeId')->willReturn(9);
		$share->method('isExpired')->willReturn($expired);
		return $share;
	}

	public function testExpiredShareIsNotRecreatedOrDeletedByLookup(): void {
		$manager = $this->manager();
		$manager->method('getShareById')->willReturn($this->matchingShare(true));
		$manager->expects(self::never())->method('getShareByToken');
		$manager->expects(self::never())->method('createShare');
		$this->expectException(\InvalidArgumentException::class);
		$this->service($manager, 7)->resolve($this->gallery(), $this->link(), 'old-key', 9);
	}

	public function testMismatchedOwnerIsNotRecreated(): void {
		$manager = $this->manager(); $share = $this->matchingShare(sharedBy: 'other');
		$manager->method('getShareById')->willReturn($share);
		$manager->expects(self::never())->method('createShare');
		$this->expectException(\InvalidArgumentException::class);
		$this->service($manager, 7)->resolve($this->gallery(), $this->link(), 'old-key', 9);
	}

	public function testExistingReshareKeepsTheGallerySharersOwnershipBoundary(): void {
		$manager = $this->manager(); $share = $this->matchingShare(owner: 'source-owner');
		$manager->method('getShareById')->willReturn($share);
		$manager->method('getShareByToken')->willReturn($share);
		self::assertSame($share, $this->service($manager, 7)->resolve($this->gallery(), $this->link(), 'old-key', 9));
	}

	public function testRevokeRejectsADifferentSharer(): void {
		$manager = $this->manager(); $share = $this->matchingShare(sharedBy: 'other');
		$manager->method('getShareById')->willReturn($share);
		$manager->expects(self::never())->method('deleteShare');
		$this->expectException(\InvalidArgumentException::class);
		$this->service($manager, 7)->revoke($this->gallery(), $this->link());
	}

	public function testRevokeAlreadyDeletedShareSucceedsWithoutCreatingOne(): void {
		$manager = $this->manager();
		$manager->expects(self::never())->method('createShare'); $manager->expects(self::never())->method('deleteShare');
		$this->service($manager)->revoke($this->gallery(), $this->link());
	}

	public function testRequiredExpiryRejectsExplicitNoExpiryBeforeCreatingShare(): void {
		$manager = $this->manager();
		$manager->method('shareApiLinkDefaultExpireDateEnforced')->willReturn(true);
		$manager->expects(self::never())->method('createShare');
		$this->expectException(\InvalidArgumentException::class);
		$this->service($manager)->create($this->matchingShare(), 'old-key');
	}

	public function testRecoveryExplicitlyOptsOutOfOptionalDefaultExpiry(): void {
		$manager = $this->manager(); $share = $this->matchingShare();
		$share->expects(self::once())->method('setNoExpirationDate')->with(true);
		$manager->expects(self::once())->method('createShare')->with($share)->willReturn($share);
		self::assertSame($share, $this->service($manager)->create($share, 'old-key'));
	}

	public function testAvailableTokenIsRestoredThroughNativeUpdate(): void {
		$manager = $this->manager(); $share = $this->matchingShare();
		$manager->method('allowCustomTokens')->willReturn(true);
		$manager->method('createShare')->willReturn($share);
		$share->expects(self::once())->method('setToken')->with('old-key');
		$manager->expects(self::once())->method('updateShare')->with($share)->willReturn($share);
		self::assertSame($share, $this->service($manager)->create($share, 'old-key'));
	}

	public function testClaimedTokenKeepsGeneratedReplacement(): void {
		$manager = $this->manager(); $share = $this->matchingShare();
		$manager->method('allowCustomTokens')->willReturn(true); $manager->method('createShare')->willReturn($share);
		$share->expects(self::never())->method('setToken'); $manager->expects(self::never())->method('updateShare');
		self::assertSame($share, $this->service($manager, 88)->create($share, 'old-key'));
	}

	public function testDisabledCustomTokensKeepGeneratedReplacement(): void {
		$manager = $this->manager(); $share = $this->matchingShare(); $manager->method('createShare')->willReturn($share);
		$share->expects(self::never())->method('setToken');
		self::assertSame($share, $this->service($manager)->create($share, 'old-key'));
	}

	public function testFailedRestorationRemovesReplacement(): void {
		$manager = $this->manager(); $share = $this->matchingShare();
		$manager->method('allowCustomTokens')->willReturn(true); $manager->method('createShare')->willReturn($share);
		$manager->method('updateShare')->willThrowException(new \RuntimeException('storage failure'));
		$manager->expects(self::once())->method('deleteShare')->with($share);
		$this->expectException(\RuntimeException::class);
		$this->service($manager)->create($share, 'old-key');
	}

	public function testConcurrentRecoveryCannotEnterCriticalSection(): void {
		$locks = $this->createMock(ILockingProvider::class);
		$locks->method('acquireLock')->willThrowException(new LockedException('share'));
		$this->expectException(GalleryConflictException::class);
		$this->service($this->manager(), locks: $locks)->locked(3, static function (): never { self::fail('Concurrent callback ran'); });
	}

	public function testFailureReleasesRecoveryLock(): void {
		$locks = $this->createMock(ILockingProvider::class);
		$locks->expects(self::once())->method('releaseLock')->with('proofing-gallery:public-shares:3', ILockingProvider::LOCK_EXCLUSIVE);
		$this->expectException(\RuntimeException::class);
		$this->service($this->manager(), locks: $locks)->locked(3, static function (): never { throw new \RuntimeException('failed'); });
	}
}
