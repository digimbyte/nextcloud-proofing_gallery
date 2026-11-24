import type { GallerySettings } from './gallerySettings.ts'
import { publicGalleryCssVariables } from './galleryTheme.ts'

export function publicGalleryThemeStyle(settings: GallerySettings): Record<string, string> {
	return publicGalleryCssVariables(settings.presentation.accentColor || '#DC513E', settings.presentation.heroFocusX, settings.presentation.heroFocusY)
}
