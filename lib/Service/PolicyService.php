<?php

declare(strict_types=1);

namespace OCA\ProofingGallery\Service;

use OCA\ProofingGallery\AppInfo\Application;
use OCA\ProofingGallery\Dto\GallerySettings;
use OCP\IConfig;

final class PolicyService {
	private const SETTINGS_KEY = 'instanceSettingsV2';
	private const FEATURE_DEFAULTS = [
		'galleryCreation' => true,
		'publicPublishing' => true,
		'guestUploads' => true,
		'downloads' => true,
		'emailInvitations' => true,
		'nextcloudNotifications' => true,
		'likes' => true,
		'colors' => true,
		'comments' => true,
		'annotations' => true,
		'selections' => true,
		'lifecycleAutomation' => true,
		'ownerCulling' => true,
		'guestRatings' => true,
		'recursiveGalleries' => true,
		'multiplePublicLinks' => true,
	];
	/** @var array<string, array{default: int, min: int, max: int}> */
	private const DEFINITIONS = [
		'maxUploadBytes' => ['default' => 2147483648, 'min' => 1048576, 'max' => 21474836480],
		'maxSelectionFiles' => ['default' => 100, 'min' => 1, 'max' => 1000],
		'maxGalleryDownloadFiles' => ['default' => 1000, 'min' => 1, 'max' => 1000],
		'maxSelectionBytes' => ['default' => 1073741824, 'min' => 1048576, 'max' => 21474836480],
		'eventRetentionDays' => ['default' => 180, 'min' => 7, 'max' => 3650],
		'previewRetentionDays' => ['default' => 30, 'min' => 1, 'max' => 365],
		'pendingUploadRetentionHours' => ['default' => 24, 'min' => 1, 'max' => 168],
		'completedUploadRetentionDays' => ['default' => 365, 'min' => 7, 'max' => 3650],
		'maxVersionsPerFile' => ['default' => 10, 'min' => 1, 'max' => 100],
		'versionRetentionDays' => ['default' => 365, 'min' => 1, 'max' => 3650],
		'metadataMaxBytes' => ['default' => 67108864, 'min' => 1048576, 'max' => 536870912],
		'metadataBatchSize' => ['default' => 100, 'min' => 1, 'max' => 200],
		'xmpWritingEnabled' => ['default' => 1, 'min' => 0, 'max' => 1],
		'maxIndexedMedia' => ['default' => 25000, 'min' => 100, 'max' => 100000],
		'maxPublicLinks' => ['default' => 500, 'min' => 1, 'max' => 2000],
		'maxEventPublicLinks' => ['default' => 1000, 'min' => 2, 'max' => 5000],
		'shareAuditRetentionDays' => ['default' => 90, 'min' => 7, 'max' => 3650],
		'notificationQueueRetentionDays' => ['default' => 30, 'min' => 1, 'max' => 3650],
		'deadLetterRetentionDays' => ['default' => 30, 'min' => 1, 'max' => 3650],
		'maxVideoInputBytes' => ['default' => 10737418240, 'min' => 1048576, 'max' => 53687091200],
		'maxVideoDurationSeconds' => ['default' => 7200, 'min' => 10, 'max' => 43200],
		'videoMaxHeight' => ['default' => 1080, 'min' => 360, 'max' => 2160],
		'videoTranscodeTimeoutSeconds' => ['default' => 1800, 'min' => 30, 'max' => 14400],
		'videoDerivativeRetentionDays' => ['default' => 30, 'min' => 1, 'max' => 365],
		'maxSemanticMedia' => ['default' => 10000, 'min' => 100, 'max' => 100000],
		'semanticBatchSize' => ['default' => 50, 'min' => 1, 'max' => 200],
		'semanticPreviewMaxBytes' => ['default' => 1048576, 'min' => 65536, 'max' => 8388608],
		'maxLivePushCredentials' => ['default' => 3, 'min' => 1, 'max' => 20],
		'maxCustomDomainsPerGallery' => ['default' => 3, 'min' => 1, 'max' => 20],
	];

	public function __construct(private IConfig $config) {
	}

	public function get(string $key): int {
		$definition = self::DEFINITIONS[$key] ?? throw new \InvalidArgumentException('Unknown policy');
		$value = (int)$this->config->getAppValue(
			Application::APP_ID,
			$key,
			(string)$definition['default'],
		);
		return $value < $definition['min'] || $value > $definition['max']
			? $definition['default']
			: $value;
	}

	/** @param array<string, int> $values */
	public function save(array $values): void {
		foreach ($values as $key => $value) {
			$definition = self::DEFINITIONS[$key] ?? throw new \InvalidArgumentException('Unknown policy');
			if ($value < $definition['min'] || $value > $definition['max']) {
				throw new \InvalidArgumentException($key . ' is outside the allowed range');
			}
			$this->config->setAppValue(Application::APP_ID, $key, (string)$value);
		}
	}

	/** @return array<string, int> */
	public function all(): array {
		$values = [];
		foreach (array_keys(self::DEFINITIONS) as $key) {
			$values[$key] = $this->get($key);
		}
		return $values;
	}

	/** @return array<string, mixed> */
	public function galleryDefaults(): array {
		$raw = $this->config->getAppValue(Application::APP_ID, 'galleryDefaults', '');
		try {
			$values = $raw === '' ? [] : json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
			return GallerySettings::fromArray(is_array($values) ? $values : [])->canonical();
		} catch (\Throwable) {
			return GallerySettings::defaults()->canonical();
		}
	}

	/** @param array<string, mixed> $values */
	public function saveGalleryDefaults(array $values): void {
		$settings = GallerySettings::merge(GallerySettings::defaults(), $values);
		\OCA\ProofingGallery\Domain\MediaSort::assertValid($settings->navigation->sortBy, $settings->navigation->sortDirection);
		$this->config->setAppValue(Application::APP_ID, 'galleryDefaults', json_encode($settings, JSON_THROW_ON_ERROR));
	}

	/** @return array<string, mixed> */
	public function instanceSettings(): array {
		$defaults = [
			'schemaVersion' => 2,
			'access' => ['creatorGroups' => [], 'publisherGroups' => []],
			'features' => array_replace(self::FEATURE_DEFAULTS, [
				'guestRatings' => $this->config->getAppValue(Application::APP_ID, 'guestRatingsDefault', '1') === '1',
			]),
			'workflow' => ['defaultPurpose' => 'delivery'],
			'branding' => ['studioName' => '', 'accentColor' => '#E85D4A', 'logoAssetId' => null],
			'media' => ['videoTranscoding' => true, 'ffmpegPath' => 'ffmpeg', 'transcodeConcurrency' => 1, 'transcodePreset' => 'medium'],
			'semantic' => ['provider' => 'disabled', 'endpoint' => '', 'model' => 'metadata-v1', 'scope' => 'images', 'externalTransfer' => false],
			'livePush' => ['enabled' => false],
			'customDomains' => ['enabled' => false],
			'retention' => ['enabled' => false, 'systemTagId' => ''],
		];
		$raw = $this->config->getAppValue(Application::APP_ID, self::SETTINGS_KEY, '');
		if ($raw === '') return $defaults;
		try {
			$stored = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
			if (!is_array($stored)) return $defaults;
			return [
				...$defaults,
				'access' => array_replace($defaults['access'], is_array($stored['access'] ?? null) ? $stored['access'] : []),
				'features' => array_replace($defaults['features'], is_array($stored['features'] ?? null) ? $stored['features'] : []),
				'workflow' => array_replace($defaults['workflow'], is_array($stored['workflow'] ?? null) ? $stored['workflow'] : []),
				'branding' => array_replace($defaults['branding'], is_array($stored['branding'] ?? null) ? $stored['branding'] : []),
				'media' => array_replace($defaults['media'], is_array($stored['media'] ?? null) ? $stored['media'] : []),
				'semantic' => array_replace($defaults['semantic'], is_array($stored['semantic'] ?? null) ? $stored['semantic'] : []),
				'livePush' => ['enabled' => (bool)($stored['livePush']['enabled'] ?? false)],
				'customDomains' => array_replace($defaults['customDomains'], is_array($stored['customDomains'] ?? null) ? $stored['customDomains'] : []),
				'retention' => array_replace($defaults['retention'], is_array($stored['retention'] ?? null) ? $stored['retention'] : []),
			];
		} catch (\Throwable) {
			return $defaults;
		}
	}

	/**
	 * @param array<string, mixed> $patch
	 * @return array<string, mixed>
	 */
	public function saveInstanceSettings(array $patch): array {
		$allowedSections = ['access', 'features', 'workflow', 'branding', 'media', 'semantic', 'livePush', 'customDomains', 'retention'];
		$unknownSections = array_diff(array_keys($patch), $allowedSections);
		if ($unknownSections !== []) throw new \InvalidArgumentException('Unknown instance setting: ' . reset($unknownSections));
		$current = $this->instanceSettings();
		foreach ($allowedSections as $section) {
			if (array_key_exists($section, $patch)) {
				if (!is_array($patch[$section])) throw new \InvalidArgumentException($section . ' must be an object');
				$unknownKeys = array_diff(array_keys($patch[$section]), array_keys($current[$section]));
				if ($unknownKeys !== []) throw new \InvalidArgumentException('Unknown ' . $section . ' setting: ' . reset($unknownKeys));
				$current[$section] = array_replace($current[$section], $patch[$section]);
			}
		}
		foreach (array_keys($current['features']) as $key) {
			if (!is_bool($current['features'][$key])) throw new \InvalidArgumentException($key . ' must be a boolean');
		}
		$unknownFeatures = array_diff(array_keys($current['features']), array_keys(self::FEATURE_DEFAULTS));
		if ($unknownFeatures !== []) throw new \InvalidArgumentException('Unknown feature policy: ' . reset($unknownFeatures));
		foreach (['creatorGroups', 'publisherGroups'] as $key) {
			if (!is_array($current['access'][$key])) throw new \InvalidArgumentException($key . ' must be a list');
			$current['access'][$key] = array_values(array_unique(array_map(static function (mixed $value): string {
				$value = trim((string)$value);
				if ($value === '' || mb_strlen($value) > 64) throw new \InvalidArgumentException('Invalid group identifier');
				return $value;
			}, $current['access'][$key])));
		}
		if (!in_array($current['workflow']['defaultPurpose'], ['showcase', 'delivery', 'selection', 'proofing', 'uploads', 'custom'], true)) {
			throw new \InvalidArgumentException('Invalid default gallery purpose');
		}
		$current['branding']['studioName'] = trim((string)$current['branding']['studioName']);
		if (mb_strlen($current['branding']['studioName']) > 120) throw new \InvalidArgumentException('Studio name is too long');
		if (preg_match('/^#[0-9a-fA-F]{6}$/', (string)$current['branding']['accentColor']) !== 1) {
			throw new \InvalidArgumentException('Accent color must be a six-digit hex color');
		}
		if ($current['branding']['logoAssetId'] !== null
			&& (!is_string($current['branding']['logoAssetId']) || preg_match('/^[A-Za-z0-9]{32}\.(png|jpg|webp|svg)$/', $current['branding']['logoAssetId']) !== 1)) {
			throw new \InvalidArgumentException('Invalid branding logo asset');
		}
		if (!is_bool($current['media']['videoTranscoding'])) throw new \InvalidArgumentException('videoTranscoding must be a boolean');
		$current['media']['ffmpegPath'] = trim((string)$current['media']['ffmpegPath']);
		if (preg_match('~^(?:[A-Za-z]:[\\\\/]|/)?[A-Za-z0-9._/\\\\-]+$~', $current['media']['ffmpegPath']) !== 1
			|| mb_strlen($current['media']['ffmpegPath']) > 255) throw new \InvalidArgumentException('Invalid FFmpeg path');
		$current['media']['transcodeConcurrency'] = (int)$current['media']['transcodeConcurrency'];
		if ($current['media']['transcodeConcurrency'] < 1 || $current['media']['transcodeConcurrency'] > 4) throw new \InvalidArgumentException('Invalid transcode concurrency');
		if (!in_array($current['media']['transcodePreset'], ['veryfast', 'medium', 'slow'], true)) throw new \InvalidArgumentException('Invalid transcode preset');
		if (!in_array($current['semantic']['provider'], ['disabled', 'local', 'https'], true)) throw new \InvalidArgumentException('Invalid semantic provider');
		$current['semantic']['externalTransfer'] = (bool)$current['semantic']['externalTransfer'];
		$current['semantic']['endpoint'] = trim((string)$current['semantic']['endpoint']);
		$current['semantic']['model'] = trim((string)$current['semantic']['model']);
		if (preg_match('/^[A-Za-z0-9._-]{1,80}$/', $current['semantic']['model']) !== 1) throw new \InvalidArgumentException('Invalid semantic model');
		if (!in_array($current['semantic']['scope'], ['images', 'images_and_video'], true)) throw new \InvalidArgumentException('Invalid semantic scope');
		if ($current['semantic']['provider'] === 'https') {
			if (!$current['semantic']['externalTransfer']) throw new \InvalidArgumentException('External transfer must be explicitly enabled');
			if (filter_var($current['semantic']['endpoint'], FILTER_VALIDATE_URL) === false || !str_starts_with($current['semantic']['endpoint'], 'https://')) {
				throw new \InvalidArgumentException('Semantic provider must use HTTPS');
			}
		}
		if (!is_bool($current['livePush']['enabled'])) throw new \InvalidArgumentException('livePush enabled must be a boolean');
		$current['livePush'] = ['enabled' => $current['livePush']['enabled']];
		if (!is_bool($current['customDomains']['enabled'])) throw new \InvalidArgumentException('customDomains enabled must be a boolean');
		if (!is_bool($current['retention']['enabled'])) throw new \InvalidArgumentException('retention enabled must be a boolean');
		$current['retention']['systemTagId'] = trim((string)$current['retention']['systemTagId']);
		if ($current['retention']['systemTagId'] !== '' && preg_match('/^\d{1,20}$/', $current['retention']['systemTagId']) !== 1) throw new \InvalidArgumentException('Invalid retention system tag ID');
		if ($current['retention']['enabled'] && $current['retention']['systemTagId'] === '') throw new \InvalidArgumentException('A retention system tag is required');
		$current['schemaVersion'] = 2;
		$this->config->setAppValue(Application::APP_ID, self::SETTINGS_KEY, json_encode($current, JSON_THROW_ON_ERROR));
		return $current;
	}

	public function feature(string $key): bool {
		if (!array_key_exists($key, self::FEATURE_DEFAULTS)) throw new \InvalidArgumentException('Unknown feature policy');
		return $this->instanceSettings()['features'][$key];
	}

	/** @return array{enabled: bool, ffmpegPath: string, concurrency: int, preset: string} */
	public function videoSettings(): array {
		$media = $this->instanceSettings()['media'];
		return [
			'enabled' => (bool)$media['videoTranscoding'],
			'ffmpegPath' => (string)$media['ffmpegPath'],
			'concurrency' => (int)$media['transcodeConcurrency'],
			'preset' => (string)$media['transcodePreset'],
		];
	}

	/** @return array{provider: string, endpoint: string, model: string, scope: string, externalTransfer: bool} */
	public function semanticSettings(): array {
		$settings = $this->instanceSettings()['semantic'];
		return ['provider' => (string)$settings['provider'], 'endpoint' => (string)$settings['endpoint'],
			'model' => (string)$settings['model'], 'scope' => (string)$settings['scope'], 'externalTransfer' => (bool)$settings['externalTransfer']];
	}

	/** @return array{enabled: bool, endpointPath: string, protocol: string} */
	public function livePushSettings(): array {
		$settings = $this->instanceSettings()['livePush'];
		return ['enabled' => (bool)$settings['enabled'], 'endpointPath' => '/apps/proofing_gallery/live-push/upload', 'protocol' => 'https-put'];
	}

	public function customDomainsEnabled(): bool {
		return (bool)$this->instanceSettings()['customDomains']['enabled'];
	}

	/** @return array{enabled:bool,systemTagId:string} */
	public function retentionSettings(): array {
		$settings = $this->instanceSettings()['retention'];
		return ['enabled' => (bool)$settings['enabled'], 'systemTagId' => (string)$settings['systemTagId']];
	}
}
