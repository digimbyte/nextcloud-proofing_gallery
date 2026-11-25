<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Tests\Unit\Service;

use OCA\ProofingGallery\Service\PublicShareMetadataService;
use OCP\IURLGenerator;
use PHPUnit\Framework\TestCase;

final class PublicShareMetadataServiceTest extends TestCase {
	public function testLinkPreviewUsesTheHeroAndTheShareAsCanonicalUrl(): void {
		$tags = $this->tagMap($this->service()->headTags('tok', 'Studio No. 7', "Choose the frames\n\nthat feel like you.", 'Studio', true, 91, 'auto'));

		self::assertSame('Studio No. 7', $tags['og:title']);
		self::assertSame('https://cloud.example/s/tok', $tags['og:url']);
		self::assertSame('Choose the frames that feel like you.', $tags['og:description']);
		self::assertSame('https://cloud.example/hero/tok?x=1200&y=630', $tags['og:image']);
		self::assertSame('summary_large_image', $tags['twitter:card']);
		self::assertSame('Studio', $tags['og:site_name']);
		self::assertSame('Studio No. 7', $tags['apple-mobile-web-app-title']);
		self::assertSame('/manifest/tok', $tags['manifest']);
	}

	public function testLinkPreviewFallsBackToTheFirstImageAndOmitsEmptyText(): void {
		$tags = $this->tagMap($this->service()->headTags('tok', 'Gallery', '  ', '', false, 12, 'dark'));

		self::assertSame('https://cloud.example/preview/tok/12?x=1200&y=1200&mode=fit', $tags['og:image']);
		self::assertArrayNotHasKey('og:description', $tags);
		self::assertArrayNotHasKey('og:site_name', $tags);
		self::assertSame('black-translucent', $tags['apple-mobile-web-app-status-bar-style']);
	}

	public function testLinkPreviewWithoutImagesUsesTheSmallCard(): void {
		$tags = $this->tagMap($this->service()->headTags('tok', 'Gallery', '', '', false, null, 'light'));

		self::assertArrayNotHasKey('og:image', $tags);
		self::assertSame('summary', $tags['twitter:card']);
	}

	public function testManifestOpensTheShareWithTheGalleryIdentity(): void {
		$manifest = $this->service()->manifest('tok', 'A very long wedding gallery title', '', '#2854D7', 'light', true, 'de');

		self::assertSame('https://cloud.example/s/tok', $manifest['start_url']);
		self::assertSame('https://cloud.example/s/tok', $manifest['scope']);
		self::assertSame('A very long wedding gallery title', $manifest['name']);
		self::assertSame(24, mb_strwidth($manifest['short_name']));
		self::assertSame('#2854D7', $manifest['theme_color']);
		self::assertSame('#f2f2f7', $manifest['background_color']);
		self::assertSame('de', $manifest['lang']);
		self::assertSame('standalone', $manifest['display']);
		self::assertSame(['192x192', '512x512', '180x180'], array_column($manifest['icons'], 'sizes'));
	}

	public function testManifestRejectsInvalidAccentColors(): void {
		$manifest = $this->service()->manifest('tok', 'Gallery', '', 'red', 'auto', false, 'auto');

		self::assertSame('#E85D4A', $manifest['theme_color']);
		self::assertSame('#000000', $manifest['background_color']);
		self::assertArrayNotHasKey('lang', $manifest);
		self::assertCount(1, $manifest['icons']);
	}

	private function service(): PublicShareMetadataService {
		$urls = $this->createMock(IURLGenerator::class);
		$urls->method('linkToRouteAbsolute')->willReturnCallback(static function (string $route, array $parameters): string {
			return match ($route) {
				'files_sharing.sharecontroller.showShare' => 'https://cloud.example/s/' . $parameters['token'],
				'proofing_gallery.PublicGallery.asset' => 'https://cloud.example/hero/' . $parameters['token'] . '?x=' . $parameters['x'] . '&y=' . $parameters['y'],
				'proofing_gallery.PublicGallery.preview' => 'https://cloud.example/preview/' . $parameters['token'] . '/' . $parameters['fileId'] . '?x=' . $parameters['x'] . '&y=' . $parameters['y'] . '&mode=' . $parameters['mode'],
				default => throw new \LogicException($route),
			};
		});
		$urls->method('linkToRoute')->willReturnCallback(static fn (string $route, array $parameters): string => '/manifest/' . $parameters['token']);
		$urls->method('linkTo')->willReturn('/custom_apps/proofing_gallery/img/favicon-touch.png');
		$urls->method('getAbsoluteURL')->willReturnCallback(static fn (string $url): string => 'https://cloud.example' . $url);
		return new PublicShareMetadataService($urls);
	}

	/** @param list<array{0: string, 1: array<string, string>}> $tags */
	private function tagMap(array $tags): array {
		$map = [];
		foreach ($tags as [$tag, $attributes]) {
			$key = $attributes['property'] ?? $attributes['name'] ?? $attributes['rel'];
			$map[$key] = $attributes['content'] ?? $attributes['href'];
		}
		return $map;
	}
}
