import type { PublicShareRecovery } from './domain/publicShareRecovery.ts'
import type { GallerySettings } from './domain/gallerySettings'
import type { PublicReviewState, ReviewRound } from './publicTypes.ts'

export type GalleryPurpose = 'showcase' | 'delivery' | 'selection' | 'proofing' | 'uploads' | 'custom'

export interface LivePushCredential {
	id: number
	username: string
	label: string
	path: string
	createdAt: number
	lastUsedAt: number | null
	revokedAt: number | null
	uploadCount: number
	bytesReceived: number
	password?: string
}

export interface LivePushOverview {
	connection: { enabled: boolean; endpointPath: string; protocol: 'https-put' }
	items: LivePushCredential[]
}

export type CapabilityName = 'galleryCreation' | 'publicPublishing' | 'guestUploads' | 'downloads'
	| 'emailInvitations' | 'likes' | 'colors' | 'comments' | 'annotations' | 'selections'
	| 'lifecycleAutomation' | 'xmpWriting'

export type EffectiveCapabilities = Record<CapabilityName, { allowed: boolean; reason: string | null }>

export interface Gallery {
	id: number
	ownerUid: string
	folderId: number
	sourceType: 'folder' | 'collection'
	deliveryMode: 'standard' | 'event'
	title: string
	slug: string
	status: 'draft' | 'published' | 'archived'
	settings: GallerySettings
	shareToken: string | null
	createdAt: number
	updatedAt: number
	archivedAt: number | null
	revision: number
	purpose: GalleryPurpose
	workflowState: 'preparing' | 'live' | 'response_received' | 'completed'
	publishedAt: number | null
	completedAt: number | null
	revokedAt: number | null
	lifecycleRevokeAt: number | null
	lifecycleArchiveAt: number | null
	lifecycleNextAt: number | null
	source: {
		type: 'folder'
		folderId: number
		displayPath: string | null
		state: 'readable' | 'missing'
	} | {
		type: 'collection'
		state: 'readable' | 'degraded'
		itemCount: number
		unavailableCount: number
	}
	mediaSummary: {
		total: number
		coverFileId: number | null
		coverMimeType: string | null
	}
	permissions: {
		role: 'owner' | 'editor' | 'viewer'
		canEdit: boolean
		canManageAccess: boolean
		canArchive: boolean
	}
	effectiveCapabilities: EffectiveCapabilities
	retention: { available: boolean; configuredTagId: string; assigned: boolean; lastAction: { action: string; outcome: string; errorCode: string | null; createdAt: number } | null }
}

export interface MediaMetadata {
	state: 'ready' | 'pending' | 'unavailable'
	capturedAt?: number
	camera?: string
	lens?: string
	focalLength?: number
	aperture?: number
	exposureTime?: string
	iso?: number
	width?: number
	height?: number
	title?: string
	description?: string
	creator?: string
	copyright?: string
	keywords?: string[]
	rating?: number
	label?: string
	gps?: { latitude: number; longitude: number }
	sidecar?: { name: string; etag: string; fileId: number; invalid?: boolean }
}

export interface MediaItem {
	id: number
	name: string
	mimeType: string
	/** Public-safe intrinsic media geometry used for stable gallery layout. */
	width?: number
	height?: number
	size: number
	modifiedAt: number
	etag: string
	folder: boolean
	group?: string
	relativePath?: string
	sourceGalleryId?: number
	sourceGalleryTitle?: string
	metadata?: MediaMetadata
	playback?: { state: 'source' | 'disabled' | 'pending' | 'processing' | 'ready' | 'failed' | 'unavailable'; playable: boolean }
	album?: {
		role: 'shared' | 'group' | 'private'
		mediaCount: number
		folderCount: number
		covers: Array<Pick<MediaItem, 'id' | 'name' | 'mimeType' | 'etag'>>
	}
}

export interface IndexedMediaItem extends MediaItem {
	parentId: number
	relativePath: string
	depth: number
}

export type CullColor = 'none' | 'red' | 'yellow' | 'green' | 'blue' | 'purple'
export type CullPick = 'none' | 'pick' | 'reject'

export interface MediaCull {
	fileId: number
	rating: number
	color: CullColor
	pick: CullPick
	source: 'app' | 'xmp' | 'merge'
	revision: number
	sourceEtag: string | null
	sidecarEtag: string | null
	updatedAt: number
}

export interface GuestRatingValue {
	fileId: number
	rating: number
	pick: CullPick
	updatedAt: number
}

export interface GuestRatingAggregate {
	fileId: number
	count: number
	average: number
	distribution: [number, number, number, number, number, number]
	picks: Record<CullPick, number>
	updatedAt: number
	individuals: Array<GuestRatingValue & { guestId: number | null; actorUid: string | null; actorKind: 'guest' | 'user'; name: string }>
}

export interface GuestRatingPromotion {
	fileId: number
	guestUpdatedAt: number
	guestCount: number
	average: number
	target: Pick<MediaCull, 'rating' | 'pick' | 'color'>
	owner: Pick<MediaCull, 'fileId' | 'rating' | 'pick' | 'color' | 'revision'>
}

export interface IndexedMediaPage {
	items: IndexedMediaItem[]
	previousCursor: string | null
	nextCursor: string | null
	total: number
}

export interface CullingXmpItem {
	fileId: number
	name?: string
	app?: Pick<MediaCull, 'fileId' | 'rating' | 'color' | 'pick' | 'revision'>
	xmp?: { exists: boolean; etag: string | null; rating: number; color: CullColor; pick: CullPick }
	result?: Pick<MediaCull, 'fileId' | 'rating' | 'color' | 'pick' | 'revision'>
	differences?: Array<'rating' | 'color' | 'pick'>
	conflict?: boolean
	action?: 'report' | 'app' | 'xmp' | 'merge'
	wouldWrite?: boolean
	error?: string
}

export interface CullingXmpReport {
	items: CullingXmpItem[]
	total: number
	offset: number
	limit: number
	nextOffset: number | null
	dryRun: boolean
}

export interface CollectionItem {
	sourceGalleryId: number
	sourceGalleryTitle: string | null
	fileId: number
	name: string | null
	mimeType: string | null
	size: number | null
	modifiedAt: number | null
	etag: string | null
	state: 'available' | 'unavailable'
}

export interface CollectionDocument {
	revision: number
	items: CollectionItem[]
	unavailableCount: number
}

export interface MediaPage {
	items: MediaItem[]
	total: number
	limit: number
	offset: number
}

export interface MediaVersion {
	id: string
	filename: string
	mimeType: string
	size: number
	createdBy: string
	createdAt: number
}

export interface OwnerSelection {
	id: string
	name: string
	message: string
	status: 'open' | 'completed'
	fileIds: number[]
	updatedAt: number
	author: string
}

export interface GalleryManager {
	id: number
	type: 'user' | 'group'
	principalId: string
	role: 'viewer' | 'editor'
	createdAt: number
}

export interface PublicLinkPolicy {
	view: boolean
	likes: boolean
	colors: boolean
	comments: boolean
	annotations: boolean
	selections: boolean
	ratings: boolean
	pick: boolean
	upload: boolean
	export: boolean
	metadata: boolean
	downloadScope: 'none' | 'individual' | 'selection' | 'all'
}

export interface GalleryPublicLink {
	recovery?: PublicShareRecovery
	id: number
	galleryId: number
	name: string
	status: 'active' | 'revoked'
	primary: boolean
	policy: PublicLinkPolicy
	startPath: string
	allowedRoots?: string[]
	scopeMode?: 'legacy' | 'nodes' | 'empty'
	scopeHealth?: { state: 'healthy' | 'degraded' | 'empty'; total: number; available: number; missing: number }
	viewMode: 'folder' | 'recursive'
	groupDepth: number
	minOwnerRating: number
	publicLocale: 'en' | 'de' | null
	reviewEnabled: boolean
	reviewDueDate: string | null
	reviewSelectionMinimum: number | null
	reviewSelectionMaximum: number | null
	review: PublicReviewState
	createdAt: number
	updatedAt: number
	revokedAt: number | null
	url: string
	customDomain: { id: number; domain: string; status: 'pending' | 'verified' | 'revoked'; verificationName: string; verificationValue: string } | null
}

export interface ReviewLinkOverview {
	linkId: number
	name: string
	linkStatus: 'active' | 'revoked'
	enabled: boolean
	dueDate: string | null
	rules: { minimum: number; maximum: number; dueDate: string | null }
	progress: { count: number; status: 'open' | 'submitted' | 'completed' } | null
	current: ReviewRound | null
	history: ReviewRound[]
}

export interface ReviewOverview {
	items: ReviewLinkOverview[]
	canEdit: boolean
}

export interface ShareAuditItem {
	publicLinkId: number
	guestId: number | null
	actorUid: string | null
	fileId: number | null
	event: 'login' | 'view' | 'download' | 'export' | 'upload' | 'feedback' | 'revoke'
	outcome: 'success' | 'denied' | 'failed'
	reasonCode: string | null
	createdAt: number
}

export interface GalleryPage {
	items: Gallery[]
	total: number
	limit: number
	offset: number
}

export interface GalleryListItem {
	id: number
	title: string
	status: 'draft' | 'published' | 'archived'
	mode: 'presentation' | 'collaboration'
	sourceType: 'folder' | 'collection'
	deliveryMode: 'standard' | 'event'
	purpose: GalleryPurpose
	workflowState: Gallery['workflowState']
	createdAt: number
	updatedAt: number
	heroFileId: number | null
	lifecycleNextAt: number | null
	mediaSummary: Gallery['mediaSummary']
	permissions: Gallery['permissions']
}

export interface GalleryCursorPage {
	items: GalleryListItem[]
	total: number
	nextCursor: string | null
}

export interface GalleryReadiness {
	ready: boolean
	revision: number
	checks: Array<{
		code: 'source_readable' | 'media_available' | 'publishing_allowed' | 'collection_complete'
		state: 'ready' | 'warning' | 'blocked'
		action: 'overview' | 'content' | 'access'
	}>
}

export interface GalleryPreset {
	id: number
	name: string
	settings: GallerySettings
	createdAt: number
	updatedAt: number
}

export interface InvitationTemplate {
	id: number
	name: string
	body: string
	createdAt: number
	updatedAt: number
}

export type NotificationEventType = 'comment.created' | 'comment.updated' | 'selection.created'
	| 'like.changed' | 'color.changed' | 'upload.received' | 'upload.accepted' | 'upload.rejected'

export interface UserPreferences {
	schemaVersion: 4
	defaultPurpose: GalleryPurpose | null
	parentFolder: { id: number; name: string } | null
	designPresetId: number | null
	publicLocale: 'auto' | 'en' | 'de'
	notifications: {
		nextcloud: { enabled: boolean; events: NotificationEventType[] }
		email: { enabled: boolean; events: NotificationEventType[]; frequency: 'immediate' | 'daily' }
	}
	lifecycle: { enabled: boolean; trigger: 'fixed_date' | 'after_completion'; revokeAfterDays: number; archiveAfterDays: number; retentionHandoff: boolean }
	cullingFilmstripPlacement: 'auto' | 'side' | 'bottom'
	cullingFilmstripSize: number
	savedViews: Array<{
		id: string
		name: string
		galleryId: number
		filters: { sortBy: 'name' | 'modified' | 'size'; sortDirection: 'asc' | 'desc'; rating: number; pick: 'all' | CullPick; color: 'all' | CullColor }
		updatedAt: number
	}>
}

export interface NotificationSubscription {
	id: number
	galleryId: number
	recipientUid: string
	recipientName: string
	eventTypes: NotificationEventType[]
	frequency: 'immediate' | 'daily'
	locale: 'auto' | 'en' | 'de'
	active: boolean
	channels: {
		nextcloud: { enabled: boolean; available: boolean; eventTypes: NotificationEventType[] }
		email: { enabled: boolean; available: boolean; eventTypes: NotificationEventType[]; frequency: 'immediate' | 'daily'; locale: 'auto' | 'en' | 'de' }
	}
}
