import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

for (const { width, layout } of [
	{ width: 1440, layout: 'grid' },
	{ width: 390, layout: 'grid' },
	{ width: 1440, layout: 'masonry' },
	{ width: 390, layout: 'list' },
] as const) {
	test(`${layout} selection keeps complete borders and stable geometry at ${width}px`, async ({ page, baseURL }) => {
		await page.setViewportSize({ width, height: 900 })
		const { token } = JSON.parse(await readFile(path.join(process.cwd(), 'test-results-e2e-state.json'), 'utf8')) as { token: string }
		await page.goto(`${baseURL}/s/${token}?view=${layout}`)
		await page.locator(`.media-grid--${layout}`).waitFor()
		await page.locator('.media-tile').first().waitFor()
		await page.locator('.media-tile__open img').first().waitFor()
		await page.locator('.media-tile__open img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())))
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
		await page.getByRole('button', { name: 'More options', exact: true }).click()
		await page.getByRole('button', { name: 'Select', exact: true }).click()

		const tile = page.locator('.media-tile:not(.media-tile--folder)').first()
		const select = tile.getByRole('checkbox')
		const controlGeometry = () => select.evaluate(element => {
			const control = element.getBoundingClientRect()
			const tile = element.closest('.media-tile')!.getBoundingClientRect()
			return { x: control.x - tile.x, y: control.y - tile.y, width: control.width, height: control.height }
		})
		await select.scrollIntoViewIfNeeded()
		const controlBefore = await controlGeometry()
		const before = await tile.boundingBox()
		const gridBefore = await page.locator('.media-grid').boundingBox()
		await tile.hover()
		const hoverFrame = await tile.evaluate(element => getComputedStyle(element, '::after').boxShadow)
		await select.click()
		await expect(select).toHaveAttribute('aria-checked', 'true')
		const selectedFrame = await tile.evaluate(element => getComputedStyle(element, '::after').boxShadow)
		expect(selectedFrame).not.toBe(hoverFrame)
		await page.mouse.move(0, 0)
		expect(await tile.evaluate(element => getComputedStyle(element, '::after').boxShadow)).toBe(selectedFrame)
		await tile.hover()
		expect(await tile.evaluate(element => getComputedStyle(element, '::after').boxShadow)).toBe(selectedFrame)

		const circle = (await select.boundingBox())!
		const tick = (await select.locator('svg').boundingBox())!
		expect(circle.width).toBe(28)
		expect(circle.height).toBe(28)
		expect(tick.x + tick.width / 2).toBeCloseTo(circle.x + circle.width / 2, 1)
		expect(tick.y + tick.height / 2).toBeCloseTo(circle.y + circle.height / 2, 1)
		await page.keyboard.press('Tab')
		const open = tile.locator('.media-tile__open')
		await open.focus()
		expect(await open.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
		expect(await tile.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual({ top: 0, left: 0 })
		const openBox = (await open.boundingBox())!
		if (layout === 'list') {
			expect(openBox.x).toBe(before!.x)
			expect(openBox.y).toBe(before!.y)
			expect(openBox.width).toBe(before!.width)
			expect(openBox.height).toBeCloseTo(before!.height - 1)
		} else expect(openBox).toEqual(await tile.boundingBox())
		expect(await open.locator('img').evaluate(element => getComputedStyle(element).objectFit)).toBe(layout === 'list' ? 'contain' : 'cover')
		expect(await tile.boundingBox()).toEqual(before)
		expect(await page.locator('.media-grid').boundingBox()).toEqual(gridBefore)
		await select.click()
		await expect(select).toHaveAttribute('aria-checked', 'false')
		await page.keyboard.press('Tab')
		await select.focus()
		expect(await select.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none')
		expect(await select.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid')
		expect(await controlGeometry()).toEqual(controlBefore)
		expect(await tile.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))).toEqual({ top: 0, left: 0 })
	})
}
