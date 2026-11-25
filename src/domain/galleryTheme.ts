export type Rgb = [number, number, number]

export function hexRgb(value: string): Rgb {
	const normalized = value.replace('#', '')
	if (!/^[\da-f]{6}$/i.test(normalized)) return [232, 93, 74]
	return [0, 2, 4].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as Rgb
}

export function contrastRgb(color: '#000000' | '#ffffff'): string {
	return color === '#000000' ? '0, 0, 0' : '255, 255, 255'
}

export function readableText(rgb: Rgb): '#000000' | '#ffffff' {
	const [red, green, blue] = rgb.map(channel => {
		const value = channel / 255
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
	})
	const luminance = red! * 0.2126 + green! * 0.7152 + blue! * 0.0722
	return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}

export function mixHex(source: Rgb, target: Rgb, amount: number): string {
	return `#${source.map((channel, index) => Math.round(channel + (target[index]! - channel) * amount).toString(16).padStart(2, '0')).join('')}`
}

export function publicGalleryCssVariables(accent: string, heroFocusX: number, heroFocusY: number): Record<string, string> {
	const rgb = hexRgb(accent)
	const contrast = readableText(rgb)
	return {
		'--gallery-accent': accent, '--ion-color-primary': accent, '--ion-color-primary-rgb': rgb.join(', '),
		'--ion-color-primary-contrast': contrast, '--ion-color-primary-contrast-rgb': contrastRgb(contrast),
		'--ion-color-primary-shade': mixHex(rgb, [0, 0, 0], 0.12),
		'--ion-color-primary-tint': mixHex(rgb, [255, 255, 255], 0.14),
		'--hero-focus': `${heroFocusX}% ${heroFocusY}%`,
	}
}
