import type { GallerySettings } from './gallerySettings.ts'
import { publicGalleryCssVariables } from './galleryTheme.ts'

export function publicGalleryThemeStyle(settings: GallerySettings): Record<string, string> {
	return publicGalleryCssVariables(settings.presentation.accentColor || '#E85D4A', settings.presentation.heroFocusX, settings.presentation.heroFocusY)
}
