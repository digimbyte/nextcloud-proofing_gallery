export type FeedbackVisibility = 'collaborative' | 'private'
export type GalleryMode = 'presentation' | 'collaboration'

export interface GalleryStorySection {
	id: string
	title: string
	body: string
	style: 'full' | 'split' | 'sequence'
	mediaIds: number[]
}

export interface GalleryAppearance {
	accentColor: string
	welcomeMessage: string
	logoMode: 'inherit' | 'none' | 'gallery' | 'upload'
	logoBackground: 'transparent' | 'light' | 'dark'
	logoFileId: number | null
	logoAssetId: string | null
	instanceLogoAssetId: string | null
	instanceStudioName: string
	heroFileId: number | null
	coverFileId: number | null
	heroSource: 'cover' | 'custom' | 'none'
	openerStyle: 'minimal' | 'compact' | 'cinematic'
	heroFocusX: number
	heroFocusY: number
	fontPreset: 'system' | 'editorial' | 'modern'
	watermarkText: string
	watermarkOpacity: number
	watermarkTextPosition: 'tile' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
	watermarkTextSize: number
	watermarkImageAssetId: string | null
	watermarkImageOpacity: number
	watermarkImagePosition: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
	watermarkImageScale: number
}

export interface GalleryPresentation extends GalleryAppearance {
	theme: 'auto' | 'light' | 'dark'
	layout: 'grid' | 'masonry' | 'list' | 'story'
	tileSize: 'small' | 'medium' | 'large'
	tileGap: 'tight' | 'normal' | 'wide'
	tileRadius: 'square' | 'soft'
	titleAlignment: 'left' | 'center'
	titleMode: 'large' | 'compact' | 'hidden'
	showMediaCount: boolean
	titleSize: 'medium' | 'large'
	showFilenames: boolean
	slideshowInterval: number
	motionPreset: 'off' | 'subtle' | 'expressive'
	lightboxFilmstripPlacement: 'auto' | 'side' | 'bottom' | 'hidden'
	lightboxChromeBehavior: 'persistent' | 'autoHide'
	story: { sections: GalleryStorySection[]; showAllMedia: boolean }
}

export interface GallerySettings {
	schemaVersion?: 14
	mode: GalleryMode
	publicLocale: 'auto' | 'en' | 'de'
	review: {
		visibility: FeedbackVisibility
		likes: boolean
		colors: boolean
		comments: boolean
		annotations: boolean
		selections: boolean
		ratings: boolean
		pick: boolean
		colorLabels: [string, string, string, string]
		colorEnabled: [boolean, boolean, boolean, boolean]
		selectionWarningThreshold: number
		selectionMinimum: number
		selectionMaximum: number
		selectionDueDate: string | null
	}
	delivery: {
		downloadScope: 'none' | 'individual' | 'selection' | 'all'
		contactSheet: boolean
		guestUploads: boolean
	}
	navigation: {
		folders: boolean
		recursive: boolean
		groupDepth: number
		sortBy: 'name' | 'modified' | 'size' | 'capturedAt' | 'collection'
		sortDirection: 'asc' | 'desc'
		groupBy: 'none' | 'type' | 'folder'
	}
	security: {
		allowModeSwitch: boolean
		hideRejectedInPresentation: boolean
	}
	metadata: {
		publicFields: Array<'capturedAt' | 'camera' | 'lens' | 'exposure' | 'title' | 'description' | 'creator' | 'copyright'>
	}
	lifecycle: {
		enabled: boolean
		trigger: 'fixed_date' | 'after_completion'
		revokeAt: string
		revokeAfterDays: number
		archiveAfterDays: number
		reminderDays: number[]
		retentionHandoff: boolean
	}
	presentation: GalleryPresentation
}

export type CanonicalGallerySettings = Pick<GallerySettings,
	'schemaVersion' | 'mode' | 'publicLocale' | 'review' | 'presentation' | 'delivery' | 'navigation' | 'security' | 'metadata' | 'lifecycle'>

export function canonicalGallerySettings(settings: GallerySettings): CanonicalGallerySettings {
	return {
		schemaVersion: 14,
		mode: settings.mode,
		publicLocale: settings.publicLocale,
		review: structuredClone(settings.review),
		presentation: structuredClone(settings.presentation),
		delivery: structuredClone(settings.delivery),
		navigation: structuredClone(settings.navigation),
		security: structuredClone(settings.security),
		metadata: structuredClone(settings.metadata),
		lifecycle: structuredClone(settings.lifecycle),
	}
}

const DEFAULT_COLOR_LABELS: GallerySettings['review']['colorLabels'] = [
	'Favorite',
	'Selected',
	'Needs changes',
	'Rejected',
]

export function createDefaultGallerySettings(): GallerySettings {
	const presentation: GallerySettings['presentation'] = {
		accentColor: '#E85D4A',
		welcomeMessage: '',
		logoMode: 'inherit',
		logoBackground: 'transparent',
		logoFileId: null,
		logoAssetId: null,
		instanceLogoAssetId: null,
		instanceStudioName: '',
		heroFileId: null,
		coverFileId: null,
		heroSource: 'cover',
		openerStyle: 'minimal',
		heroFocusX: 50,
		heroFocusY: 50,
		fontPreset: 'modern',
		watermarkText: '',
		watermarkOpacity: 24,
		watermarkTextPosition: 'tile',
		watermarkTextSize: 18,
		watermarkImageAssetId: null,
		watermarkImageOpacity: 24,
		watermarkImagePosition: 'bottom-right',
		watermarkImageScale: 20,
		theme: 'auto',
		layout: 'grid',
		tileSize: 'medium',
		tileGap: 'normal',
		tileRadius: 'soft',
		titleAlignment: 'left',
		titleMode: 'large',
		showMediaCount: true,
		titleSize: 'medium',
		showFilenames: false,
		slideshowInterval: 5,
		motionPreset: 'subtle',
		lightboxFilmstripPlacement: 'auto',
		lightboxChromeBehavior: 'autoHide',
		story: { sections: [], showAllMedia: true },
	}
	return {
		schemaVersion: 14,
		mode: 'presentation',
		publicLocale: 'auto',
		review: {
			visibility: 'collaborative',
			likes: true,
			colors: true,
			comments: true,
			annotations: true,
			selections: true,
			ratings: false,
			pick: false,
			colorLabels: [...DEFAULT_COLOR_LABELS] as GallerySettings['review']['colorLabels'],
			colorEnabled: [true, true, true, true],
			selectionWarningThreshold: 0,
			selectionMinimum: 0,
			selectionMaximum: 0,
			selectionDueDate: null,
		},
		delivery: { downloadScope: 'none', contactSheet: true, guestUploads: false },
		navigation: { folders: true, recursive: false, groupDepth: 1, sortBy: 'name', sortDirection: 'asc', groupBy: 'none' },
		security: { allowModeSwitch: false, hideRejectedInPresentation: false },
		metadata: { publicFields: [] },
		lifecycle: { enabled: false, trigger: 'after_completion', revokeAt: '', revokeAfterDays: 30, archiveAfterDays: 30, reminderDays: [7, 1], retentionHandoff: false },
		presentation,
	}
}
