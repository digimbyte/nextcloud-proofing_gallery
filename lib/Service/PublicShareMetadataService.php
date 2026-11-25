<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Service;

use OCA\ProofingGallery\AppInfo\Application;
use OCP\IURLGenerator;

/**
 * Head tags and the web manifest that make a shared gallery look like its own
 * app: messenger link previews, a home-screen entry that opens the share
 * instead of the Nextcloud login, and the gallery's own colors.
 */
final class PublicShareMetadataService {
	private const DESCRIPTION_LIMIT = 200;

	public function __construct(private IURLGenerator $urls) {
	}

	/** @return list<array{0: string, 1: array<string, string>}> */
	public function headTags(
		string $token,
		string $title,
		string $welcomeMessage,
		string $studioName,
		bool $hasHero,
		?int $firstImageId,
		string $theme,
	): array {
		$description = $this->description($welcomeMessage);
		$image = $this->imageUrl($token, $hasHero, $firstImageId);
		$tags = [
			['meta', ['property' => 'og:type', 'content' => 'website']],
			['meta', ['property' => 'og:title', 'content' => $title]],
			['meta', ['property' => 'og:url', 'content' => $this->shareUrl($token)]],
			['meta', ['name' => 'twitter:card', 'content' => $image === null ? 'summary' : 'summary_large_image']],
			['meta', ['name' => 'twitter:title', 'content' => $title]],
			['meta', ['name' => 'apple-mobile-web-app-title', 'content' => $title]],
			['meta', ['name' => 'apple-mobile-web-app-capable', 'content' => 'yes']],
			['meta', ['name' => 'mobile-web-app-capable', 'content' => 'yes']],
			['meta', ['name' => 'apple-mobile-web-app-status-bar-style', 'content' => $theme === 'light' ? 'default' : 'black-translucent']],
			['link', ['rel' => 'manifest', 'href' => $this->manifestUrl($token), 'crossorigin' => 'use-credentials']],
		];
		if ($studioName !== '') $tags[] = ['meta', ['property' => 'og:site_name', 'content' => $studioName]];
		if ($description !== '') {
			$tags[] = ['meta', ['name' => 'description', 'content' => $description]];
			$tags[] = ['meta', ['property' => 'og:description', 'content' => $description]];
			$tags[] = ['meta', ['name' => 'twitter:description', 'content' => $description]];
		}
		if ($image !== null) {
			$tags[] = ['meta', ['property' => 'og:image', 'content' => $image]];
			$tags[] = ['meta', ['property' => 'og:image:alt', 'content' => $title]];
			$tags[] = ['meta', ['name' => 'twitter:image', 'content' => $image]];
		}
		return $tags;
	}

	/** @return array<string, mixed> */
	public function manifest(string $token, string $title, string $welcomeMessage, string $accentColor, string $theme, bool $hasHero, string $language): array {
		$start = $this->shareUrl($token);
		$background = $theme === 'light' ? '#f2f2f7' : '#000000';
		$icons = [];
		if ($hasHero) {
			foreach ([192, 512] as $size) {
				$icons[] = [
					'src' => $this->urls->linkToRouteAbsolute('proofing_gallery.PublicGallery.asset', ['token' => $token, 'kind' => 'hero', 'x' => $size, 'y' => $size]),
					'sizes' => "{$size}x{$size}",
					'purpose' => 'any',
				];
			}
		}
		$icons[] = ['src' => $this->urls->getAbsoluteURL($this->urls->linkTo(Application::APP_ID, 'img/favicon-touch.png')), 'sizes' => '180x180', 'type' => 'image/png', 'purpose' => 'any'];
		$manifest = [
			'id' => $start,
			'name' => $title,
			'short_name' => mb_strimwidth($title, 0, 24, '…'),
			'start_url' => $start,
			'scope' => $start,
			'display' => 'standalone',
			'theme_color' => preg_match('/^#[0-9a-fA-F]{6}$/', $accentColor) === 1 ? $accentColor : '#E85D4A',
			'background_color' => $background,
			'icons' => $icons,
		];
		if (in_array($language, ['de', 'en'], true)) $manifest['lang'] = $language;
		$description = $this->description($welcomeMessage);
		if ($description !== '') $manifest['description'] = $description;
		return $manifest;
	}

	public function shareUrl(string $token): string {
		return $this->urls->linkToRouteAbsolute('files_sharing.sharecontroller.showShare', ['token' => $token]);
	}

	private function manifestUrl(string $token): string {
		return $this->urls->linkToRoute('proofing_gallery.PublicGallery.manifest', ['token' => $token]);
	}

	private function imageUrl(string $token, bool $hasHero, ?int $firstImageId): ?string {
		// 1200x630 is the common large link-preview frame; hero artwork is already public on the page.
		if ($hasHero) return $this->urls->linkToRouteAbsolute('proofing_gallery.PublicGallery.asset', ['token' => $token, 'kind' => 'hero', 'x' => 1200, 'y' => 630]);
		if ($firstImageId === null) return null;
		return $this->urls->linkToRouteAbsolute('proofing_gallery.PublicGallery.preview', ['token' => $token, 'fileId' => $firstImageId, 'x' => 1200, 'y' => 1200, 'mode' => 'fit']);
	}

	private function description(string $welcomeMessage): string {
		$text = trim((string)preg_replace('/\s+/u', ' ', $welcomeMessage));
		return mb_strimwidth($text, 0, self::DESCRIPTION_LIMIT, '…');
	}
}
