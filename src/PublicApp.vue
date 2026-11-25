<script setup lang="ts">
import { matchesInitialGalleryPage } from './composables/usePublicGallerySort.ts'
import { n, t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { IonAlert, IonApp, IonContent, IonLoading, IonPage } from '@ionic/vue'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'

import { usePublicGridGeometry } from './composables/usePublicGridGeometry.ts'
import { publicGalleryThemeStyle } from './domain/publicGalleryThemeStyle.ts'
import { PUBLIC_GALLERY_PAGE_SIZE } from './domain/publicGalleryNavigation.ts'
import { continuationStorageKey, loadPublicGalleryContinuation, safelyStore } from './domain/publicGalleryPreferences.ts'
import { galleryHasLogo, galleryTitleMode } from './domain/galleryTitlePresentation.ts'
import { downloadQuery } from './domain/publicDownloadOptions.ts'
import type { PublicDownloadPreset } from './domain/publicDownloadOptions.ts'
import type { MediaItem, PublicGallery, PublicGalleryPage } from './publicTypes.ts'
import { publicGalleryPageQuery } from './services/publicGalleryApi.ts'
import { usePublicPageSwipe } from './composables/usePublicPageSwipe.ts'
import { usePublicSelection } from './composables/usePublicSelection.ts'
import { usePublicGalleryNavigation } from './composables/usePublicGalleryNavigation.ts'
import { usePublicGalleryPage } from './composables/usePublicGalleryPage.ts'
import { usePublicCollaboration } from './composables/usePublicCollaboration.ts'
import { usePublicLiveUpdates } from './composables/usePublicLiveUpdates.ts'
import PublicKioskPhotoNotice from './components/PublicKioskPhotoNotice.vue'
import { usePublicAppearance } from './composables/usePublicAppearance.ts'
const PublicGalleryControls = defineAsyncComponent(() => import('./components/PublicGalleryControls.vue'))
const PublicLightbox = defineAsyncComponent(() => import('./components/PublicLightbox.vue'))
const PublicGalleryHeader = defineAsyncComponent(() => import('./components/PublicGalleryHeader.vue'))
const PublicGalleryOpener = defineAsyncComponent(() => import('./components/PublicGalleryOpener.vue'))
const PublicCompareLightTable = defineAsyncComponent(() => import('./components/PublicCompareLightTable.vue'))
const PublicStoryGallery = defineAsyncComponent(() => import('./components/PublicStoryGallery.vue'))
const PublicGuestDialog = defineAsyncComponent(() => import('./components/PublicGuestDialog.vue'))
const PublicCollaborationSheet = defineAsyncComponent(() => import('./components/PublicCollaborationSheet.vue'))
const PublicSelectionBar = defineAsyncComponent(() => import('./components/PublicSelectionBar.vue'))
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
let disposed = false
let collaborationFrame: number | undefined
const pageState = usePublicGalleryPage({
	initial: props.gallery.initialPage,
	url: (page, focusId) => publicEndpoint(pageQuery(page, focusId)),
	apply: async (payload, focusId, current) => { applyGalleryPage(payload); await nextTick(); if (current() && focusId) openPhotoFromLocation(focusId) },
})
const { load: loadPage, loading, error } = pageState
const items = computed(() => pageState.snapshot.value?.items ?? [])
const story = computed(() => pageState.snapshot.value?.s ?? [])
const total = computed(() => pageState.snapshot.value?.total ?? 0)
const groups = computed(() => pageState.snapshot.value?.groups ?? {})
const indexState = computed(() => pageState.snapshot.value?.indexState ?? null)
const scope = computed(() => pageState.snapshot.value?.scope ?? null)
const settings = computed(() => pageState.snapshot.value?.gallery.settings ?? props.gallery.settings)
const title = computed(() => pageState.snapshot.value?.gallery.title ?? props.gallery.title)
const deliveryMode = computed(() => pageState.snapshot.value?.gallery.deliveryMode ?? props.gallery.deliveryMode ?? 'standard')
const accentColor = computed(() => settings.value.presentation.accentColor || '#E85D4A')
const { visitorPreference, effectiveTheme, setVisitorPreference } = usePublicAppearance(computed(() => settings.value.presentation.theme), accentColor, !isStaticPreview)
const appearancePreference = computed({ get: () => visitorPreference.value, set: setVisitorPreference })
const pageStyle = computed(() => publicGalleryThemeStyle(settings.value))

const pageCount = computed(() => pageState.snapshot.value?.pageCount ?? Math.max(1, Math.ceil(total.value / PUBLIC_GALLERY_PAGE_SIZE)))
const navigation = usePublicGalleryNavigation({
	token: props.gallery.token, settings, preview: isStaticPreview, collection: props.gallery.initialPage?.scope.viewMode === 'collection', pageCount, loadPage,
	openPhoto: openPhotoFromLocation, closePhoto: () => { activeIndex.value = null; activeOpener.value = null }, closePanel: () => { activePanel.value = null }, scrollToGrid,
	clearContinuation: () => { continuation.value = null; continueVisible.value = false },
})
const { currentPath, currentPage, search, sortBy, sortDirection, sortOverride, groupBy, layout, initialLocation, updateLocation, changeSort, resetSort, queueSearch, navigateToPage, upOneLevel, applyView, locationState } = navigation
const mediaItems = computed(() => items.value.filter(item => !item.folder))
const eventAlbumRoot = computed(() => deliveryMode.value === 'event' && currentPath.value === '' && scope.value?.viewMode === 'folder'), openerTotalLabel = computed(() => eventAlbumRoot.value ? n('proofing_gallery', '%n album', '%n albums', total.value) : undefined)
const headerHeroUrl = computed(() => settings.value.presentation.heroFileId ? assetUrl('hero') : null)
const headerLogoUrl = computed(() => galleryHasLogo(settings.value.presentation) ? assetUrl('logo') : null)
const activeIndex = ref<number | null>(props.staticPreview?.scene && props.staticPreview.scene !== 'gallery' ? 0 : null)
const activeOpener = ref<HTMLElement | null>(null)
const { guest, collaboration, nonce, requestAsGuest, clearIdentity, joining, collaborationError, guestDialogOpen, initializeCollaboration, loadCollaboration, joinCollaboration, mutateCollaboration, cancelPendingMutation } = usePublicCollaboration({
	token: props.gallery.token, enabled: !isStaticPreview, settings, mediaItems, endpoint: publicEndpoint, reloadPage: () => loadPage(currentPage.value),
})
const { selectedIds, selectionMode, compareOpen, compareItems, selectionName, selectionMessage, savingSelection, saveSelection, prepareSave, toggleSelection, startSelectionMode, finishSelectionMode, openSelectionCompare, toggleCompare } = usePublicSelection({
	token: props.gallery.token, preview: isStaticPreview, settings, mediaItems, mutate: mutateCollaboration, closePanel: () => { activePanel.value = null },
})
const galleryDownloadBusy = ref(false)
const galleryDownloadError = ref('')
const [downloadPreset, downloadWatermark] = [ref<PublicDownloadPreset>('original'), ref(false)]
const review = ref(props.gallery.review ?? { enabled: false, dueDate: null, rules: { minimum: 0, maximum: 0 }, progress: null, current: null })
const lightboxMediaItems = computed(() => layout.value === 'story' ? mediaItems.value.concat(story.value) : mediaItems.value)
usePublicLiveUpdates({
	enabled: () => !isStaticPreview && props.gallery.initialPage?.gallery.liveUpdates === true,
	busy: () => loading.value || compareOpen.value,
	url: () => publicEndpoint(pageQuery(currentPage.value)),
	photoId: () => activeIndex.value === null ? null : lightboxMediaItems.value[activeIndex.value]?.id ?? null,
	apply: (page, photoId) => {
		applyGalleryPage(page)
		if (photoId !== null) {
			const index = lightboxMediaItems.value.findIndex(item => item.id === photoId)
			activeIndex.value = index < 0 ? null : index
		}
	},
})
const activePanel = ref<'menu' | 'search' | 'view' | 'pages' | 'download' | 'selection' | null>(null)
const searchOpen = ref(false)
const collaborationSheetOpen = ref(false)
const collaborationSheetLoaded = ref(false)
watch(collaborationSheetOpen, open => { if (open) collaborationSheetLoaded.value = true })
const mediaDimensions = ref<Record<number, { width: number; height: number }>>({})
// Panel mode changes only on phone-sized viewports. Narrow desktop windows keep
// centered dialogs and floating annotation controls instead of mobile sheets.
const mobileViewportQuery = window.matchMedia('(max-width: 520px)')
const mobileViewport = ref(mobileViewportQuery.matches)
const viewportWidth = ref(window.innerWidth)
let scrollTimer: number | undefined
const contentRef = ref<InstanceType<typeof IonContent> | null>(null)
const scrollElement = ref<HTMLElement | null>(null)
const pageSwipe = usePublicPageSwipe({ page: currentPage, pageCount, blocked: () => loading.value || activeIndex.value !== null || compareOpen.value || activePanel.value !== null, navigate: page => void navigateToPage(page) })
const selectionBar = computed(() => ({ selecting: selectionMode.value, selectedCount: selectedIds.value.length, canSave: settings.value.mode === 'collaboration' && settings.value.review?.selections !== false, canDownload: ['selection', 'all'].includes(downloadScope.value), saving: savingSelection.value, review: review.value }))
const continuation = ref(isStaticPreview ? null : loadPublicGalleryContinuation(props.gallery.token))
const continueVisible = ref(!!(continuation.value && continuation.value.scrollY > 240))
const downloadScope = computed(() => settings.value.delivery.downloadScope)
function galleryControlProps() {
	return {
		total: total.value,
		page: currentPage.value,
		pageCount: pageCount.value,
		mobile: mobileViewport.value,
		panel: activePanel.value,
		collection: scope.value?.viewMode === 'collection',
		sortOverride: sortOverride.value,
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
const { tileGap, tileMinWidth, targetRowHeight, gridPlaceholderStyle } = usePublicGridGeometry({ settings, mobile: mobileViewport, width: viewportWidth, items, layout, resolved: virtualGridResolved, ratio: itemRatio })

// The gallery prop is immutable on the public page; the design preview
// iframe mutates it to stream unsaved settings changes into the app.
watch(() => props.gallery, gallery => {
	const page = gallery.initialPage
	if (!page) return
	pageState.replace(page)
	if (isStaticPreview) layout.value = settings.value.presentation.layout
}, { deep: true })

watch(() => props.staticPreview?.scene, async scene => { if (scene === 'gallery') await nextTick(); activeIndex.value = scene && scene !== 'gallery' && mediaItems.value.length > 0 ? 0 : null })

onMounted(async () => {
	const contentElement = contentRef.value?.$el as HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }
	scrollElement.value = await contentElement?.getScrollElement?.() ?? null
	if (disposed) return
	if (isStaticPreview) {
		mobileViewportQuery.addEventListener('change', onMobileViewportChange); window.addEventListener('resize', onViewportResize, { passive: true })
		return
	}
	await pageSwipe.attach(scrollElement.value, () => disposed)
	if (disposed) return
	const initialMatches = matchesInitialGalleryPage(props.gallery.initialPage, { ...locationState(), photoId: initialLocation.photoId }, settings.value)
	if (initialMatches) deferCollaborationInitialization()
	else loadPage(currentPage.value, initialLocation.photoId).then(() => deferCollaborationInitialization())
	mobileViewportQuery.addEventListener('change', onMobileViewportChange)
	window.addEventListener('resize', onViewportResize, { passive: true })
})
onBeforeUnmount(() => {
	disposed = true
	window.cancelAnimationFrame(collaborationFrame ?? 0)
	mobileViewportQuery.removeEventListener('change', onMobileViewportChange)
	window.removeEventListener('resize', onViewportResize)
	window.clearTimeout(scrollTimer)
	pageSwipe.destroy()
})

function onMobileViewportChange(event: MediaQueryListEvent) {
	mobileViewport.value = event.matches
	if (!event.matches) activePanel.value = null
}

function onViewportResize() { viewportWidth.value = window.innerWidth }

function setPanel(panel: 'menu' | 'search' | 'view' | 'pages' | 'download' | 'selection' | null) {
	activePanel.value = panel
}

function deferCollaborationInitialization() {
	if (disposed) return
	window.cancelAnimationFrame(collaborationFrame ?? 0)
	collaborationFrame = requestAnimationFrame(() => {
		if (!disposed) collaborationFrame = requestAnimationFrame(() => initializeCollaboration())
	})
}

function pageQuery(page: number, focusId: number | null = null) {
	return publicGalleryPageQuery({ limit: PUBLIC_GALLERY_PAGE_SIZE, page, path: currentPath.value, search: search.value, sortBy: sortOverride.value ? sortBy.value : '', sortDirection: sortOverride.value ? sortDirection.value : '', groupBy: groupBy.value, focusId })
}

function applyGalleryPage(payload: PublicGalleryPage) {
	const activeId = activeIndex.value === null ? null : lightboxMediaItems.value[activeIndex.value]?.id
	pageState.replace(payload)
	navigation.synchronize(payload)
	if (activeId !== undefined && activeId !== null) {
		const index = lightboxMediaItems.value.findIndex(item => item.id === activeId)
		activeIndex.value = index < 0 ? null : index
	}
	if (collaboration.value !== null && settings.value.mode === 'collaboration') void loadCollaboration()
}

function onContentScroll(event: CustomEvent<{ scrollTop: number }>) {
	if (isStaticPreview) return
	const currentScrollY = event.detail.scrollTop
	window.clearTimeout(scrollTimer)
	scrollTimer = window.setTimeout(() => {
		const value = { scrollY: currentScrollY, fileId: activeIndex.value === null ? continuation.value?.fileId ?? null : lightboxMediaItems.value[activeIndex.value]?.id ?? null, path: currentPath.value, page: currentPage.value }
		continuation.value = value
		safelyStore(() => localStorage.setItem(continuationStorageKey(props.gallery.token), JSON.stringify(value)))
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

function scrollToGrid() {
	const grid = document.querySelector<HTMLElement>('.media-grid-shell')
	const scroller = scrollElement.value
	if (!grid || !scroller) return
	const top = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12
	scroller.scrollTo({ top, behavior: 'smooth' })
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
	const previous = mediaDimensions.value[item.id]
	if (previous?.width === image.naturalWidth && previous.height === image.naturalHeight) return
	mediaDimensions.value = {
		...mediaDimensions.value,
		[item.id]: { width: image.naturalWidth, height: image.naturalHeight },
	}
}

function assetUrl(kind: 'logo' | 'hero'): string {
	return publicEndpoint(`asset/${kind}${kind === 'hero' ? `?v=${settings.value.presentation.heroFileId}` : ''}`)
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
			safelyStore(() => localStorage.setItem(continuationStorageKey(props.gallery.token), JSON.stringify(continuation.value)))
			updateLocation('push', item.id, { proofingGalleryPhoto: true })
		}
		return
	}
	currentPath.value = item.relativePath ?? [currentPath.value, item.name].filter(Boolean).join('/')
	currentPage.value = 1
	updateLocation('push')
	loadPage(1)
}

function openPhotoFromLocation(fileId: number) {
	const index = lightboxMediaItems.value.findIndex(item => item.id === fileId)
	if (index < 0) return
	activeIndex.value = index
}

function onLightboxActive(item: MediaItem) {
	activeIndex.value = lightboxMediaItems.value.findIndex(media => media.id === item.id)
	if (!navigation.applyingHistory.value) updateLocation('replace', item.id, { proofingGalleryPhoto: true })
}

function closeLightbox() {
	if (!navigation.applyingHistory.value && new URL(window.location.href).searchParams.has('photo')) {
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
					<PublicKioskPhotoNotice :endpoint="publicEndpoint" :enabled="!isStaticPreview" />
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
							@sort-change="changeSort"
							@reset-sort="resetSort"
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
											<CheckIcon v-if="selectedIds.includes(item.id)" :size="18" aria-hidden="true" />
										</button>
									</article>
								</template>
							</VirtualMediaGrid>
						</div>
					</section>

					<PublicCollaborationSheet v-if="settings.mode === 'collaboration' && collaborationSheetLoaded"
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
			<PublicSelectionBar v-if="activeIndex === null && !compareOpen && !eventAlbumRoot"
				v-bind="selectionBar"
				@start="startSelectionMode"
				@save="prepareSave(t('proofing_gallery', 'My selection')) && setPanel('selection')"
				@download="startDownload(selectionUrl('download/selection'))" />
		</IonPage>
	</IonApp>
</template>

<style scoped src="./styles/PublicApp.css"></style>
