<script setup lang="ts">
import { n, t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import type {Gesture, GestureDetail} from '@ionic/core'
import { IonAlert, IonApp, IonContent, IonLoading, IonPage } from '@ionic/vue'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { calculateMediaLayout } from './domain/mediaGridLayout.ts'
import { publicGalleryThemeStyle } from './domain/publicGalleryThemeStyle.ts'
import { PUBLIC_GALLERY_PAGE_SIZE, readPublicGalleryLocation, writePublicGalleryLocation } from './domain/publicGalleryNavigation.ts'
import { continuationStorageKey, layoutSessionStorageKey, loadPublicGalleryCompareIds, loadPublicGalleryContinuation, loadPublicGallerySavedView, loadPublicGallerySessionLayout, viewStorageKey } from './domain/publicGalleryPreferences.ts'
import { serialTask } from './domain/serialTask.ts'
import { galleryHasLogo, galleryTitleMode } from './domain/galleryTitlePresentation.ts'
import { downloadQuery } from './domain/publicDownloadOptions.ts'
import type { PublicDownloadPreset } from './domain/publicDownloadOptions.ts'
import type { CollaborationState, GuestIdentity, MediaItem, PublicGallery, PublicGalleryPage } from './publicTypes.ts'
import { useDeferredMutation } from './composables/useDeferredMutation.ts'
import { resumeGuestSession, useGuestRequest } from './composables/useGuestRequest.ts'
import { usePublicCollaborationIdentity } from './composables/usePublicCollaborationIdentity.ts'
import { usePublicAppearance } from './composables/usePublicAppearance.ts'
const PublicGalleryControls = defineAsyncComponent(() => import('./components/PublicGalleryControls.vue'))
const PublicLightbox = defineAsyncComponent(() => import('./components/PublicLightbox.vue'))
const PublicGalleryHeader = defineAsyncComponent(() => import('./components/PublicGalleryHeader.vue'))
const PublicGalleryOpener = defineAsyncComponent(() => import('./components/PublicGalleryOpener.vue'))
const PublicCompareLightTable = defineAsyncComponent(() => import('./components/PublicCompareLightTable.vue'))
const PublicStoryGallery = defineAsyncComponent(() => import('./components/PublicStoryGallery.vue'))
const PublicGuestDialog = defineAsyncComponent(() => import('./components/PublicGuestDialog.vue'))
const PublicCollaborationSheet = defineAsyncComponent(() => import('./components/PublicCollaborationSheet.vue'))
const ProgressiveImage = defineAsyncComponent(() => import('./components/ProgressiveImage.vue'))
const PublicMediaListDetails = defineAsyncComponent(() => import('./components/PublicMediaListDetails.vue'))
const PublicEventAlbumGrid = defineAsyncComponent(() => import('./components/PublicEventAlbumGrid.vue')), virtualGridResolved = ref(false)
const VirtualMediaGrid = defineAsyncComponent(() => import('./components/VirtualMediaGrid.vue').then(module => {
	virtualGridResolved.value = true
	return module
}))

const props = defineProps<{
	gallery: PublicGallery
	/** Overrides public endpoint resolution, e.g. for the design preview iframe. */
	endpointResolver?: (path: string) => string
	/** Runs the real UI without guest persistence, polling or mutations. */
	staticPreview?: { scene: 'gallery' | 'photo' | 'slideshow' | 'metadata' }
}>()
const isStaticPreview = !!props.staticPreview, publicEndpoint = (path: string) => props.endpointResolver?.(path) ?? generateUrl(`/apps/proofing_gallery/public/${props.gallery.token}/${path}`)
const items = ref<MediaItem[]>(props.gallery.initialPage?.items ?? [])
const story = ref<MediaItem[]>(props.gallery.initialPage?.s ?? [])
const total = ref(props.gallery.initialPage?.total ?? 0)
const loading = ref(!props.gallery.initialPage)
const error = ref(false)
const currentPath = ref(props.gallery.initialPage?.path ?? '')
const groups = ref(props.gallery.initialPage?.groups ?? {})
const indexState = ref(props.gallery.initialPage?.indexState ?? null)
const scope = ref(props.gallery.initialPage?.scope ?? null)
const settings = ref(props.gallery.initialPage?.gallery.settings ?? props.gallery.settings)
const title = ref(props.gallery.initialPage?.gallery.title ?? props.gallery.title)
const deliveryMode = ref(props.gallery.initialPage?.gallery.deliveryMode ?? props.gallery.deliveryMode ?? 'standard'), accentColor = computed(() => settings.value.presentation.accentColor || '#E85D4A')
const { visitorPreference, effectiveTheme, setVisitorPreference } = usePublicAppearance(computed(() => settings.value.presentation.theme), accentColor)
const appearancePreference = computed({ get: () => visitorPreference.value, set: setVisitorPreference })
const pageStyle = computed(() => publicGalleryThemeStyle(settings.value))

const mediaItems = computed(() => items.value.filter(item => !item.folder))
const eventAlbumRoot = computed(() => deliveryMode.value === 'event' && currentPath.value === '' && scope.value?.viewMode === 'folder'), openerTotalLabel = computed(() => eventAlbumRoot.value ? n('proofing_gallery', '%n album', '%n albums', total.value) : undefined)
const headerHeroUrl = computed(() => settings.value.presentation.heroFileId ? assetUrl('hero') : null)
const headerLogoUrl = computed(() => galleryHasLogo(settings.value.presentation) ? assetUrl('logo') : null)
const activeIndex = ref<number | null>(props.staticPreview?.scene && props.staticPreview.scene !== 'gallery' ? 0 : null)
const activeOpener = ref<HTMLElement | null>(null)
const selectedIds = ref<number[]>([])
const selectionMode = ref(false)
const compareIds = ref<number[]>(!isStaticPreview && settings.value.mode === 'collaboration' ? loadPublicGalleryCompareIds(props.gallery.token) : [])
const compareOpen = ref(false)
const compareItems = computed(() => compareIds.value.map(id => mediaItems.value.find(item => item.id === id)).filter((item): item is MediaItem => !!item))
let collaborationTimer: number | undefined
const { guest, collaboration, hydratedIds: collaborationHydratedIds, nonce, restoreIdentity, clearIdentity } = usePublicCollaborationIdentity(props.gallery.token)
const joining = ref(false)
const collaborationError = ref('')
const galleryDownloadBusy = ref(false)
const galleryDownloadError = ref('')
const [selectionName, selectionMessage] = [ref(''), ref('')]
const [downloadPreset, downloadWatermark] = [ref<PublicDownloadPreset>('original'), ref(false)]
const savingSelection = ref(false)
const guestDialogOpen = ref(false)
const review = ref(props.gallery.review ?? { enabled: false, dueDate: null, rules: { minimum: 0, maximum: 0 }, progress: null, current: null })
const savedView = isStaticPreview ? null : loadPublicGallerySavedView(props.gallery.token)
if (!isStaticPreview) localStorage.removeItem(`proofing-gallery-layout:${props.gallery.token}`)
const fallbackLayout = (isStaticPreview ? null : loadPublicGallerySessionLayout(props.gallery.token))
	?? settings.value.presentation.layout
	?? 'grid'
const initialLocation = readPublicGalleryLocation(new URL(window.location.href), {
	search: savedView?.search ?? '',
	sortBy: savedView?.sortBy ?? settings.value.navigation.sortBy,
	sortDirection: savedView?.sortDirection ?? settings.value.navigation.sortDirection,
	groupBy: savedView?.groupBy === 'folder' && !settings.value.navigation?.recursive
		? settings.value.navigation.groupBy
		: savedView?.groupBy ?? settings.value.navigation.groupBy,
	layout: fallbackLayout,
})
currentPath.value = initialLocation.path
const search = ref(initialLocation.search)
const sortBy = ref(initialLocation.sortBy)
const sortDirection = ref(initialLocation.sortDirection)
const groupBy = ref(initialLocation.groupBy)
const layout = ref<'grid' | 'masonry' | 'list' | 'story'>(initialLocation.layout)
const lightboxMediaItems = computed(() => layout.value === 'story' ? mediaItems.value.concat(story.value) : mediaItems.value)
const currentPage = ref(initialLocation.page)
const pageCount = ref(props.gallery.initialPage?.pageCount ?? Math.max(1, Math.ceil(total.value / PUBLIC_GALLERY_PAGE_SIZE)))
const activePanel = ref<'menu' | 'search' | 'view' | 'pages' | 'download' | 'selection' | null>(null)
const searchOpen = ref(false)
const collaborationSheetOpen = ref(false)
const mediaDimensions = ref<Record<number, { width: number; height: number }>>({})
// Panel mode changes only on phone-sized viewports. Narrow desktop windows keep
// centered dialogs and floating annotation controls instead of mobile sheets.
const mobileViewportQuery = window.matchMedia('(max-width: 520px)')
const mobileViewport = ref(mobileViewportQuery.matches)
const viewportWidth = ref(window.innerWidth)
let searchTimer: number | undefined
let scrollTimer: number | undefined
const contentRef = ref<InstanceType<typeof IonContent> | null>(null)
const scrollElement = ref<HTMLElement | null>(null)
let pageSwipeGesture: Gesture | undefined
let applyingHistory = false
const continuation = ref(isStaticPreview ? null : loadPublicGalleryContinuation(props.gallery.token))
const continueVisible = ref(!!(continuation.value && continuation.value.scrollY > 240))
let pageController: AbortController | undefined
const downloadScope = computed(() => settings.value.delivery.downloadScope)
function galleryControlProps() {
	return {
		total: total.value,
		page: currentPage.value,
		pageCount: pageCount.value,
		mobile: mobileViewport.value,
		panel: activePanel.value,
		canFolderGroup: scope.value?.viewMode === 'recursive',
		hasStory: !!settings.value.presentation.story.sections.length,
		downloadScope: downloadScope.value,
		selectedCount: selectedIds.value.length,
		contactSheet: settings.value.delivery?.contactSheet !== false,
		canSelect: !eventAlbumRoot.value && (['selection', 'all'].includes(settings.value.delivery.downloadScope) || (settings.value.mode === 'collaboration' && settings.value.review?.selections !== false)),
		canCompare: settings.value.mode === 'collaboration' && selectedIds.value.length >= 2,
		canSaveSelection: settings.value.mode === 'collaboration' && settings.value.review?.selections !== false,
		savingSelection: savingSelection.value,
		theme: effectiveTheme.value,
		collaboration: settings.value.mode === 'collaboration',
		albumRoot: eventAlbumRoot.value,
	}
}
const tileGap = computed(() => mobileViewport.value
	? settings.value.presentation.tileGap === 'wide' ? 6 : settings.value.presentation.tileGap === 'tight' ? 1 : 2
	: settings.value.presentation.tileGap === 'wide' ? 12 : settings.value.presentation.tileGap === 'tight' ? 2 : 5)
const tileMinWidth = computed(() => mobileViewport.value
	? settings.value.presentation.tileSize === 'large' ? 156 : settings.value.presentation.tileSize === 'small' ? 88 : 112
	: settings.value.presentation.tileSize === 'large' ? 300 : settings.value.presentation.tileSize === 'small' ? 150 : 190)
const targetRowHeight = computed(() => mobileViewport.value
	? settings.value.presentation.tileSize === 'large' ? 174 : settings.value.presentation.tileSize === 'small' ? 104 : 132
	: settings.value.presentation.tileSize === 'large' ? 300 : settings.value.presentation.tileSize === 'small' ? 170 : 230)
const gridPlaceholderStyle = computed(() => {
	if (virtualGridResolved.value) return undefined
	const horizontalPadding = Math.max(8, Math.min(viewportWidth.value * 0.02, 28)) * 2
	const available = Math.max(1, viewportWidth.value - horizontalPadding)
	const grid = calculateMediaLayout({
		containerWidth: available,
		aspectRatios: items.value.map(itemRatio),
		mode: layout.value === 'story' ? 'grid' : layout.value,
		minItemWidth: tileMinWidth.value,
		gap: tileGap.value,
		targetRowHeight: targetRowHeight.value,
		listRowHeight: mobileViewport.value ? 132 : 172,
		singleColumn: false,
	})
	return { minHeight: `${grid.totalHeight}px` }
})

// The gallery prop is immutable on the public page; the design preview
// iframe mutates it to stream unsaved settings changes into the app.
watch(() => props.gallery, gallery => {
	const page = gallery.initialPage
	if (!page) return
	items.value = page.items; total.value = page.total
	settings.value = page.gallery.settings ?? gallery.settings; title.value = page.gallery.title ?? gallery.title
	deliveryMode.value = page.gallery.deliveryMode ?? gallery.deliveryMode ?? 'standard'
	if (isStaticPreview) layout.value = settings.value.presentation.layout
}, { deep: true })

watch(() => props.staticPreview?.scene, async scene => { if (scene === 'gallery') await nextTick(); activeIndex.value = scene && scene !== 'gallery' && mediaItems.value.length > 0 ? 0 : null })

watch([layout, sortBy, sortDirection, groupBy, search], () => {
	if (isStaticPreview) return
	sessionStorage.setItem(layoutSessionStorageKey(props.gallery.token), layout.value)
	localStorage.setItem(viewStorageKey(props.gallery.token), JSON.stringify({
		sortBy: sortBy.value,
		sortDirection: sortDirection.value,
		groupBy: groupBy.value,
		search: search.value,
	}))
})

onMounted(async () => {
	const contentElement = contentRef.value?.$el as HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }
	scrollElement.value = await contentElement?.getScrollElement?.() ?? null
	if (isStaticPreview) {
		mobileViewportQuery.addEventListener('change', onMobileViewportChange); window.addEventListener('resize', onViewportResize, { passive: true })
		return
	}
	const { createGesture } = await import('@ionic/core')
	if (scrollElement.value) {
		pageSwipeGesture = createGesture({
			el: scrollElement.value,
			gestureName: 'public-gallery-page-swipe',
			direction: 'x',
			threshold: 24,
			maxAngle: 25,
			canStart: detail => canStartPageSwipe(detail),
			onEnd: detail => finishPageSwipe(detail),
		})
		pageSwipeGesture.enable()
	}
	const initialPage = props.gallery.initialPage
	const initialMatches = initialPage
		&& currentPage.value === (initialPage.page ?? 1)
		&& currentPath.value === initialPage.path
		&& !savedView
		&& !initialLocation.photoId
	if (initialMatches) deferCollaborationInitialization()
	else loadPage(currentPage.value, initialLocation.photoId).then(() => deferCollaborationInitialization())
	document.addEventListener('visibilitychange', onVisibilityChange)
	mobileViewportQuery.addEventListener('change', onMobileViewportChange)
	window.addEventListener('resize', onViewportResize, { passive: true })
	window.addEventListener('popstate', onHistoryChange)
})
onBeforeUnmount(() => {
	document.removeEventListener('visibilitychange', onVisibilityChange); mobileViewportQuery.removeEventListener('change', onMobileViewportChange)
	window.removeEventListener('resize', onViewportResize); window.removeEventListener('popstate', onHistoryChange)
	window.clearInterval(collaborationTimer); window.clearTimeout(searchTimer); window.clearTimeout(scrollTimer)
	pageController?.abort(); pageSwipeGesture?.destroy(); deferredMutation.cancel()
})

function canStartPageSwipe(detail: GestureDetail): boolean {
	if (pageCount.value <= 1 || loading.value || activeIndex.value !== null || compareOpen.value || activePanel.value !== null) return false
	const target = detail.event.target
	if (!(target instanceof Element)) return true
	return !target.closest('input, textarea, select, ion-searchbar, ion-segment, ion-range, [contenteditable="true"]')
}

function finishPageSwipe(detail: GestureDetail) {
	if (Math.abs(detail.deltaX) < 72 && Math.abs(detail.velocityX) < 0.35) return
	if (detail.deltaX < 0 && currentPage.value < pageCount.value) void navigateToPage(currentPage.value + 1)
	if (detail.deltaX > 0 && currentPage.value > 1) void navigateToPage(currentPage.value - 1)
}

function onMobileViewportChange(event: MediaQueryListEvent) {
	mobileViewport.value = event.matches
	if (!event.matches) activePanel.value = null
}

function onViewportResize() { viewportWidth.value = window.innerWidth }

function locationState(photoId: number | null = null) {
	return {
		page: currentPage.value,
		path: currentPath.value,
		search: search.value,
		sortBy: sortBy.value,
		sortDirection: sortDirection.value,
		groupBy: groupBy.value,
		layout: layout.value,
		photoId,
	}
}

function updateLocation(mode: 'push' | 'replace', photoId: number | null = null, state: Record<string, unknown> = {}) {
	const url = writePublicGalleryLocation(new URL(window.location.href), locationState(photoId))
	window.history[mode === 'push' ? 'pushState' : 'replaceState'](state, '', url)
}

async function onHistoryChange() {
	applyingHistory = true
	activePanel.value = null
	const location = readPublicGalleryLocation(new URL(window.location.href), locationState())
	const reload = location.page !== currentPage.value
		|| location.path !== currentPath.value
		|| location.search !== search.value
		|| location.sortBy !== sortBy.value
		|| location.sortDirection !== sortDirection.value
		|| location.groupBy !== groupBy.value
	currentPage.value = location.page
	currentPath.value = location.path
	search.value = location.search
	sortBy.value = location.sortBy
	sortDirection.value = location.sortDirection
	groupBy.value = location.groupBy
	layout.value = location.layout
	if (reload) await loadPage(location.page, location.photoId)
	else if (location.photoId) openPhotoFromLocation(location.photoId)
	else {
		activeIndex.value = null
		activeOpener.value = null
	}
	applyingHistory = false
}

function setPanel(panel: 'menu' | 'search' | 'view' | 'pages' | 'download' | 'selection' | null) {
	activePanel.value = panel
}

function deferCollaborationInitialization() {
	requestAnimationFrame(() => requestAnimationFrame(() => initializeCollaboration()))
}

async function loadPage(page: number, focusId: number | null = null) {
	pageController?.abort()
	const controller = new AbortController()
	pageController = controller
	loading.value = true
	try {
		const query = new URLSearchParams({
			limit: String(PUBLIC_GALLERY_PAGE_SIZE),
			page: String(Math.max(1, page)),
			path: currentPath.value,
			search: search.value,
			sortBy: sortBy.value,
			sortDirection: sortDirection.value,
			groupBy: groupBy.value,
		})
		if (focusId) query.set('focusId', String(focusId))
		const response = await fetch(publicEndpoint(`gallery?${query}`), {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' },
			signal: controller.signal,
		})
		if (!response.ok) {
			throw new Error('Gallery request failed')
		}
		const payload = await response.json() as PublicGalleryPage
		applyGalleryPage(payload)
		await nextTick()
		if (focusId) openPhotoFromLocation(focusId)
	} catch (exception) {
		if (exception instanceof DOMException && exception.name === 'AbortError') return
		error.value = true
	} finally {
		if (pageController === controller) {
			loading.value = false
		}
	}
}

function applyGalleryPage(payload: PublicGalleryPage) {
	items.value = payload.items
	story.value = payload.s
	total.value = payload.total
	settings.value = payload.gallery.settings
	title.value = payload.gallery.title
	deliveryMode.value = payload.gallery.deliveryMode
	currentPath.value = payload.path
	currentPage.value = payload.page
	pageCount.value = payload.pageCount
	groups.value = payload.groups
	indexState.value = payload.indexState
	scope.value = payload.scope
	if (collaboration.value !== null && settings.value.mode === 'collaboration') void loadCollaboration()
}

function onContentScroll(event: CustomEvent<{ scrollTop: number }>) {
	if (isStaticPreview) return
	const currentScrollY = event.detail.scrollTop
	window.clearTimeout(scrollTimer)
	scrollTimer = window.setTimeout(() => {
		const value = { scrollY: currentScrollY, fileId: activeIndex.value === null ? continuation.value?.fileId ?? null : lightboxMediaItems.value[activeIndex.value]?.id ?? null, path: currentPath.value, page: currentPage.value }
		continuation.value = value
		localStorage.setItem(continuationStorageKey(props.gallery.token), JSON.stringify(value))
	}, 80)
}

async function continueViewing() {
	const saved = continuation.value
	if (!saved) return
	continueVisible.value = false
	if (saved.path !== currentPath.value || saved.page !== currentPage.value) {
		currentPath.value = saved.path
		currentPage.value = saved.page
		updateLocation('replace', saved.fileId)
		await loadPage(saved.page, saved.fileId)
		await nextTick()
	}
	requestAnimationFrame(() => scrollElement.value?.scrollTo({ top: saved.scrollY, behavior: 'smooth' }))
	if (saved.fileId) {
		const index = mediaItems.value.findIndex(item => item.id === saved.fileId)
		if (index >= 0) {
			await nextTick()
			activeIndex.value = index
		}
	}
}
async function shareGallery() {
	const { sharePublicGallery } = await import('./domain/publicGalleryActions.ts')
	await sharePublicGallery(title.value)
}

async function initializeCollaboration() {
	if (settings.value.mode !== 'collaboration') return
	await resumeGuestIdentity()
	await loadCollaboration()
	if (guest.value && nonce.value) guestDialogOpen.value = false
	if (guest.value && nonce.value && deferredMutation.hasPending()) await deferredMutation.complete()
	startCollaborationPolling()
}

const resumeGuestIdentity = () => resumeGuestSession<GuestIdentity>(publicEndpoint('session'), restoreIdentity)

const requestAsGuest = useGuestRequest({
	endpoint: publicEndpoint,
	nonce: () => nonce.value,
	clearIdentity,
	resumeIdentity: resumeGuestIdentity,
})

function startCollaborationPolling() {
	window.clearInterval(collaborationTimer)
	if (!document.hidden) {
		collaborationTimer = window.setInterval(() => loadCollaboration(), 8000)
	}
}

function onVisibilityChange() {
	if (settings.value.mode !== 'collaboration') return
	if (!document.hidden) loadCollaboration()
	startCollaborationPolling()
}

async function joinCollaboration(identity: { displayName: string; email: string }) {
	joining.value = true
	collaborationError.value = ''
	try {
		const response = await fetch(publicEndpoint('session'), {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ displayName: identity.displayName, email: identity.email || null }),
		})
		const payload = await response.json() as { guest?: GuestIdentity, nonce?: string, message?: string }
		if (!response.ok || !payload.guest || !payload.nonce) {
			throw new Error(t('proofing_gallery', 'Could not start review session'))
		}
		restoreIdentity(payload.guest, payload.nonce)
		await loadCollaboration()
		guestDialogOpen.value = false
		if (deferredMutation.hasPending()) await deferredMutation.complete()
	} catch (exception) {
		collaborationError.value = exception instanceof Error ? exception.message : String(exception)
	} finally {
		joining.value = false
	}
}

async function performCollaborationLoad(forceHydration = false): Promise<void> {
	try {
		const visibleIds = mediaItems.value.slice(0, 200).map(item => item.id); const unhydratedIds = visibleIds.filter(id => !collaborationHydratedIds.has(id))
		const hydration = forceHydration || unhydratedIds.length > 0
		const query = new URLSearchParams({ cursor: String(hydration ? 0 : collaboration.value?.cursor ?? 0), fileIds: (hydration ? unhydratedIds : visibleIds).join(',') })
		const response = await fetch(publicEndpoint(`collaboration?${query}`), { headers: { Accept: 'application/json' } })
		if (!response.ok) throw response; const payload = await response.json() as CollaborationState | { unchanged: true; cursor: number }
		if (!('unchanged' in payload)) {
			if (payload.reset === true) {
				collaboration.value = null; collaborationHydratedIds.clear()
				return performCollaborationLoad(true)
			}
			const { mergeCollaborationState } = await import('./domain/collaboration.ts')
			collaboration.value = collaboration.value === null ? payload : mergeCollaborationState(collaboration.value, payload, hydration ? unhydratedIds : [])
			for (const id of unhydratedIds) collaborationHydratedIds.add(id)
		}
		collaborationError.value = ''
	} catch {
		collaborationError.value = t('proofing_gallery', 'Review updates are temporarily unavailable.')
	}
}

const loadCollaboration = serialTask(async () => {
	if (settings.value.mode === 'collaboration') await performCollaborationLoad()
})

async function mutateCollaboration(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
	return deferredMutation.mutate(path, method, body)
}

function cancelPendingMutation() {
	deferredMutation.cancel()
	guestDialogOpen.value = false
}

async function performMutation(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, mayRecover = true): Promise<boolean> {
	try {
		const response = await requestAsGuest(`collaboration/${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		}, mayRecover)
		if (!response.ok) {
			const payload = await response.json().catch(() => ({})) as { code?: string; message?: string }
			if (response.status === 401 || payload.code === 'invalid_nonce') {
				if (!deferredMutation.isCompleting()) return deferredMutation.defer(path, method, body)
			}
			collaborationError.value = t('proofing_gallery', 'The review change could not be saved.')
			return false
		}
		await loadCollaboration()
		return true
	} catch {
		collaborationError.value = t('proofing_gallery', 'The review change could not be saved.')
		return false
	}
}

const deferredMutation = useDeferredMutation(
	() => !!(guest.value && nonce.value),
	() => { guestDialogOpen.value = true },
	performMutation,
)

function applyView() {
	error.value = false
	currentPage.value = 1
	updateLocation('push')
	loadPage(1)
}

function queueSearch() {
	window.clearTimeout(searchTimer)
	searchTimer = window.setTimeout(() => {
		currentPage.value = 1
		updateLocation('replace')
		loadPage(1)
	}, 250)
}

async function navigateToPage(page: number) {
	const target = Math.max(1, Math.min(pageCount.value, page))
	if (target === currentPage.value) {
		setPanel(null)
		scrollToGrid()
		return
	}
	activePanel.value = null
	currentPage.value = target
	updateLocation('push')
	await loadPage(target)
	await nextTick()
	scrollToGrid()
}

function scrollToGrid() {
	const grid = document.querySelector<HTMLElement>('.media-grid-shell')
	const scroller = scrollElement.value
	if (!grid || !scroller) return
	const top = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12
	scroller.scrollTo({ top, behavior: 'smooth' })
}

async function saveSelection() {
	if (!selectionName.value.trim() || selectedIds.value.length === 0) return
	savingSelection.value = true
	if (await mutateCollaboration('selections', 'POST', {
		name: selectionName.value,
		message: selectionMessage.value,
		fileIds: selectedIds.value,
	})) {
		selectionName.value = ''
		selectionMessage.value = ''
		selectedIds.value = []
		selectionMode.value = false
		activePanel.value = null
	}
	savingSelection.value = false
}

function previewUrl(item: Pick<MediaItem, 'id'>, width = 900, height = 900, mode: 'cover' | 'fit' = 'cover'): string {
	return publicEndpoint(`media/${item.id}/preview?x=${width}&y=${height}&mode=${mode}`)
}

function tilePreviewUrl(item: MediaItem): string {
	return previewUrl(item, 900, 900, 'fit')
}

function itemRatio(item: MediaItem): number {
	const dimensions = mediaDimensions.value[item.id]
	const width = dimensions?.width ?? item.width ?? item.metadata?.width ?? 0
	const height = dimensions?.height ?? item.height ?? item.metadata?.height ?? 0
	if (width > 0 && height > 0) return width / height
	return item.mimeType.startsWith('video/') ? 16 / 9 : 4 / 3
}

function rememberDimensions(item: MediaItem, event: Event) {
	const image = event.currentTarget as HTMLImageElement
	if (!image.naturalWidth || !image.naturalHeight) return
	mediaDimensions.value = {
		...mediaDimensions.value,
		[item.id]: { width: image.naturalWidth, height: image.naturalHeight },
	}
}

function assetUrl(kind: 'logo' | 'hero'): string {
	return publicEndpoint(`asset/${kind}`)
}

function streamUrl(item: MediaItem): string {
	return publicEndpoint(`media/${item.id}/stream`)
}

const downloadUrl = (item: MediaItem) => publicEndpoint(`media/${item.id}/download?${downloadQuery(downloadPreset.value, downloadWatermark.value)}`)
const selectionUrl = (kind: 'download/selection' | 'contact-sheet') => publicEndpoint(`${kind}?${downloadQuery(kind === 'download/selection' ? downloadPreset.value : 'original', kind === 'download/selection' && downloadWatermark.value, selectedIds.value)}`)

async function startDownload(url: string, newTab = false) {
	const { triggerPublicDownload } = await import('./domain/publicGalleryActions.ts')
	triggerPublicDownload(url, newTab)
	activePanel.value = null
}

type GalleryDownloadStatus = { available: boolean, reason: 'empty' | 'too_many_files' | 'too_large' | 'index_incomplete' | null, fileCount: number, totalBytes: number, maxFiles: number, maxBytes: number }

async function downloadEntireGallery() {
	activePanel.value = null
	galleryDownloadError.value = ''
	galleryDownloadBusy.value = true
	try {
		const response = await fetch(publicEndpoint('download/gallery/status'), { headers: { Accept: 'application/json' } })
		if (!response.ok) throw new Error()
		const status = await response.json() as GalleryDownloadStatus
		if (!status.available) {
			galleryDownloadError.value = status.reason === 'too_many_files'
				? t('proofing_gallery', 'This gallery contains more than {limit} downloadable files.', { limit: status.maxFiles })
				: status.reason === 'too_large'
					? t('proofing_gallery', 'This gallery is larger than the configured download limit.')
					: status.reason === 'index_incomplete'
						? t('proofing_gallery', 'This gallery is still being prepared. Try the download again later.')
						: t('proofing_gallery', 'This gallery does not contain downloadable files.')
			return
		}
		await startDownload(publicEndpoint('download/gallery'))
	} catch {
		galleryDownloadError.value = t('proofing_gallery', 'The gallery download could not be prepared.')
	} finally {
		galleryDownloadBusy.value = false
	}
}

function selectionExportUrl(selectionId: string, format: 'csv' | 'plain' | 'search', fields: string[] = []): string {
	const url = new URL(publicEndpoint(`collaboration/selections/${selectionId}/export`), window.location.origin)
	url.searchParams.set('format', format)
	if (fields.length) url.searchParams.set('fields', fields.join(','))
	return url.toString()
}

function toggleSelection(item: MediaItem) {
	selectedIds.value = selectedIds.value.includes(item.id)
		? selectedIds.value.filter(id => id !== item.id)
		: [...selectedIds.value, item.id]
}

function startSelectionMode() {
	selectionMode.value = true
	setPanel(null)
}

function finishSelectionMode() {
	selectionMode.value = false
	selectedIds.value = []
}

function openSelectionCompare() {
	if (settings.value.mode !== 'collaboration' || selectedIds.value.length < 2) return
	compareIds.value = selectedIds.value.slice(0, 4)
	if (!isStaticPreview) localStorage.setItem(`proofing-gallery-compare:${props.gallery.token}`, JSON.stringify(compareIds.value))
	compareOpen.value = true
}

function toggleCompare(item: MediaItem) {
	if (settings.value.mode !== 'collaboration') return
	compareIds.value = compareIds.value.includes(item.id)
		? compareIds.value.filter(id => id !== item.id)
		: compareIds.value.length < 4 ? [...compareIds.value, item.id] : compareIds.value
	if (!isStaticPreview) localStorage.setItem(`proofing-gallery-compare:${props.gallery.token}`, JSON.stringify(compareIds.value))
}

function openItem(item: MediaItem, event?: MouseEvent) {
	activePanel.value = null
	if (selectionMode.value && !item.folder) {
		toggleSelection(item)
		return
	}
	if (!item.folder) {
		activeOpener.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
		activeIndex.value = lightboxMediaItems.value.findIndex(media => media.id === item.id)
		continuation.value = { scrollY: scrollElement.value?.scrollTop ?? 0, fileId: item.id, path: currentPath.value, page: currentPage.value }
		if (!isStaticPreview) {
			localStorage.setItem(continuationStorageKey(props.gallery.token), JSON.stringify(continuation.value))
			updateLocation('push', item.id, { proofingGalleryPhoto: true })
		}
		return
	}
	currentPath.value = item.relativePath ?? [currentPath.value, item.name].filter(Boolean).join('/')
	currentPage.value = 1
	error.value = false
	updateLocation('push')
	loadPage(1)
}

function openPhotoFromLocation(fileId: number) {
	const index = lightboxMediaItems.value.findIndex(item => item.id === fileId)
	if (index < 0) return
	activeIndex.value = index
}

function onLightboxActive(item: MediaItem) {
	if (!applyingHistory) updateLocation('replace', item.id, { proofingGalleryPhoto: true })
}

function closeLightbox() {
	if (!applyingHistory && new URL(window.location.href).searchParams.has('photo')) {
		window.history.back()
		return
	}
	activeIndex.value = null
	activeOpener.value = null
}

function mediaAccessibleName(item: MediaItem): string {
	const action = item.folder
		? t('proofing_gallery', 'Open folder {name}', { name: item.name })
		: t('proofing_gallery', 'Open {name}', { name: item.name })
	const likeCount = collaboration.value?.likes[item.id]?.count ?? 0
	return likeCount > 0
		? `${action}. ${n('proofing_gallery', '%n like', '%n likes', likeCount)}`
		: action
}

function startsGroup(item: MediaItem, index: number): boolean {
	return groupBy.value !== 'none' && (index === 0 || items.value[index - 1]?.group !== item.group)
}

function groupLabel(group: string | undefined): string {
	if (group === 'image') return t('proofing_gallery', 'Images')
	if (group === 'video') return t('proofing_gallery', 'Videos')
	if (group === 'root') return t('proofing_gallery', 'Main folder')
	return group || t('proofing_gallery', 'Other')
}

function upOneLevel() {
	currentPath.value = currentPath.value.split('/').slice(0, -1).join('/')
	currentPage.value = 1
	error.value = false
	updateLocation('push')
	loadPage(1)
}
</script>

<template>
	<IonApp class="public-gallery-app"
		:class="[
			`public-gallery-app--theme-${effectiveTheme}`,
			{ 'ion-palette-dark': effectiveTheme === 'dark' },
		]"
		:style="pageStyle">
		<IonPage>
			<PublicGalleryHeader v-if="activeIndex === null && !compareOpen"
				v-model:search="search"
				v-model:appearance="appearancePreference"
				:class="`logo-${settings.presentation.logoBackground}`"
				:title="title"
				:title-mode="galleryTitleMode(settings.presentation)"
				:studio-name="settings.presentation.instanceStudioName"
				:logo-url="headerLogoUrl"
				:page="currentPage"
				:page-count="pageCount"
				:searching="searchOpen"
				:selection-mode="selectionMode"
				:selected-count="selectedIds.length"
				:can-download="downloadScope !== 'none'"
				:can-compare="settings.mode === 'collaboration' && selectedIds.length >= 2"
				:collaboration="settings.mode === 'collaboration'"
				:configured-theme="settings.presentation.theme"
				:effective-theme="effectiveTheme"
				:search-target="eventAlbumRoot ? 'albums' : 'photos'"
				@search="queueSearch"
				@toggle-search="searchOpen = !searchOpen"
				@share="shareGallery"
				@download="selectionMode && selectedIds.length ? startDownload(selectionUrl('download/selection')) : setPanel('download')"
				@compare="openSelectionCompare"
				@more="setPanel('menu')"
				@pages="setPanel('pages')"
				@navigate="navigateToPage"
				@collaboration="collaborationSheetOpen = true"
				@cancel-selection="finishSelectionMode" />
			<IonContent ref="contentRef" :scroll-events="true" @ion-scroll="onContentScroll">
				<div
					class="public-gallery"
					:class="[
						`public-gallery--theme-${effectiveTheme}`,
						`public-gallery--motion-${settings.presentation.motionPreset}`,
						`public-gallery--layout-${layout}`,
						`public-gallery--tiles-${settings.presentation.tileSize}`,
						`public-gallery--gap-${settings.presentation.tileGap}`,
						`public-gallery--radius-${settings.presentation.tileRadius}`,
					]"
					:style="pageStyle">
					<PublicGalleryOpener
						:title="title"
						:total="total"
						:total-label="openerTotalLabel"
						:settings="settings"
						:hero-url="headerHeroUrl" />
					<div v-if="continueVisible" class="continuation-banner" role="status">
						<span>{{ t('proofing_gallery', 'Continue where you left off?') }}</span>
						<button type="button" @click="continueViewing">
							{{ t('proofing_gallery', 'Continue viewing') }}
						</button>
						<button type="button" :aria-label="t('proofing_gallery', 'Dismiss')" @click="continueVisible = false">
							×
						</button>
					</div>

					<section class="public-gallery__content" :aria-busy="loading">
						<p v-if="collaborationError" class="collaboration-error" role="status">
							{{ collaborationError }}
						</p>
						<PublicGalleryControls
							key="gallery-chrome"
							v-model:search="search"
							v-model:sort-by="sortBy"
							v-model:sort-direction="sortDirection"
							v-model:group-by="groupBy"
							v-model:layout="layout"
							v-model:selection-name="selectionName"
							v-model:selection-message="selectionMessage"
							v-model:download-preset="downloadPreset"
							v-model:download-watermark="downloadWatermark"
							v-bind="galleryControlProps()"
							:hide-chrome="activeIndex !== null || compareOpen"
							@apply="applyView"
							@search="queueSearch"
							@navigate="navigateToPage"
							@update:panel="setPanel"
							@start-selection="startSelectionMode"
							@collaboration="collaborationSheetOpen = true"
							@select-downloads="startSelectionMode"
							@download-gallery="downloadEntireGallery"
							@download-selection="startDownload(selectionUrl('download/selection'))"
							@contact-sheet="startDownload(selectionUrl('contact-sheet'), true)"
							@compare-selection="openSelectionCompare"
							@save-selection="saveSelection" />

						<div v-if="currentPath" class="public-gallery__summary">
							<p>
								<button v-if="currentPath" type="button" @click="upOneLevel">
									←
								</button>
								<span v-if="currentPath">{{ currentPath }}</span>
							</p>
						</div>
						<div v-if="groupBy !== 'none' && Object.keys(groups).length" class="gallery-group-summary" :aria-label="t('proofing_gallery', 'Gallery groups')">
							<span v-for="(count, group) in groups" :key="group">
								<strong>{{ groupLabel(group) }}</strong>{{ count }}
							</span>
						</div>
						<p v-if="indexState?.limitReached" class="gallery-index-warning" role="status">
							{{ t('proofing_gallery', 'This recursive gallery reached its media index limit. Ask the gallery owner to raise the limit or narrow the link scope.') }}
						</p>
						<p v-else-if="scope?.viewMode === 'recursive' && indexState?.state === 'unindexed'" class="gallery-index-warning" role="status">
							{{ t('proofing_gallery', 'This recursive gallery is still being indexed. Reload shortly or ask the gallery owner to rebuild the media index.') }}
						</p>
						<div v-if="loading" class="public-gallery__skeleton" :aria-label="t('proofing_gallery', 'Loading gallery')">
							<span v-for="index in 12" :key="index" />
						</div>

						<div v-else-if="error" class="public-gallery__message" role="alert">
							<h2>{{ t('proofing_gallery', 'The gallery could not be loaded') }}</h2>
							<button type="button" @click="loadPage(currentPage)">
								{{ t('proofing_gallery', 'Try again') }}
							</button>
						</div>

						<div v-else-if="items.length === 0" class="public-gallery__message">
							<h2>{{ t('proofing_gallery', 'This gallery is empty') }}</h2>
							<p>{{ t('proofing_gallery', 'New photographs will appear here automatically.') }}</p>
						</div>

						<PublicEventAlbumGrid v-else-if="eventAlbumRoot"
							:items="items"
							:preview-url="previewUrl"
							@open="openItem" />

						<PublicStoryGallery
							v-else-if="layout === 'story'"
							:sections="settings.presentation.story.sections"
							:show-all-media="settings.presentation.story.showAllMedia"
							:show-filenames="settings.presentation.showFilenames"
							:items="lightboxMediaItems"
							:preview-url="previewUrl"
							:selecting="selectionMode"
							:selected-ids="selectedIds"
							@open="openItem" />

						<div v-else class="media-grid-shell" :style="gridPlaceholderStyle">
							<VirtualMediaGrid
								class="media-grid"
								:class="[
									`media-grid--${layout}`,
								]"
								:items="items"
								:mode="layout"
								:min-item-width="tileMinWidth"
								:target-row-height="targetRowHeight"
								photographic
								:gap="tileGap"
								:item-dimensions="mediaDimensions"
								:scroll-element="scrollElement"
								:aria-label="t('proofing_gallery', 'Gallery files')">
								<template #default="{ item, index }">
									<article
										class="media-tile"
										:class="{ 'media-tile--folder': item.folder, 'media-tile--selected': selectedIds.includes(item.id), 'media-tile--lead': item.id === mediaItems[0]?.id }">
										<span v-if="startsGroup(item, index)" class="media-tile__group">{{ groupLabel(item.group) }}</span>
										<button
											class="media-tile__open"
											type="button"
											:aria-label="mediaAccessibleName(item)"
											@click="openItem(item, $event)">
											<ProgressiveImage
												v-if="item.mimeType.startsWith('image/')"
												:src="tilePreviewUrl(item)"
												class="media-tile__image"
												direct
												:priority="item.id === mediaItems[0]?.id"
												@load="rememberDimensions(item, $event)" />
											<span v-else-if="item.folder" class="media-tile__folder" aria-hidden="true" />
											<span v-else class="media-tile__video" aria-hidden="true">▶</span>
											<span v-if="layout === 'list'" class="media-tile__details" aria-hidden="true">
												<strong v-if="item.folder || settings.presentation.showFilenames">{{ item.name }}</strong>
												<span><PublicMediaListDetails :item="item" :dimensions="mediaDimensions" /></span>
											</span>
											<span v-else-if="item.folder || settings.presentation.showFilenames" class="media-tile__name" aria-hidden="true">
												{{ item.name }}
											</span>
											<span
												v-if="settings.mode === 'collaboration' && !item.folder && collaboration?.likes[item.id]?.count"
												class="media-tile__likes"
												aria-hidden="true">
												♥ {{ collaboration.likes[item.id].count }}
											</span>
										</button>
										<button
											v-if="selectionMode && !item.folder"
											class="media-tile__select"
											:class="{ 'media-tile__select--active': selectedIds.includes(item.id) }"
											type="button"
											:aria-checked="selectedIds.includes(item.id)"
											role="checkbox"
											:aria-label="t('proofing_gallery', 'Select {name}', { name: item.name })"
											@click="toggleSelection(item)">
											{{ selectedIds.includes(item.id) ? '✓' : '' }}
										</button>
									</article>
								</template>
							</VirtualMediaGrid>
						</div>
					</section>

					<PublicCollaborationSheet v-if="settings.mode === 'collaboration'"
						:open="collaborationSheetOpen"
						:mobile="mobileViewport"
						:guest="guest"
						:review="review"
						:nonce="nonce"
						:token="gallery.token"
						:private-feedback="collaboration?.policy.visibility === 'private'"
						:allow-uploads="settings.delivery.guestUploads"
						:dialog-open="guestDialogOpen"
						:request="requestAsGuest"
						@dismiss="collaborationSheetOpen = false"
						@identify="guestDialogOpen = true"
						@deleted="clearIdentity(); collaborationSheetOpen = false"
						@updated="review = $event"
						@error="collaborationError = $event" />

					<PublicGuestDialog :open="guestDialogOpen"
						:joining="joining"
						:viewer="gallery.viewer"
						@dismiss="cancelPendingMutation"
						@submit="joinCollaboration" />

					<PublicLightbox
						v-if="activeIndex !== null"
						:media-items="lightboxMediaItems"
						:initial-index="activeIndex"
						:initial-element="activeOpener"
						:settings="settings"
						:collaboration="collaboration"
						:dimensions="mediaDimensions"
						:mutate="mutateCollaboration"
						:preview-url="previewUrl"
						:stream-url="streamUrl"
						:download-url="downloadUrl"
						:selection-export-url="selectionExportUrl"
						:preview-scene="staticPreview?.scene"
						@active-change="onLightboxActive"
						@close="closeLightbox" />
					<PublicCompareLightTable v-if="settings.mode === 'collaboration' && compareOpen"
						:items="compareItems"
						:preview-url="previewUrl"
						@remove="itemId => { const item = mediaItems.find(value => value.id === itemId); if (item) toggleCompare(item); if (compareItems.length < 2) compareOpen = false }"
						@close="compareOpen = false" />
					<IonLoading :is-open="galleryDownloadBusy" css-class="proofing-public-overlay public-gallery-loading" :message="t('proofing_gallery', 'Preparing gallery download…')" />
					<IonAlert
						:is-open="galleryDownloadError !== ''"
						css-class="proofing-public-overlay public-gallery-alert"
						:header="t('proofing_gallery', 'Gallery download unavailable')"
						:message="galleryDownloadError"
						:buttons="[t('proofing_gallery', 'OK')]"
						@did-dismiss="galleryDownloadError = ''" />
				</div>
			</IonContent>
		</IonPage>
	</IonApp>
</template>

<style scoped src="./styles/PublicApp.css"></style>
