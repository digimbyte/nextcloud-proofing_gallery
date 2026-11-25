<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Dto\Settings;

use InvalidArgumentException;
use JsonSerializable;

final class PresentationSettings implements JsonSerializable {
	private function __construct(
		public readonly string $accentColor,
		public readonly string $welcomeMessage,
		public readonly string $logoMode,
		public readonly string $logoBackground,
		public readonly ?int $logoFileId,
		public readonly ?string $logoAssetId,
		public readonly ?string $instanceLogoAssetId,
		public readonly string $instanceStudioName,
		public readonly ?int $heroFileId,
		public readonly ?int $coverFileId,
		public readonly string $heroSource,
		public readonly string $openerStyle,
		public readonly int $heroFocusX,
		public readonly int $heroFocusY,
		public readonly string $fontPreset,
		public readonly string $watermarkText,
		public readonly int $watermarkOpacity,
		public readonly string $watermarkTextPosition,
		public readonly int $watermarkTextSize,
		public readonly ?string $watermarkImageAssetId,
		public readonly int $watermarkImageOpacity,
		public readonly string $watermarkImagePosition,
		public readonly int $watermarkImageScale,
		public readonly string $theme,
		public readonly string $layout,
		public readonly string $tileSize,
		public readonly string $tileGap,
		public readonly string $tileRadius,
		public readonly string $titleAlignment,
		public readonly string $titleMode,
		public readonly bool $showMediaCount,
		public readonly string $titleSize,
		public readonly bool $showFilenames,
		public readonly int $slideshowInterval,
		public readonly string $motionPreset,
		public readonly string $lightboxFilmstripPlacement,
		public readonly string $lightboxChromeBehavior,
		public readonly StorySettings $story,
	) {
	}

	/** @return array<string, mixed> */
	public static function defaults(): array {
		return [
			'accentColor' => '#E85D4A', 'welcomeMessage' => '', 'logoMode' => 'inherit', 'logoBackground' => 'transparent', 'logoFileId' => null, 'logoAssetId' => null, 'instanceLogoAssetId' => null, 'instanceStudioName' => '', 'heroFileId' => null,
			'coverFileId' => null, 'heroSource' => 'cover',
			'openerStyle' => 'minimal', 'heroFocusX' => 50, 'heroFocusY' => 50, 'fontPreset' => 'modern',
			'watermarkText' => '', 'watermarkOpacity' => 24, 'watermarkTextPosition' => 'tile', 'watermarkTextSize' => 18,
			'watermarkImageAssetId' => null, 'watermarkImageOpacity' => 24, 'watermarkImagePosition' => 'bottom-right', 'watermarkImageScale' => 20,
			'theme' => 'auto', 'layout' => 'grid',
			'tileSize' => 'medium', 'tileGap' => 'normal', 'tileRadius' => 'soft', 'titleAlignment' => 'left',
			'titleMode' => 'large', 'showMediaCount' => true, 'titleSize' => 'medium',
			'showFilenames' => false, 'slideshowInterval' => 5, 'motionPreset' => 'subtle',
			'lightboxFilmstripPlacement' => 'auto', 'lightboxChromeBehavior' => 'autoHide',
			'story' => StorySettings::defaults(),
		];
	}

	/** @param array<string, mixed> $input */
	public static function fromArray(array $input): self {
		// Preserve the artwork of documents written before separate card covers.
		if (!array_key_exists('heroSource', $input) && ($input['heroFileId'] ?? null) !== null) {
			$input['heroSource'] = 'custom';
			$input['coverFileId'] ??= $input['heroFileId'];
		}
		// Schema <= 9 encoded compact and hidden titles through two unrelated
		// fields. Keep accepting that shape at the boundary, but never emit it.
		if (!array_key_exists('titleMode', $input)) {
			$showTitle = $input['showTitle'] ?? true;
			$input['titleMode'] = $showTitle === false
				? 'hidden'
				: (($input['titleSize'] ?? 'medium') === 'small' ? 'compact' : 'large');
		}
		if (($input['titleSize'] ?? null) === 'small') $input['titleSize'] = 'medium';
		unset($input['showTitle']);
		$value = SettingsInput::merge('presentation', self::defaults(), $input);
		$accent = SettingsInput::string($value['accentColor'], 'presentation.accentColor');
		$welcome = SettingsInput::string($value['welcomeMessage'], 'presentation.welcomeMessage');
		$watermark = SettingsInput::string($value['watermarkText'], 'presentation.watermarkText');
		$studioName = trim(SettingsInput::string($value['instanceStudioName'], 'presentation.instanceStudioName'));
		$x = SettingsInput::int($value['heroFocusX'], 'presentation.heroFocusX');
		$y = SettingsInput::int($value['heroFocusY'], 'presentation.heroFocusY');
		$opacity = SettingsInput::int($value['watermarkOpacity'], 'presentation.watermarkOpacity');
		$textSize = SettingsInput::int($value['watermarkTextSize'], 'presentation.watermarkTextSize');
		$imageOpacity = SettingsInput::int($value['watermarkImageOpacity'], 'presentation.watermarkImageOpacity');
		$imageScale = SettingsInput::int($value['watermarkImageScale'], 'presentation.watermarkImageScale');
		$interval = SettingsInput::int($value['slideshowInterval'], 'presentation.slideshowInterval');
		$asset = $value['instanceLogoAssetId'];
		if ($asset !== null && (!is_string($asset) || preg_match('/^[A-Za-z0-9]{32}\.(png|jpg|webp|svg)$/', $asset) !== 1)) {
			throw new InvalidArgumentException('presentation.instanceLogoAssetId must be a branding asset ID or null');
		}
		foreach (['logoAssetId', 'watermarkImageAssetId'] as $key) {
			if ($value[$key] !== null && (!is_string($value[$key]) || preg_match('/^[A-Za-z0-9]{32}$/', $value[$key]) !== 1)) {
				throw new InvalidArgumentException("presentation.$key must be a design asset ID or null");
			}
		}
		if (preg_match('/^#[0-9a-fA-F]{6}$/', $accent) !== 1 || mb_strlen($welcome) > 4000 || mb_strlen($watermark) > 120 || mb_strlen($studioName) > 120
			|| $x < 0 || $x > 100 || $y < 0 || $y > 100 || $opacity < 5 || $opacity > 100 || $textSize < 8 || $textSize > 72
			|| $imageOpacity < 5 || $imageOpacity > 100 || $imageScale < 5 || $imageScale > 50 || $interval < 3 || $interval > 15) {
			throw new InvalidArgumentException('Invalid presentation settings');
		}
		return new self(
			$accent, $welcome, SettingsInput::choice($value['logoMode'], 'presentation.logoMode', ['inherit', 'none', 'gallery', 'upload']),
			SettingsInput::choice($value['logoBackground'], 'presentation.logoBackground', ['transparent', 'light', 'dark']),
			SettingsInput::nullableInt($value['logoFileId'], 'presentation.logoFileId'), $value['logoAssetId'], $asset, $studioName,
			SettingsInput::nullableInt($value['heroFileId'], 'presentation.heroFileId'),
			SettingsInput::nullableInt($value['coverFileId'], 'presentation.coverFileId'),
			SettingsInput::choice($value['heroSource'], 'presentation.heroSource', ['cover', 'custom', 'none']),
			SettingsInput::choice($value['openerStyle'], 'presentation.openerStyle', ['minimal', 'compact', 'cinematic']),
			$x, $y, SettingsInput::choice($value['fontPreset'], 'presentation.fontPreset', ['system', 'editorial', 'modern']),
			$watermark, $opacity,
			SettingsInput::choice($value['watermarkTextPosition'], 'presentation.watermarkTextPosition', ['tile', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']), $textSize,
			$value['watermarkImageAssetId'], $imageOpacity,
			SettingsInput::choice($value['watermarkImagePosition'], 'presentation.watermarkImagePosition', ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']), $imageScale,
			SettingsInput::choice($value['theme'], 'presentation.theme', ['auto', 'light', 'dark']),
			SettingsInput::choice($value['layout'], 'presentation.layout', ['grid', 'masonry', 'list', 'story']),
			SettingsInput::choice($value['tileSize'], 'presentation.tileSize', ['small', 'medium', 'large']),
			SettingsInput::choice($value['tileGap'], 'presentation.tileGap', ['tight', 'normal', 'wide']),
			SettingsInput::choice($value['tileRadius'], 'presentation.tileRadius', ['square', 'soft']),
			SettingsInput::choice($value['titleAlignment'], 'presentation.titleAlignment', ['left', 'center']),
			SettingsInput::choice($value['titleMode'], 'presentation.titleMode', ['large', 'compact', 'hidden']),
			SettingsInput::bool($value['showMediaCount'], 'presentation.showMediaCount'),
			SettingsInput::choice($value['titleSize'], 'presentation.titleSize', ['medium', 'large']),
			SettingsInput::bool($value['showFilenames'], 'presentation.showFilenames'), $interval,
			SettingsInput::choice($value['motionPreset'], 'presentation.motionPreset', ['off', 'subtle', 'expressive']),
			SettingsInput::choice($value['lightboxFilmstripPlacement'], 'presentation.lightboxFilmstripPlacement', ['auto', 'side', 'bottom', 'hidden']),
			SettingsInput::choice($value['lightboxChromeBehavior'], 'presentation.lightboxChromeBehavior', ['persistent', 'autoHide']),
			StorySettings::fromArray(SettingsInput::object($value, 'story')),
		);
	}

	/** @return array<string, mixed> */
	public function jsonSerialize(): array {
		return [...get_object_vars($this), 'story' => $this->story->jsonSerialize()];
	}
}
