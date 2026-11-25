import type { Ref } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { contrastRgb, hexRgb, mixHex, readableText } from '../domain/galleryTheme.ts'

export type PublicAppearancePreference = 'system' | 'light' | 'dark'
export type PublicEffectiveTheme = 'light' | 'dark'

export const PUBLIC_APPEARANCE_STORAGE_KEY = 'proofing-gallery:appearance'

export function resolvePublicTheme(visitor: PublicAppearancePreference | null, configured: 'auto' | 'light' | 'dark', systemDark: boolean): PublicEffectiveTheme {
	const preference = visitor ?? (configured === 'auto' ? 'system' : configured)
	return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

function storedPreference(): PublicAppearancePreference | null {
	try {
		const value = localStorage.getItem(PUBLIC_APPEARANCE_STORAGE_KEY)
		return value === 'system' || value === 'light' || value === 'dark' ? value : null
	} catch {
		return null
	}
}

export function usePublicAppearance(configuredTheme: Ref<'auto' | 'light' | 'dark'>, accentColor: Ref<string>, persistent = true) {
	const visitorPreference = ref<PublicAppearancePreference | null>(persistent ? storedPreference() : null)
	const systemDark = ref(false)
	const media = window.matchMedia('(prefers-color-scheme: dark)')
	const effectiveTheme = computed<PublicEffectiveTheme>(() => resolvePublicTheme(visitorPreference.value, configuredTheme.value, systemDark.value))

	function setVisitorPreference(preference: PublicAppearancePreference | null) {
		visitorPreference.value = preference
		if (!persistent) return
		try {
			if (preference === null) localStorage.removeItem(PUBLIC_APPEARANCE_STORAGE_KEY)
			else localStorage.setItem(PUBLIC_APPEARANCE_STORAGE_KEY, preference)
		} catch {
			// Private browsing can deny persistent storage; the in-memory choice still works.
		}
	}

	function syncSystemTheme(event?: MediaQueryListEvent) {
		systemDark.value = event?.matches ?? media.matches
	}

	function syncBodyTheme() {
		const accent = accentColor.value || '#E85D4A'
		const rgb = hexRgb(accent)
		const contrast = readableText(rgb)
		document.body.dataset.proofingPublicTheme = effectiveTheme.value
		document.body.style.setProperty('--proofing-public-accent', accent)
		document.body.style.setProperty('--proofing-public-accent-rgb', rgb.join(', '))
		document.body.style.setProperty('--proofing-public-accent-contrast', contrast)
		document.body.style.setProperty('--proofing-public-accent-contrast-rgb', contrastRgb(contrast))
		document.body.style.setProperty('--proofing-public-accent-shade', mixHex(rgb, [0, 0, 0], 0.12))
		document.body.style.setProperty('--proofing-public-accent-tint', mixHex(rgb, [255, 255, 255], 0.14))
		syncThemeColor(effectiveTheme.value === 'dark' ? '#000000' : '#f2f2f7')
	}

	// Browser and installed-app chrome follow the gallery surface, not Nextcloud's brand color.
	function syncThemeColor(color: string) {
		let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
		if (!meta) {
			meta = document.createElement('meta')
			meta.name = 'theme-color'
			document.head.append(meta)
		}
		meta.content = color
	}

	onMounted(() => {
		syncSystemTheme()
		media.addEventListener('change', syncSystemTheme)
		syncBodyTheme()
	})
	watch([effectiveTheme, accentColor], syncBodyTheme)
	onBeforeUnmount(() => {
		media.removeEventListener('change', syncSystemTheme)
		delete document.body.dataset.proofingPublicTheme
		for (const property of [
			'--proofing-public-accent', '--proofing-public-accent-rgb', '--proofing-public-accent-contrast',
			'--proofing-public-accent-contrast-rgb', '--proofing-public-accent-shade', '--proofing-public-accent-tint',
		]) document.body.style.removeProperty(property)
	})

	return { visitorPreference, effectiveTheme, setVisitorPreference }
}
