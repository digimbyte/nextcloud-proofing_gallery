import { describe, expect, it } from 'vitest'

import { hexRgb, publicGalleryCssVariables, readableText } from './galleryTheme.ts'
import { createDefaultGallerySettings } from './gallerySettings.ts'
import { publicGalleryThemeStyle } from './publicGalleryThemeStyle.ts'

describe('gallery accent foreground', () => {
	it('keeps default control text above the normal-text contrast threshold', () => {
		const theme = publicGalleryThemeStyle(createDefaultGallerySettings())
		expect(theme['--gallery-accent']).toBe('#E85D4A')
		const channels = theme['--ion-color-primary-rgb']!.split(', ').map(value => Number(value) / 255)
		const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
		const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
		const contrast = theme['--ion-color-primary-contrast'] === '#000000'
			? (luminance + 0.05) / 0.05
			: 1.05 / (luminance + 0.05)
		expect(contrast).toBeGreaterThanOrEqual(4.5)
	})

	it.each([
		['#DC513E', '#000000'],
		['#E85D4A', '#000000'],
		['#0080FF', '#000000'],
		['#336699', '#ffffff'],
		['#757575', '#ffffff'],
		['#767676', '#000000'],
		['#000000', '#ffffff'],
		['#FFFFFF', '#000000'],
	])('uses the stronger foreground contrast for %s', (accent, foreground) => {
		expect(readableText(hexRgb(accent))).toBe(foreground)
		const theme = publicGalleryCssVariables(accent, 50, 50)
		expect(theme['--gallery-accent']).toBe(accent)
		expect(theme['--ion-color-primary-contrast']).toBe(foreground)
		expect(theme['--ion-color-primary-contrast-rgb']).toBe(foreground === '#000000' ? '0, 0, 0' : '255, 255, 255')
	})
})
