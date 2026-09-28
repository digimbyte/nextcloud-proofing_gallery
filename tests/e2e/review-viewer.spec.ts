import { readFile } from 'node:fs/promises'
import { chromium, firefox, webkit, expect, test } from '@playwright/test'

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
	test(`review viewer keeps pins, long threads and zoom reachable in ${name}`, async ({ baseURL }) => {
		test.setTimeout(90_000)
		const browser = await engine.launch()
		const context = await browser.newContext({ viewport: { width: 1100, height: 560 } })
		try {
			const page = await context.newPage()
			const { token } = JSON.parse(await readFile('test-results-e2e-state.json', 'utf8')) as { token: string }
			const endpoint = `${baseURL}/index.php/apps/proofing_gallery/public/${token}`
			const session = await context.request.post(`${endpoint}/session`, { data: { displayName: `Viewer ${name}` } }).then(r => r.json())
			const files = await context.request.get(`${endpoint}/gallery`).then(r => r.json())
			const fileId = files.items.find((file: { name: string }) => file.name === 'proof.png').id as number
			const headers = { 'X-Proofing-Nonce': session.nonce as string }
			const rootResponse = await context.request.post(`${endpoint}/collaboration/media/${fileId}/comments`, { headers, data: { body: `Root ${name}`, annotation: { x: 5000, y: 5000, width: 800, height: 800 } } })
			expect(rootResponse.status()).toBe(201)
			const root = (await rootResponse.json()).id as number
			for (let index = 0; index < 20; index++) {
				const reply = await context.request.post(`${endpoint}/collaboration/media/${fileId}/comments`, { headers, data: { body: `Reply ${index} ${name}: Please inspect this detail carefully.`, parentId: root } })
				expect(reply.status()).toBe(201)
			}
			await page.goto(`${baseURL}/s/${token}`)
			await page.getByRole('button', { name: /^Open proof\.png(?:\.|$)/ }).click()
			const image = page.locator('.proofing-zoom-image').filter({ visible: true }).first()
			await expect(image).toBeVisible()
			const before = (await image.boundingBox())!
			await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
			await page.mouse.wheel(0, -300)
			await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width * 1.2)
			const zoomed = (await image.boundingBox())!
			await page.mouse.move(before.x + before.width / 2 - 70, before.y + before.height / 2 - 50)
			await page.mouse.down({ button: 'right' })
			await page.mouse.move(before.x + before.width / 2 + 90, before.y + before.height / 2 + 40, { steps: 6 })
			await page.mouse.up({ button: 'right' })
			await expect.poll(async () => (await image.boundingBox())!.x).toBeGreaterThan(zoomed.x + 20)
			expect(await page.locator('.annotation-composer').count()).toBe(0)
			const marker = page.locator('.annotation-marker--selected')
			// Select through Pins as well: coincident pins must remain individually reachable.
			await page.getByRole('button', { name: 'Feedback', exact: true }).click()
			await page.getByRole('tab', { name: 'Pins' }).click()
			const thread = page.locator('.pin-thread').filter({ has: page.locator(`[aria-controls="pin-thread-${root}"]`) })
			await thread.locator('.pin-thread__open').click()
			const modal = page.locator('ion-modal.lightbox-feedback-sheet')
			await expect(modal.getByText(`Root ${name}`, { exact: true })).toBeVisible()
			const bounds = await modal.evaluate(element => element.shadowRoot!.querySelector('[part="content"]')!.getBoundingClientRect().toJSON())
			expect(bounds.top).toBeGreaterThanOrEqual(0)
			expect(bounds.bottom).toBeLessThanOrEqual(560)
			const content = modal.locator('ion-content')
			await content.evaluate(async element => {
				const scroll = await (element as HTMLElement & { getScrollElement(): Promise<HTMLElement> }).getScrollElement()
				scroll.scrollTop = scroll.scrollHeight
			})
			await expect(modal.getByText(`Reply 19 ${name}: Please inspect this detail carefully.`, { exact: true })).toBeVisible()
			await expect(modal.locator('.annotation-reply-form textarea')).toBeVisible()
			await page.screenshot({ path: `test-results/review-thread-${name}.png` })
			await page.keyboard.press('Escape')
			await expect(modal).toBeHidden()
			expect(await marker.count()).toBe(1)
			await page.screenshot({ path: `test-results/review-${name}.png` })
			await page.setViewportSize({ width: 390, height: 560 })
			await page.getByRole('button', { name: 'Feedback', exact: true }).click()
			await page.getByRole('tab', { name: 'Pins' }).click()
			await thread.locator('.pin-thread__open').click()
			await expect(modal.locator('.annotation-reply-form textarea')).toBeVisible()
			const mobileBounds = await modal.evaluate(element => element.shadowRoot!.querySelector('[part="content"]')!.getBoundingClientRect().toJSON())
			expect(mobileBounds.left).toBeGreaterThanOrEqual(0)
			expect(mobileBounds.right).toBeLessThanOrEqual(390)
			expect(mobileBounds.top).toBeGreaterThanOrEqual(0)
			expect(mobileBounds.bottom).toBeLessThanOrEqual(560)
			await page.screenshot({ path: `test-results/review-thread-mobile-${name}.png` })
		} finally {
			await context.close()
			await browser.close()
		}
	})
}

test('touch panning reaches both image edges and never creates a pin after a drag', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
	try {
		const page = await context.newPage()
		const { token } = JSON.parse(await readFile('test-results-e2e-state.json', 'utf8')) as { token: string }
		await page.goto(`${baseURL}/s/${token}`)
		await page.getByRole('button', { name: /^Open proof\.png(?:\.|$)/ }).click()
		const image = page.locator('.proofing-zoom-image').filter({ visible: true }).first()
		await expect(image).toBeVisible()
		const before = (await image.boundingBox())!
		const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
		const touch = await context.newCDPSession(page)
		const points = (distance: number) => [{ id: 1, x: center.x - distance, y: center.y }, { id: 2, x: center.x + distance, y: center.y }]
		await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(30) })
		for (const distance of [40, 50, 60, 70, 80]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) })
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width * 1.5)
		const pan = async (fromX: number, toX: number) => {
			await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: fromX, y: center.y + 90 }] })
			for (let step = 1; step <= 8; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 3, x: fromX + (toX - fromX) * step / 8, y: center.y + 90 }] })
			await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		}
		for (let i = 0; i < 5; i++) await pan(80, 300)
		await expect.poll(async () => Math.abs((await image.boundingBox())!.x - before.x)).toBeLessThan(2)
		for (let i = 0; i < 5; i++) await pan(300, 80)
		await expect.poll(async () => {
			const bounds = (await image.boundingBox())!
			return Math.abs(bounds.x + bounds.width - before.x - before.width)
		}).toBeLessThan(2)
		await expect(page.locator('.annotation-composer')).toHaveCount(0)
		await expect(page.getByRole('dialog', { name: 'proof.png', exact: true })).toBeVisible()
		await page.screenshot({ path: 'test-results/review-touch-390.png' })
		await touch.detach()
	} finally {
		await context.close()
	}
})
