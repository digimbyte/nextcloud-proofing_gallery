import type { Page } from '@playwright/test'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { expectSuccessToast } from './dialogs.ts'

const execFileAsync = promisify(execFile)

async function state(): Promise<{ galleryId: number, token: string, folderId: number, largeFolderId: number, largeExtension: 'png' | 'webp' }> {
	return JSON.parse(await readFile(path.join(process.cwd(), 'test-results-e2e-state.json'), 'utf8'))
}

async function waitForGalleryImages(page: Page): Promise<void> {
	await page.locator('.media-tile__open img').evaluateAll((images) => Promise.all(images.map((image) => (image as HTMLImageElement).decode())))
}

async function settleVisualState(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await document.fonts.ready
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	})
}

async function login(page: Page, baseURL: string | undefined): Promise<void> {
	await page.goto(`${baseURL}/apps/proofing_gallery/`)
	await page.getByRole('textbox', { name: /Account name/ }).fill('admin')
	await page.getByRole('textbox', { name: 'Password' }).fill('admin')
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Galleries', level: 1 })).toBeVisible()
}

async function expectActionTopmost(page: Page, actionName: string): Promise<void> {
	const action = page.getByRole('menuitem', { name: actionName, exact: true })
	await expect(action).toBeVisible()
	expect(await action.evaluate((element) => {
		const rect = element.getBoundingClientRect()
		const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
		return topmost === element || element.contains(topmost)
	})).toBe(true)
}

test('gallery action menus stay above cards in every overview', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
	const page = await context.newPage()
	await login(page, baseURL)

	const openFirstActions = async () => {
		await page.getByRole('button', { name: /^Actions for E2E Dashboard/ }).first().click()
		await expectActionTopmost(page, 'Archive')
	}

	await page.getByRole('button', { name: 'Grid' }).click()
	await openFirstActions()
	await settleVisualState(page)
	await page.keyboard.press('Escape')

	await page.getByRole('button', { name: 'List' }).click()
	await openFirstActions()
	await page.keyboard.press('Escape')

	await page.setViewportSize({ width: 390, height: 844 })
	await page.getByRole('button', { name: 'Grid' }).click()
	await openFirstActions()
	const main = page.locator('.gallery-page')
	expect(await main.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	const accessibility = await new AxeBuilder({ page }).include('.gallery-page').analyze()
	expect(accessibility.violations).toEqual([])
	await page.keyboard.press('Escape')

	await page.getByRole('button', { name: 'Open navigation' }).click()
	await page.getByRole('button', { name: 'Archive', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Archive', level: 1 })).toBeVisible()
	await page.getByRole('button', { name: 'Grid' }).click()
	await page.getByRole('button', { name: /^Actions for/ }).first().click()
	await expectActionTopmost(page, 'Restore')
	await context.close()
})

test('project wizard adapts audience and sources to the selected job', async ({ page, request, baseURL }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await login(page, baseURL)
	await page.getByRole('button', { name: 'New project' }).click()
	let dialog = page.getByRole('dialog', { name: 'Create a project' })
	await dialog.getByRole('radio', { name: /Receive files/ }).check()
	await dialog.getByRole('button', { name: /Continue with Receive files/ }).click()
	dialog = page.getByRole('dialog', { name: 'Receive files' })
	await expect(dialog.locator('strong').filter({ hasText: 'One upload inbox' })).toBeVisible()
	await expect(dialog.getByRole('radio', { name: /Curated collection/ })).toHaveCount(0)
	await expect(dialog.getByText('Separate client deliveries')).toHaveCount(0)
	await dialog.getByRole('textbox', { name: 'Project title' }).fill('Remember this title')
	await dialog.getByRole('button', { name: 'Change' }).click()
	dialog = page.getByRole('dialog', { name: 'Create a project' })
	await dialog.getByRole('radio', { name: /Collect a selection/ }).check()
	await dialog.getByRole('button', { name: /Continue with Collect a selection/ }).click()
	dialog = page.getByRole('dialog', { name: 'Collect a selection' })
	await expect(dialog.getByRole('textbox', { name: 'Project title' })).toHaveValue('Remember this title')
	await expect(dialog.getByRole('radio', { name: /Curated collection/ })).toBeVisible()
	await dialog.getByRole('radio', { name: /Separate private selections/ }).check()
	await expect(dialog.getByRole('radio', { name: /Curated collection/ })).toHaveCount(0)
	expect(await dialog.locator('.project-wizard').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

	const headers = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`, 'OCS-APIRequest': 'true' }
	const invalid = await request.post(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/projects?format=json`, {
		headers,
		data: { title: 'Invalid upload collection', purpose: 'uploads', sourceMode: 'collection', deliveryMode: 'standard' },
	})
	expect(invalid.status()).toBe(422)
	expect((await invalid.json() as { code: string }).code).toBe('invalid_project_combination')
})

test('gallery archive paginates without losing mobile reachability', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
	const page = await context.newPage()
	await login(page, baseURL)
	const item = (id: number) => ({
		id,
		title: `Archived gallery ${String(id).padStart(2, '0')}`,
		status: 'archived',
		mode: id % 2 === 0 ? 'collaboration' : 'presentation',
		sourceType: 'folder',
		purpose: 'delivery',
		workflowState: 'completed',
		createdAt: 1_700_000_000 + id,
		updatedAt: 1_700_000_000 + id,
		heroFileId: null,
		lifecycleNextAt: null,
		mediaSummary: { total: id, coverFileId: null, coverMimeType: null },
		permissions: { role: 'owner', canEdit: true, canManageAccess: true, canArchive: true },
	})
	await page.route('**/api/v2/galleries**', async (route) => {
		const cursor = new URL(route.request().url()).searchParams.get('cursor')
		await route.fulfill({ json: cursor
			? { items: [item(51)], total: 51, nextCursor: null }
			: { items: Array.from({ length: 50 }, (_, index) => item(index + 1)), total: 51, nextCursor: 'second' },
		})
	})

	await page.getByRole('button', { name: 'Open navigation' }).click()
	await page.getByRole('button', { name: 'Archive', exact: true }).click()
	await expect(page.locator('.gallery-row')).toHaveCount(50)
	await expect(page.getByText('50 of 51 galleries')).toBeVisible()
	await page.getByRole('button', { name: 'Load more galleries' }).click()
	await expect(page.locator('.gallery-row')).toHaveCount(51)
	await expect(page.getByText('51 of 51 galleries')).toBeVisible()
	const main = page.locator('.gallery-page')
	expect(await main.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await expect(page.locator('.gallery-row__main').filter({ hasText: 'Archived gallery 51' })).toBeVisible()
	await context.close()
})

test('bundled user documentation works offline in English and German', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ viewport: { width: 1100, height: 850 } })
	const page = await context.newPage()
	const externalDocumentationRequests: string[] = []
	page.on('request', (request) => {
		if (/github\.com|github\.io/.test(request.url())) { externalDocumentationRequests.push(request.url()) }
	})
	await login(page, baseURL)
	await page.getByRole('button', { name: 'Help', exact: true }).click()
	await expect(page).toHaveURL(/#help$/)
	await expect(page.getByRole('heading', { name: 'Proofing Gallery help' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Create a gallery' })).toBeVisible()
	await page.getByRole('button', { name: 'German', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Galerie erstellen' })).toBeVisible()
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Galerie erstellen' })).toBeVisible()
	expect(externalDocumentationRequests).toEqual([])
	const accessibility = await new AxeBuilder({ page }).include('.proofing-help').analyze()
	expect(accessibility.violations).toEqual([])
	await page.setViewportSize({ width: 390, height: 844 })
	expect(await page.locator('.proofing-help').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await context.close()
})

test('owner workspace deep links normalize and follow browser history', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
	const page = await context.newPage()
	const { galleryId } = await state()
	await login(page, baseURL)
	await page.goto(`${baseURL}/apps/proofing_gallery/#gallery/${galleryId}/access`)
	await expect(page).toHaveURL(new RegExp(`#gallery/${galleryId}/share$`))
	await expect(page.getByRole('heading', { level: 2, name: 'Client links' })).toBeVisible()
	const navigation = page.getByRole('navigation', { name: 'Gallery settings' })
	await navigation.getByRole('button', { name: 'Design', exact: true }).click()
	await navigation.getByRole('button', { name: 'Share', exact: true }).click()
	await page.goBack()
	await expect(page).toHaveURL(new RegExp(`#gallery/${galleryId}/design$`))
	await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
	await context.close()
})

test('owner can move through the focused gallery workspace', async ({ browser, baseURL }) => {
	test.setTimeout(75_000)
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
	})
	const page = await context.newPage()
	await page.route('**/api/v1/galleries/*/activity?**', (route) => route.fulfill({ json: [] }))
	await login(page, baseURL)
	await page.getByRole('button', { name: /^E2E Gallery (?:Presentation|Proofing)/ }).click()
	await expect(page.getByRole('heading', { name: /^E2E Gallery/, level: 1 })).toBeVisible()
	await expect(page.getByRole('navigation', { name: 'Gallery settings' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Gallery details' })).toBeVisible()
	await expect(page.locator('.production-status')).toHaveCount(0)
	const readiness = page.locator('.readiness-popover')
	await expect(readiness.locator('summary')).toBeVisible()
	await readiness.locator('summary').click()
	await expect(readiness.locator('.readiness-popover__panel')).toBeVisible()
	await readiness.locator('summary').click()
	await page.getByLabel('Public gallery language').selectOption('de')
	const originalTitle = await page.getByLabel('Gallery title').inputValue()
	await page.getByLabel('Gallery title').fill(`${originalTitle} draft`)
	await expect(page.locator('.save-indicator[data-state="pending"]')).toBeVisible()
	await expect(page.locator('.save-indicator[data-state="saved"]')).toBeVisible()
	await page.getByLabel('Gallery title').fill(originalTitle)
	await expect(page.locator('.save-indicator[data-state="saved"]')).toBeVisible()
	await expect(page.getByLabel('Gallery title')).toHaveValue(originalTitle)

	await page.getByRole('button', { name: 'Photos', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Gallery files' })).toBeVisible()
	const fileActions = page.getByRole('button', { name: 'Actions for proof.png' })
	await fileActions.click()
	await expect(page.getByRole('button', { name: 'Versions', exact: true })).toBeVisible()
	expect(await fileActions.locator('..').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await page.getByRole('button', { name: 'Metadata', exact: true }).click()
	await expect(page.locator('.metadata-panel').getByRole('heading', { name: 'proof.png' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Save XMP sidecar' })).toBeVisible()
	await page.locator('.metadata-panel').getByRole('button', { name: 'Close' }).click()
	await page.getByRole('button', { name: 'Cull', exact: true }).click()
	await expect(page.getByText('DARKROOM')).toBeVisible()
	await expect(page.getByLabel('Describe a scene')).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Focus proof.png' })).toBeVisible()
	await page.getByRole('button', { name: 'Focus', exact: true }).click()
	await expect(page.locator('.culling-workspace--focus')).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(page.locator('.culling-workspace--focus')).toHaveCount(0)
	await page.getByRole('button', { name: 'Tools', exact: true }).click()
	const filmstripPlacement = page.locator('select[name="filmstripPlacement"]')
	const setFilmstripPlacement = async (placement: 'auto' | 'bottom') => {
		const response = page.waitForResponse((candidate) => candidate.request().method() === 'PUT' && candidate.url().includes('/user/preferences'))
		await filmstripPlacement.selectOption(placement)
		expect((await response).status()).toBe(200)
	}
	await setFilmstripPlacement('auto')
	await expect(page.locator('.culling-stage--side')).toBeVisible()
	await expect(page.getByRole('navigation', { name: 'Photo filmstrip' })).toBeVisible()
	await setFilmstripPlacement('bottom')
	await expect(page.locator('.culling-stage--bottom')).toBeVisible()
	await setFilmstripPlacement('auto')
	await page.setViewportSize({ width: 800, height: 900 })
	await expect(page.locator('.culling-stage--bottom')).toBeVisible()
	await page.setViewportSize({ width: 1440, height: 1000 })
	await expect(page.locator('.culling-stage--side')).toBeVisible()
	await page.getByRole('button', { name: 'Tools', exact: true }).click()
	const cullingImage = page.locator('.culling-loupe__image')
	const focusedPreview = cullingImage.locator('img')
	await expect(focusedPreview).toHaveAttribute('src', /[?&]mode=fit(?:&|$)/)
	expect(await focusedPreview.evaluate(image => getComputedStyle(image).objectFit)).toBe('contain')
	await cullingImage.dispatchEvent('pointerdown', { isPrimary: true, pointerType: 'touch', clientX: 500, clientY: 350 })
	await cullingImage.dispatchEvent('pointerup', { isPrimary: true, pointerType: 'touch', clientX: 504, clientY: 352 })
	await expect(page.locator('.culling-workspace')).toHaveClass(/culling-workspace--chrome-hidden/)
	await cullingImage.dispatchEvent('pointerdown', { isPrimary: true, pointerType: 'touch', clientX: 520, clientY: 350 })
	await cullingImage.dispatchEvent('pointerup', { isPrimary: true, pointerType: 'touch', clientX: 410, clientY: 355 })
	await expect(page.locator('.culling-workspace')).toHaveClass(/culling-workspace--chrome-hidden/)
	await cullingImage.dispatchEvent('pointerdown', { isPrimary: true, pointerType: 'touch', clientX: 500, clientY: 350 })
	await cullingImage.dispatchEvent('pointerup', { isPrimary: true, pointerType: 'touch', clientX: 503, clientY: 352 })
	await expect(page.locator('.culling-workspace')).not.toHaveClass(/culling-workspace--chrome-hidden/)
	const cullingSave = page.locator('.culling-save')
	const saveRating = async () => {
		const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/media/cull'))
		await page.getByRole('button', { name: '4 stars' }).click()
		await expect(cullingSave).toHaveText('Saving…')
		return responsePromise
	}
	let cullingResponse = await saveRating()
	await expect(cullingSave).toHaveText(/^(Saved|Needs attention)$/)
	if (await cullingSave.textContent() === 'Needs attention') {
		// A concurrent index refresh can invalidate the optimistic revision once.
		// The workspace reloads the authoritative state before exposing this retry.
		cullingResponse = await saveRating()
	}
	const cullingResponseBody = await cullingResponse.text()
	if (cullingResponse.status() !== 200) {
		const requestBody = cullingResponse.request().postData() ?? '<empty>'
		throw new Error(`Culling save failed with HTTP ${cullingResponse.status()}: ${cullingResponseBody}; request=${requestBody}`)
	}
	await expect(cullingSave).toHaveText('Saved')
	await page.getByRole('button', { name: 'Pick', exact: true }).click()
	await page.getByRole('button', { name: 'Undo', exact: true }).click()
	await expectSuccessToast(page, 'Last culling change undone.')
	await page.getByRole('button', { name: 'Tools', exact: true }).click()
	await page.getByRole('button', { name: 'XMP sync', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Resolve App and XMP' })).toBeVisible()
	await expect(page.getByText('scanned recursively')).toBeVisible()
	const cullingAccessibility = await new AxeBuilder({ page }).include('.culling-workspace').analyze()
	expect(cullingAccessibility.violations).toEqual([])

	await page.getByRole('button', { name: 'Back to project' }).click()
	const settingsNavigation = page.getByRole('navigation', { name: 'Gallery settings' })
	await settingsNavigation.getByRole('button', { name: 'Design', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
	await expect(page.getByText('Public image information')).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Preview watermark' })).toBeVisible()
	const opening = page.getByLabel('Opening')
	await opening.selectOption('compact')
	await expect(page.getByText('Cover image', { exact: true })).toHaveCount(0)
	await opening.selectOption('cinematic')
	const coverField = page.getByText('Cover image', { exact: true }).locator('..')
	await coverField.getByRole('button', { name: 'Choose' }).click()
	const artworkPicker = page.getByRole('dialog', { name: 'Choose gallery artwork' })
	await expect(artworkPicker.getByText('proof.png', { exact: true })).toBeVisible()
	await artworkPicker.getByRole('button', { name: 'Cancel' }).click()
	const titleDisplay = page.getByLabel('Title display')
	const preview = page.locator('.gallery-preview')
	const previewFrame = preview.frameLocator('iframe.gallery-preview__frame')
	await previewFrame.locator('.public-gallery').waitFor()
	await expect(previewFrame.getByRole('button', { name: 'Teilen' })).toBeVisible()
	await expect(previewFrame.locator('body')).toHaveClass(/proofing-gallery-public-page/)
	const previewShare = previewFrame.getByRole('button', { name: 'Teilen' })
	expect(await previewShare.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
	const titleAndCount = page.locator('.header-visibility').locator(':scope > *')
	expect(await titleAndCount.evaluateAll(elements => {
		const [title, count] = elements.map(element => element.getBoundingClientRect())
		return title !== undefined && count !== undefined && title.bottom <= count.top
	})).toBe(true)
	await expect(page.getByLabel('Logo background')).toHaveValue('transparent')
	await titleDisplay.selectOption('compact')
	await expect(previewFrame.locator('.gallery-app-header__title')).toHaveText('E2E Gallery')
	await expect(previewFrame.locator('.gallery-opener__large-title')).toHaveCount(0)
	await titleDisplay.selectOption('hidden')
	await expect(page.getByLabel('Title alignment')).toHaveCount(0)
	await expect(previewFrame.locator('.gallery-app-header__title')).toHaveCount(0)
	await expect(previewFrame.locator('.gallery-opener__large-title')).toHaveCount(0)
	await titleDisplay.selectOption('large')
	await expect(page.getByLabel('Title alignment')).toBeVisible()
	await expect(previewFrame.getByRole('heading', { name: 'E2E Gallery' })).toBeVisible()
	const watermarkText = page.getByLabel('Watermark text')
	await watermarkText.fill('Studio proof')
	await expect(previewFrame.locator('.media-tile img').first()).toHaveAttribute('src', /design-preview/)
	await previewFrame.locator('.media-tile img').first().evaluate((image: HTMLImageElement) => image.decode())
	await watermarkText.fill('')
	const previewScene = page.getByLabel('Scene')
	await previewScene.selectOption('photo')
	await expect(previewFrame.getByRole('dialog', { name: 'proof.png' })).toBeVisible()
	await previewScene.selectOption('slideshow')
	await expect(previewFrame.locator('.lightbox-slideshow-progress')).toBeVisible()
	await page.getByText('Capture date', { exact: true }).click()
	await expect(previewScene).toHaveValue('metadata')
	await expect(previewFrame.getByText('Bildinformationen', { exact: true })).toBeVisible()
	await previewScene.selectOption('gallery')
	await expect(previewFrame.getByRole('dialog')).toBeHidden()
	await expect(previewFrame.locator('.media-grid')).toBeVisible()
	await page.getByText('Capture date', { exact: true }).click()
	await expect(previewScene).toHaveValue('metadata')
	await previewScene.selectOption('gallery')
	const accentInput = page.locator('input[name="accentColor"]')
	const originalAccent = await accentInput.inputValue()
	await accentInput.fill('#1a73e8')
	await expect(previewFrame.locator('ion-app')).toHaveCSS('--gallery-accent', '#1a73e8')
	await accentInput.fill(originalAccent)
	await page.setViewportSize({ width: 390, height: 844 })
	expect(await page.locator('.settings-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await page.getByRole('button', { name: 'Preview gallery' }).click()
	await expect(page.locator('.gallery-preview--expanded')).toBeVisible()
	await expect(page.getByText('Live preview', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Phone' }).click()
	await expect(page.locator('.gallery-preview__viewport--phone')).toBeVisible()
	await expect(previewFrame.locator('.media-tile img')).toHaveCount(1)
	await page.getByRole('button', { name: 'Close preview' }).click()
	await page.setViewportSize({ width: 1440, height: 1000 })
	await settingsNavigation.getByRole('button', { name: 'Overview', exact: true }).click()
	await page.getByLabel('Public gallery language').selectOption('en')
	await settingsNavigation.getByRole('button', { name: 'Share', exact: true }).click()
	await expect(page.getByRole('heading', { level: 2, name: 'Client links' })).toBeVisible()
	await page.getByRole('button', { name: 'New client link' }).click()
	await expect(page.getByRole('heading', { name: 'Create client link' })).toBeVisible()
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await page.locator('.settings-header').getByRole('button', { name: 'Share', exact: true }).click()
	await page.getByRole('dialog', { name: 'Share gallery' }).getByRole('button', { name: 'Close' }).click()
	await settingsNavigation.getByText('More', { exact: true }).click()
	await settingsNavigation.getByRole('button', { name: 'Automation', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'HTTPS Live Push' })).toBeVisible()
	await expect(page.getByText(/^(Ready|Disabled by administrator)$/)).toBeVisible()
	await page.route('**/api/v1/galleries/*/review-integrations', (route) => route.fulfill({ status: 503, json: { message: 'Optional integration unavailable' } }))
	await settingsNavigation.getByRole('button', { name: 'Review', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Client decisions' })).toBeVisible()
	await expect(page.getByText('Review rounds could not be loaded.')).toHaveCount(0)
	await page.getByText('Configure review', { exact: true }).click()
	await expect(page.getByText('Allow guest uploads')).toBeVisible()
	await settingsNavigation.getByRole('button', { name: 'History', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
	await expect(page).toHaveScreenshot('owner-settings.png', {
		animations: 'disabled',
		fullPage: true,
		maxDiffPixelRatio: 0.03,
	})
	await context.close()
})

test('owner duplicate uploads open the native conflict dialog on desktop and mobile', async ({ browser, baseURL }) => {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
	const page = await context.newPage()
	await login(page, baseURL)
	await page.getByRole('button', { name: /^E2E Gallery/ }).click()
	await page.getByRole('button', { name: 'Photos', exact: true }).click()
	const upload = page.getByLabel('Choose files to upload')
	const duplicate = {
		name: 'proof.png',
		mimeType: 'image/png',
		buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
	}

	await upload.setInputFiles(duplicate)
	let dialog = page.getByRole('dialog', { name: 'Select file to keep' })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByText(/same name already exists/)).toBeVisible()
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(dialog).toHaveCount(0)

	await page.setViewportSize({ width: 390, height: 844 })
	await upload.setInputFiles(duplicate)
	dialog = page.getByRole('dialog', { name: 'Select file to keep' })
	await expect(dialog).toBeVisible()
	expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await settleVisualState(page)
	// @nextcloud/dialogs 7.5 renders the picker form with overflow:auto but
	// without a tabindex. Keep the dialog-wide audit while excluding this
	// upstream component limitation from the app's accessibility assertion.
	const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').disableRules(['color-contrast', 'scrollable-region-focusable']).analyze()
	expect(accessibility.violations).toEqual([])
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	await context.close()
})

test('guest completes an accessible proofing flow', async ({ page, baseURL }) => {
	const { token } = await state()
	await page.setViewportSize({ width: 1280, height: 900 })
	await page.goto(`${baseURL}/s/${token}`)
	await page.getByRole('button', { name: 'Open proof.png' }).click()
	const lightbox = page.getByRole('dialog', { name: 'proof.png' })
	await expect(lightbox).toBeVisible()
	await page.waitForTimeout(2800)
	await expect(lightbox).not.toHaveClass(/lightbox-shell--chrome-hidden/)
	await expect(lightbox.getByRole('button', { name: 'Feedback', exact: true })).toBeVisible()

	const image = page.locator('.pswp__img[alt="proof.png"]')
	const imageBounds = await image.boundingBox()
	expect(imageBounds).not.toBeNull()
	expect(await image.getAttribute('srcset')).toBeNull()
	const stableLightboxSource = await image.getAttribute('src')
	await image.click({ position: { x: imageBounds!.width * 0.67, y: imageBounds!.height * 0.42 } })
	const draftMarkerBounds = await page.locator('.annotation-marker--draft').boundingBox()
	expect(draftMarkerBounds).not.toBeNull()
	expect(draftMarkerBounds!.width).toBeCloseTo(draftMarkerBounds!.height, 1)
	const composer = page.locator('.annotation-composer')
	const composerBounds = await composer.boundingBox()
	const textareaBounds = await page.getByRole('textbox', { name: 'Point comment' }).boundingBox()
	const viewport = page.viewportSize()
	expect(composerBounds).not.toBeNull()
	expect(textareaBounds).not.toBeNull()
	expect(viewport).not.toBeNull()
	expect(composerBounds!.x).toBeGreaterThanOrEqual(0)
	expect(composerBounds!.x + composerBounds!.width).toBeLessThanOrEqual(viewport!.width)
	expect(textareaBounds!.x).toBeGreaterThanOrEqual(composerBounds!.x)
	expect(textareaBounds!.x + textareaBounds!.width).toBeLessThanOrEqual(composerBounds!.x + composerBounds!.width)
	await page.getByRole('textbox', { name: 'Point comment' }).fill('Retouch this point')
	await page.getByRole('button', { name: 'Comment', exact: true }).click()
	await page.getByRole('textbox', { name: 'Your name' }).fill('Playwright Reviewer')
	const identityButton = page.getByRole('button', { name: 'Continue' })
	await expect(identityButton).toContainText('Continue')
	await expect(identityButton).toHaveCSS('color', 'rgb(255, 255, 255)')
	await identityButton.click()
	await expect(page.getByRole('textbox', { name: 'Your name' })).toHaveCount(0)
	const pointMarker = page.getByRole('button', { name: 'Open point comment 1' })
	await expect(pointMarker).toBeVisible()
	const pointMarkerBounds = await pointMarker.boundingBox()
	expect(pointMarkerBounds).not.toBeNull()
	expect(pointMarkerBounds!.width).toBeCloseTo(pointMarkerBounds!.height, 1)
	await lightbox.getByRole('button', { name: 'Zoom in', exact: true }).click()
	await page.waitForTimeout(260)
	expect(await image.getAttribute('src')).toBe(stableLightboxSource)
	expect(await image.getAttribute('srcset')).toBeNull()
	const zoomedImageBounds = await image.boundingBox()
	const markerBeforePan = await pointMarker.boundingBox()
	expect(zoomedImageBounds).not.toBeNull()
	expect(markerBeforePan).not.toBeNull()
	await page.mouse.move(zoomedImageBounds!.x + zoomedImageBounds!.width * 0.5, zoomedImageBounds!.y + zoomedImageBounds!.height * 0.5)
	await page.mouse.down({ button: 'right' })
	await page.mouse.move(zoomedImageBounds!.x + zoomedImageBounds!.width * 0.4, zoomedImageBounds!.y + zoomedImageBounds!.height * 0.45)
	await page.mouse.up({ button: 'right' })
	await expect.poll(async () => {
		const bounds = await image.boundingBox()
		return bounds?.x
	}).not.toBe(zoomedImageBounds!.x)
	const pannedImageBounds = await image.boundingBox()
	const markerAfterPan = await pointMarker.boundingBox()
	expect(pannedImageBounds).not.toBeNull()
	expect(markerAfterPan).not.toBeNull()
	const normalizedMarkerX = (markerAfterPan!.x + markerAfterPan!.width / 2 - pannedImageBounds!.x) / pannedImageBounds!.width
	const normalizedMarkerY = (markerAfterPan!.y + markerAfterPan!.height / 2 - pannedImageBounds!.y) / pannedImageBounds!.height
	expect(normalizedMarkerX).toBeCloseTo(0.67, 2)
	expect(normalizedMarkerY).toBeCloseTo(0.42, 2)
	await pointMarker.click()
	await expect(page.getByText('Retouch this point')).toBeVisible()
	await page.getByRole('button', { name: 'Close feedback' }).click()

	await lightbox.getByRole('button', { name: 'Feedback', exact: true }).click()
	await page.getByRole('tab', { name: 'Pins' }).click()
	const addPointComment = page.getByRole('button', { name: 'Add point comment' })
	await addPointComment.click()
	await expect(page.getByRole('status')).toContainText('Move the point with the arrow keys')
	await page.keyboard.press('ArrowRight')
	await page.keyboard.press('Escape')
	await expect(page.getByRole('status')).toHaveCount(0)
	await expect(pointMarker).toHaveCount(1)
	await lightbox.getByRole('button', { name: 'Feedback', exact: true }).click()
	await page.getByRole('tab', { name: 'Pins' }).click()
	await page.getByRole('button', { name: 'Add point comment' }).click()
	await page.keyboard.press('Enter')
	await expect(page.getByRole('textbox', { name: 'Point comment' })).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(page.getByRole('textbox', { name: 'Point comment' })).toHaveCount(0)
	await expect(lightbox).toBeFocused()
	const lightboxAccessibility = await new AxeBuilder({ page }).include('.lightbox-shell').analyze()
	expect(lightboxAccessibility.violations).toEqual([])

	await lightbox.getByRole('button', { name: 'Feedback', exact: true }).click()
	await page.locator('ion-modal.lightbox-feedback-sheet').getByRole('button', { name: 'Like' }).click()
	await page.getByRole('textbox', { name: 'Comment' }).fill('Approved in automated review')
	await page.getByRole('button', { name: 'Comment', exact: true }).click()
	await expect(page.getByText('Approved in automated review')).toBeVisible()
	await page.getByRole('button', { name: 'Close feedback' }).click()
	await lightbox.getByRole('button', { name: 'Close', exact: true }).click()
	await page.getByRole('button', { name: 'Open proof.png' }).click()
	await expect(pointMarker).toBeVisible()
	await pointMarker.click()
	await expect(page.locator('ion-modal.lightbox-feedback-sheet ion-title')).toContainText('Point comment 1')
	await expect(page.locator('.comment-list > li')).toHaveCount(1)
	await expect(page.getByText('Retouch this point')).toBeVisible()
	await expect(page.getByText('Approved in automated review')).toHaveCount(0)
	await page.getByRole('button', { name: 'Close feedback' }).click()
	await lightbox.getByRole('button', { name: 'Feedback', exact: true }).click()
	await expect(page.getByRole('tab', { name: 'General comments' })).toHaveAttribute('aria-selected', 'true')
	await expect(page.getByText('Approved in automated review')).toBeVisible()
	await page.getByRole('button', { name: 'Close feedback' }).click()
	const reopenedImageBounds = await image.boundingBox()
	const markerBounds = await pointMarker.boundingBox()
	expect(reopenedImageBounds).not.toBeNull()
	expect(markerBounds).not.toBeNull()
	expect((markerBounds!.x + markerBounds!.width / 2 - reopenedImageBounds!.x) / reopenedImageBounds!.width).toBeCloseTo(0.67, 1)
	expect((markerBounds!.y + markerBounds!.height / 2 - reopenedImageBounds!.y) / reopenedImageBounds!.height).toBeCloseTo(0.42, 1)
	await lightbox.getByRole('button', { name: 'Close', exact: true }).click()
	const unchangedPoll = await page.evaluate(async () => {
		const response = await fetch(`${location.pathname.replace(/^\/s\//, '/apps/proofing_gallery/public/')}/collaboration?cursor=999999`, { headers: { Accept: 'application/json' } })
		return { status: response.status, body: await response.json() }
	})
	expect(unchangedPoll).toMatchObject({ status: 200, body: { unchanged: true, cursor: 999999 } })

	const accessibility = await new AxeBuilder({ page }).include('.public-gallery').analyze()
	expect(accessibility.violations).toEqual([])
	await waitForGalleryImages(page)
	await expect(page).toHaveScreenshot('public-gallery-desktop.png', {
		animations: 'disabled',
		fullPage: true,
		// Font rasterization varies slightly between local and hosted Linux runners.
		maxDiffPixelRatio: 0.03,
	})
})

test('private collaboration state never discloses another guest feedback', async ({ browser, request, baseURL }) => {
	const fixture = await state()
	const apiHeaders = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`, 'OCS-APIRequest': 'true' }
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const createdResponse = await request.post(`${galleries}?format=json`, {
		headers: apiHeaders,
		data: { folderId: fixture.folderId, title: 'E2E Private collaboration', settings: { mode: 'collaboration', feedbackVisibility: 'private', publicLocale: 'en' } },
	})
	expect(createdResponse.ok()).toBe(true)
	const created = await createdResponse.json() as { id: number }
	try {
		const media = await request.get(`${galleries}/${created.id}/media?format=json&limit=100`, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ id: number; name: string }> }
		const fileId = media.items.find(item => item.name === 'proof.png')?.id
		expect(fileId).toBeTruthy()
		const published = await request.post(`${galleries}/${created.id}/publish?format=json`, { headers: apiHeaders, data: { allowDownloads: false } }).then(response => response.json()) as { gallery: { shareToken: string } }
		const publicUrl = `${baseURL}/s/${published.gallery.shareToken}`

		const firstContext = await browser.newContext()
		const firstPage = await firstContext.newPage()
		await firstPage.goto(publicUrl)
		const firstState = await firstPage.evaluate(async fileId => {
			const base = location.pathname.replace(/^\/s\//, '/apps/proofing_gallery/public/')
			const session = await fetch(`${base}/session`, {
				method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName: 'Private guest A' }),
			}).then(response => response.json()) as { nonce: string }
			const comment = await fetch(`${base}/collaboration/media/${fileId}/comments`, {
				method: 'POST', credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', 'X-Proofing-Nonce': session.nonce },
				body: JSON.stringify({ body: 'Guest A private note' }),
			})
			const state = await fetch(`${base}/collaboration?fileIds=${fileId}`).then(response => response.json())
			return { commentStatus: comment.status, state }
		}, fileId!)
		expect(firstState.commentStatus).toBe(201)
		expect(firstState.state.comments).toHaveLength(1)
		await firstContext.close()

		const anonymousContext = await browser.newContext()
		const anonymousPage = await anonymousContext.newPage()
		await anonymousPage.goto(publicUrl)
		const anonymous = await anonymousPage.evaluate(async fileId => {
			const base = location.pathname.replace(/^\/s\//, '/apps/proofing_gallery/public/')
			const response = await fetch(`${base}/collaboration?fileIds=${fileId}`)
			const excessive = await fetch(`${base}/collaboration?fileIds=${Array.from({ length: 201 }, (_, index) => index + 1).join(',')}`)
			const negativeCursor = await fetch(`${base}/collaboration?cursor=-1`)
			const malformedIds = await fetch(`${base}/collaboration?fileIds=${fileId},nope`)
			return {
				state: await response.json(),
				excessiveStatus: excessive.status,
				negativeCursorStatus: negativeCursor.status,
				malformedIdsStatus: malformedIds.status,
			}
		}, fileId!)
		expect(anonymous.state).toMatchObject({ likes: {}, colors: {}, colorStates: {}, comments: [], selections: [], events: [], ratings: [], cursor: 0 })
		expect(anonymous.excessiveStatus).toBe(422)
		expect(anonymous.negativeCursorStatus).toBe(422)
		expect(anonymous.malformedIdsStatus).toBe(422)
		await anonymousContext.close()

		const secondContext = await browser.newContext()
		const secondPage = await secondContext.newPage()
		await secondPage.goto(publicUrl)
		const secondState = await secondPage.evaluate(async fileId => {
			const base = location.pathname.replace(/^\/s\//, '/apps/proofing_gallery/public/')
			await fetch(`${base}/session`, {
				method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName: 'Private guest B' }),
			})
			return fetch(`${base}/collaboration?fileIds=${fileId}`).then(response => response.json())
		}, fileId!)
		expect(secondState.comments).toEqual([])
		expect(secondState.events).toEqual([])
		await secondContext.close()
	} finally {
		await request.delete(`${galleries}/${created.id}?format=json`, { headers: apiHeaders })
	}
})

test('guest sessions remain gallery-scoped and recover their mutation nonce', async ({ browser, request, baseURL }) => {
	const fixture = await state()
	const apiHeaders = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`, 'OCS-APIRequest': 'true' }
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const createdIds: number[] = []
	try {
		const createGallery = async (title: string) => {
			const createdResponse = await request.post(`${galleries}?format=json`, {
				headers: apiHeaders,
				data: { folderId: fixture.folderId, title, settings: { mode: 'collaboration', publicLocale: 'en' } },
			})
			expect(createdResponse.ok()).toBe(true)
			const created = await createdResponse.json() as { id: number }
			createdIds.push(created.id)
			const published = await request.post(`${galleries}/${created.id}/publish?format=json`, { headers: apiHeaders, data: { allowDownloads: false } })
			expect(published.ok()).toBe(true)
			return (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken
		}
		const firstToken = await createGallery('E2E Scoped guest A')
		const secondToken = await createGallery('E2E Scoped guest B')
		const context = await browser.newContext()
		const page = await context.newPage()
		const createSession = async (token: string, displayName: string) => {
			await page.goto(`${baseURL}/s/${token}`)
			return page.evaluate(async ({ token, displayName }) => {
				const response = await fetch(`/apps/proofing_gallery/public/${token}/session`, {
					method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ displayName }),
				})
				return response.json() as Promise<{ guest: { displayName: string }, nonce: string }>
			}, { token, displayName })
		}
		const first = await createSession(firstToken, 'Scoped guest A')
		const second = await createSession(secondToken, 'Scoped guest B')
		expect(first.nonce).not.toBe(second.nonce)

		const resume = async (token: string) => {
			await page.goto(`${baseURL}/s/${token}`)
			return page.evaluate(async token => {
				const response = await fetch(`/apps/proofing_gallery/public/${token}/session`, { credentials: 'same-origin' })
				return response.json() as Promise<{ guest: { displayName: string }, nonce: string }>
			}, token)
		}
		const resumedFirst = await resume(firstToken)
		expect(resumedFirst).toMatchObject({ guest: { displayName: 'Scoped guest A' }, nonce: first.nonce })
		const resumedSecond = await resume(secondToken)
		expect(resumedSecond).toMatchObject({ guest: { displayName: 'Scoped guest B' }, nonce: second.nonce })

		await page.goto(`${baseURL}/s/${firstToken}`)
		await page.evaluate(token => sessionStorage.removeItem(`proofing-gallery-nonce:${token}`), firstToken)
		await page.reload()
		await expect.poll(() => page.evaluate(token => sessionStorage.getItem(`proofing-gallery-nonce:${token}`), firstToken)).toBe(first.nonce)
		let likeAttempts = 0
		await page.route('**/collaboration/media/*/like', async route => {
			likeAttempts++
			if (likeAttempts === 1) {
				await route.fulfill({ status: 403, contentType: 'application/json', json: { code: 'invalid_nonce', message: 'Invalid request nonce' } })
				return
			}
			await route.continue()
		})
		await page.getByRole('button', { name: 'Open proof.png' }).click()
		await page.getByRole('button', { name: 'Like', exact: true }).first().click()
		await expect.poll(() => likeAttempts).toBe(2)
		await page.unroute('**/collaboration/media/*/like')
		const secondTab = await context.newPage()
		await secondTab.goto(`${baseURL}/s/${firstToken}`)
		await expect.poll(() => secondTab.evaluate(token => sessionStorage.getItem(`proofing-gallery-nonce:${token}`), firstToken)).toBe(first.nonce)

		const cookieNames = (await context.cookies()).map(cookie => cookie.name)
		expect(cookieNames.filter(name => name.startsWith('proofing_gallery_guest_'))).toHaveLength(2)
		await context.close()
	} finally {
		for (const id of createdIds) await request.delete(`${galleries}/${id}?format=json`, { headers: apiHeaders })
	}
})

test('owner selection deltas and collaboration event paging remain complete', async ({ browser, request, baseURL }) => {
	test.setTimeout(90_000)
	const fixture = await state()
	const apiHeaders = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`, 'OCS-APIRequest': 'true' }
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const createdResponse = await request.post(`${galleries}?format=json`, {
		headers: apiHeaders,
		data: { folderId: fixture.folderId, title: 'E2E Collaboration deltas', settings: { mode: 'collaboration', publicLocale: 'en' } },
	})
	expect(createdResponse.ok()).toBe(true)
	const created = await createdResponse.json() as { id: number }
	try {
		const media = await request.get(`${galleries}/${created.id}/media?format=json&limit=100`, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ id: number, name: string }> }
		const fileId = media.items.find(item => item.name === 'proof.png')?.id
		expect(fileId).toBeTruthy()
		const published = await request.post(`${galleries}/${created.id}/publish?format=json`, { headers: apiHeaders, data: { allowDownloads: false } })
		const token = (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken
		const context = await browser.newContext()
		const page = await context.newPage()
		await page.goto(`${baseURL}/s/${token}`)
		const guest = await page.evaluate(async ({ token, fileId }) => {
			const base = `/apps/proofing_gallery/public/${token}`
			const session = await fetch(`${base}/session`, {
				method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName: 'Delta reviewer' }),
			}).then(response => response.json()) as { nonce: string }
			const selectionResponse = await fetch(`${base}/collaboration/selections`, {
				method: 'POST', credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', 'X-Proofing-Nonce': session.nonce },
				body: JSON.stringify({ name: 'Initial selection', fileIds: [fileId] }),
			})
			return { nonce: session.nonce, selection: await selectionResponse.json() as { id: string } }
		}, { token, fileId: fileId! })

		const initialState = await page.evaluate(async ({ token, fileId }) => {
			return fetch(`/apps/proofing_gallery/public/${token}/collaboration?cursor=0&fileIds=${fileId}`).then(response => response.json())
		}, { token, fileId: fileId! }) as { cursor: number }
		const subscriptions = `${galleries}/${created.id}/notification-subscriptions`
		expect((await request.put(`${subscriptions}?format=json`, {
			headers: apiHeaders,
			data: { recipientUid: 'admin', eventTypes: ['like.changed'], frequency: 'immediate', locale: 'auto' },
		})).ok()).toBe(true)
		const updateSubscriptionJson = async (value: string) => execFileAsync('docker', [
			'compose', 'exec', '-T', 'db', 'mariadb', '--user=nextcloud', '--password=nextcloud', 'nextcloud',
			'--execute', `UPDATE oc_proofing_notify_subs SET native_event_types='${value}' WHERE gallery_id=${created.id}`,
		], { cwd: process.cwd() })
		await updateSubscriptionJson('{')
		try {
			const failedMutation = await page.evaluate(async ({ token, nonce, fileId }) => {
				const response = await fetch(`/apps/proofing_gallery/public/${token}/collaboration/media/${fileId}/like`, {
					method: 'POST', credentials: 'same-origin', headers: { 'X-Proofing-Nonce': nonce },
				})
				return response.status
			}, { token, nonce: guest.nonce, fileId: fileId! })
			expect(failedMutation).toBe(500)
			const stateAfterRollback = await page.evaluate(async ({ token, cursor, fileId }) => {
				return fetch(`/apps/proofing_gallery/public/${token}/collaboration?cursor=${cursor}&fileIds=${fileId}`).then(response => response.json())
			}, { token, cursor: initialState.cursor, fileId: fileId! })
			expect(stateAfterRollback).toEqual({ unchanged: true, cursor: initialState.cursor })
		} finally {
			await updateSubscriptionJson('[]')
		}
		const updatedResponse = await request.put(`${galleries}/${created.id}/selections/${guest.selection.id}?format=json`, {
			headers: apiHeaders,
			data: { name: 'Owner-renamed selection', status: 'completed' },
		})
		expect(updatedResponse.ok()).toBe(true)
		const updatedDelta = await page.evaluate(async ({ token, cursor, fileId }) => {
			return fetch(`/apps/proofing_gallery/public/${token}/collaboration?cursor=${cursor}&fileIds=${fileId}`).then(response => response.json())
		}, { token, cursor: initialState.cursor, fileId: fileId! }) as {
			cursor: number
			events: Array<{ type: string, payload: { selectionId?: string } }>
			selections: Array<{ id: string, name: string, status: string }>
		}
		expect(updatedDelta.events).toContainEqual(expect.objectContaining({ type: 'selection.updated', payload: { selectionId: guest.selection.id } }))
		expect(updatedDelta.selections).toContainEqual(expect.objectContaining({ id: guest.selection.id, name: 'Owner-renamed selection', status: 'completed' }))

		const deletedResponse = await request.delete(`${galleries}/${created.id}/selections/${guest.selection.id}?format=json`, { headers: apiHeaders })
		expect(deletedResponse.ok()).toBe(true)
		const deletedDelta = await page.evaluate(async ({ token, cursor, fileId }) => {
			return fetch(`/apps/proofing_gallery/public/${token}/collaboration?cursor=${cursor}&fileIds=${fileId}`).then(response => response.json())
		}, { token, cursor: updatedDelta.cursor, fileId: fileId! }) as { cursor: number, events: Array<{ type: string, payload: { selectionId?: string } }> }
		expect(deletedDelta.events).toContainEqual(expect.objectContaining({
			type: 'selection.deleted',
			payload: expect.objectContaining({ selectionId: guest.selection.id }),
		}))

		await page.evaluate(async ({ token, nonce, fileId }) => {
			for (let index = 0; index < 205; index++) {
				const response = await fetch(`/apps/proofing_gallery/public/${token}/collaboration/media/${fileId}/like`, {
					method: 'POST', credentials: 'same-origin', headers: { 'X-Proofing-Nonce': nonce },
				})
				if (!response.ok) throw new Error(`Like mutation failed with ${response.status}`)
			}
		}, { token, nonce: guest.nonce, fileId: fileId! })
		const pages = await page.evaluate(async ({ token, fileId }) => {
			let cursor = 0
			const events: Array<{ id: number, type: string }> = []
			for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
				const state = await fetch(`/apps/proofing_gallery/public/${token}/collaboration?cursor=${cursor}&fileIds=${fileId}`).then(response => response.json()) as {
					unchanged?: boolean, cursor: number, events?: Array<{ id: number, type: string }>
				}
				if (state.unchanged) break
				events.push(...(state.events ?? []))
				if (state.cursor === cursor) throw new Error('Collaboration cursor did not advance')
				cursor = state.cursor
			}
			return events
		}, { token, fileId: fileId! })
		const likeEvents = pages.filter(event => event.type === 'like.changed')
		expect(likeEvents).toHaveLength(205)
		expect(new Set(pages.map(event => event.id)).size).toBe(pages.length)
		await context.close()
	} finally {
		await request.delete(`${galleries}/${created.id}?format=json`, { headers: apiHeaders })
	}
})

test('guest and owner complete a link-scoped review round', async ({ page, request, baseURL }) => {
	const fixture = await state()
	const apiHeaders = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`, 'OCS-APIRequest': 'true' }
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries?format=json`
	const created = await request.post(galleries, { headers: apiHeaders, data: { folderId: fixture.folderId, title: 'E2E Review rounds', settings: { mode: 'collaboration', publicLocale: 'en' } } })
	const gallery = await created.json() as { id: number }
	try {
		const galleryEndpoint = `${galleries.replace('?format=json', '')}/${gallery.id}`
		const mediaResponse = await request.get(`${galleryEndpoint}/media?format=json&limit=100`, { headers: apiHeaders })
		expect(mediaResponse.ok()).toBe(true)
		const media = await mediaResponse.json() as { items: Array<{ id: number; name: string }> }
		const proof = media.items.find(item => item.name === 'proof.png')
		expect(proof).toBeTruthy()
		const published = await request.post(`${galleries.replace('?format=json', '')}/${gallery.id}/publish?format=json`, { headers: apiHeaders, data: { allowDownloads: false } })
		const token = (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken
		const linksEndpoint = `${galleries.replace('?format=json', '')}/${gallery.id}/public-links?format=json`
		const links = await request.get(linksEndpoint, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ id: number; name: string; policy: Record<string, unknown> }> }
		const link = links.items[0]
		const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
		expect((await request.put(`${linksEndpoint.replace('?format=json', '')}/${link.id}?format=json`, { headers: apiHeaders, data: { name: link.name, policy: link.policy, reviewEnabled: true, reviewDueDate: dueDate, reviewSelectionMinimum: 1, reviewSelectionMaximum: 1 } })).ok()).toBe(true)

		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(`${baseURL}/s/${token}`)
		expect((await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/download/gallery/status`)).status()).toBe(403)
		await page.getByRole('button', { name: 'More options', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Download entire gallery' })).toHaveCount(0)
		await page.getByRole('button', { name: 'Cancel', exact: true }).click()
		await page.getByRole('button', { name: 'Open proof.png' }).click()
		const lightbox = page.getByRole('dialog', { name: 'proof.png' })
		await lightbox.getByRole('button', { name: 'Feedback', exact: true }).click()
		await page.locator('ion-modal.lightbox-feedback-sheet').getByRole('button', { name: 'Like', exact: true }).click()
		await page.getByRole('textbox', { name: 'Your name' }).fill('Round Reviewer')
		await page.getByRole('button', { name: 'Continue' }).click()
		await page.getByRole('button', { name: 'Close feedback' }).click()
		await lightbox.getByRole('button', { name: 'Close', exact: true }).click()
		const nonce = await page.evaluate(token => sessionStorage.getItem(`proofing-gallery-nonce:${token}`), token)
		expect(nonce).toBeTruthy()
		const draftChecks = await page.evaluate(async ({ token, nonce, fileId }) => {
			const headers = { 'Content-Type': 'application/json', 'X-Proofing-Nonce': nonce! }
			const empty = await fetch(`/apps/proofing_gallery/public/${token}/collaboration/selections`, { method: 'POST', headers, body: JSON.stringify({ name: 'Empty draft', fileIds: [] }) })
			const belowMinimum = await fetch(`/apps/proofing_gallery/public/${token}/review/submit`, { method: 'POST', headers })
			const valid = await fetch(`/apps/proofing_gallery/public/${token}/collaboration/selections`, { method: 'POST', headers, body: JSON.stringify({ name: 'Final pick', fileIds: [fileId] }) })
			return { empty: empty.status, belowMinimum: belowMinimum.status, valid: valid.status }
		}, { token, nonce, fileId: proof!.id })
		expect(draftChecks).toEqual({ empty: 201, belowMinimum: 422, valid: 201 })
		const allowedAnnotation = await page.evaluate(async ({ token, nonce, fileId }) => {
			const response = await fetch(`/apps/proofing_gallery/public/${token}/collaboration/media/${fileId}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Proofing-Nonce': nonce! },
				body: JSON.stringify({ body: 'Policy-scoped point', annotation: { x: 2500, y: 7500, width: 800, height: 800 } }),
			})
			return { status: response.status, body: await response.json() }
		}, { token, nonce, fileId: proof!.id })
		expect(allowedAnnotation).toEqual({ status: 201, body: { id: expect.any(Number) } })
		await page.getByRole('button', { name: 'Review details' }).click()
		await expect(page.getByText('Review open')).toBeVisible()
		await page.getByRole('button', { name: 'Submit review' }).click()
		await expect(page.getByText('Submitted for approval')).toBeVisible()
		const locked = await page.evaluate(async ({ token, nonce, fileId }) => fetch(`/apps/proofing_gallery/public/${token}/collaboration/selections`, {
			method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proofing-Nonce': nonce! }, body: JSON.stringify({ name: 'Too late', fileIds: [fileId] }),
		}).then(response => response.status), { token, nonce, fileId: proof!.id })
		expect(locked).toBe(422)
		expect(await page.locator('#proofing_gallery_public').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

		const restrictedPolicy = { ...link.policy, comments: true, annotations: false }
		const restricted = await request.put(`${linksEndpoint.replace('?format=json', '')}/${link.id}?format=json`, {
			headers: apiHeaders,
			data: { name: link.name, policy: restrictedPolicy, reviewEnabled: true, reviewDueDate: dueDate },
		})
		expect(restricted.ok()).toBe(true)
		await page.reload()
		const restrictedState = await page.evaluate(async ({ token, fileId }) => {
			const response = await fetch(`/apps/proofing_gallery/public/${token}/collaboration?cursor=0&fileIds=${fileId}`)
			return response.json()
		}, { token, fileId: proof!.id }) as { policy: { features: { annotations: boolean } }; comments: Array<{ body: string; annotations: unknown[] }> }
		expect(restrictedState.policy.features.annotations).toBe(false)
		expect(restrictedState.comments.find(comment => comment.body === 'Policy-scoped point')?.annotations).toEqual([])
		const deniedAnnotation = await page.evaluate(async ({ token, nonce, fileId }) => {
			const response = await fetch(`/apps/proofing_gallery/public/${token}/collaboration/media/${fileId}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Proofing-Nonce': nonce! },
				body: JSON.stringify({ body: 'Must be denied', annotation: { x: 5000, y: 5000, width: 800, height: 800 } }),
			})
			return response.status
		}, { token, nonce, fileId: proof!.id })
		expect(deniedAnnotation).toBe(403)

		const approved = await request.post(`${galleries.replace('?format=json', '')}/${gallery.id}/public-links/${link.id}/review/approve?format=json`, { headers: apiHeaders })
		expect(approved.ok()).toBe(true)
		const approvedOverview = await approved.json() as { items: Array<{ linkId: number; progress: { count: number; status: string } | null }> }
		expect(approvedOverview.items.find(item => item.linkId === link.id)?.progress).toEqual({ count: 1, status: 'completed' })
		await page.reload()
		await page.getByRole('button', { name: 'Review details' }).click()
		await expect(page.getByText('Approved', { exact: true })).toBeVisible()
	} finally {
		await request.delete(`${galleries.replace('?format=json', '')}/${gallery.id}?format=json`, { headers: apiHeaders })
	}
})

test('public gallery remains usable on a narrow viewport', async ({ page, request, baseURL }) => {
	const { token } = await state()
	const publicPage = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/gallery?limit=100`).then(response => response.json()) as { items: Array<{ id: number; name: string }> }
	const proof = publicPage.items.find(item => item.name === 'proof.png')
	expect(proof).toBeTruthy()
	const original = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/media/${proof!.id}/download`)
	expect(original.ok()).toBe(true)
	expect(original.headers()['content-type']).toContain('image/png')
	const web = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/media/${proof!.id}/download?preset=web-1600`)
	expect(web.ok()).toBe(true)
	expect(web.headers()).toMatchObject({ 'content-type': 'image/jpeg', 'x-proofing-download-preset': 'web-1600' })
	const jpeg = await web.body()
	expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8])
	expect(jpeg.toString('latin1')).not.toContain('Exif')
	expect((await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/media/${proof!.id}/download?preset=unknown`)).status()).toBe(422)
	const webSelection = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/download/selection?fileIds=${proof!.id}&preset=web-2048&watermark=1`)
	expect(webSelection.ok()).toBe(true)
	expect(webSelection.headers()['content-type']).toContain('application/zip')
	expect((await webSelection.body()).subarray(0, 2).toString()).toBe('PK')
	const downloadStatus = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/download/gallery/status`)
	expect(downloadStatus.ok()).toBe(true)
	expect(await downloadStatus.json()).toMatchObject({ available: true, reason: null })
	const galleryArchive = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/download/gallery`)
	expect(galleryArchive.ok()).toBe(true)
	expect(galleryArchive.headers()['content-type']).toContain('application/zip')
	expect((await galleryArchive.body()).subarray(0, 2).toString()).toBe('PK')
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`${baseURL}/s/${token}`)
	await expect(page.locator('#proofing_gallery_public').getByRole('heading', { name: 'E2E Gallery' })).toBeVisible()
	const dimensions = await page.evaluate(async ({ token, fileId }) => {
		const size = async (url: string) => {
			const image = await createImageBitmap(await fetch(url).then(response => response.blob()))
			const result = { width: image.width, height: image.height }
			image.close()
			return result
		}
		return { original: await size(`/apps/proofing_gallery/public/${token}/media/${fileId}/download`), web: await size(`/apps/proofing_gallery/public/${token}/media/${fileId}/download?preset=web-2048`) }
	}, { token, fileId: proof!.id })
	expect(dimensions.web.width).toBeLessThanOrEqual(dimensions.original.width)
	expect(dimensions.web.height).toBeLessThanOrEqual(dimensions.original.height)
	const publicRoot = page.locator('#proofing_gallery_public')
	expect(await publicRoot.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	expect((await publicRoot.boundingBox())?.y).toBe(0)
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Download', exact: true }).click()
	await expect(page.getByText('File size', { exact: true })).toBeVisible()
	expect(await publicRoot.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	await page.getByRole('button', { name: 'More options', exact: true }).click()
	const galleryActions = page.locator('ion-action-sheet.gallery-action-sheet').last()
	await expect(galleryActions.getByRole('button', { name: 'Download entire gallery' })).toBeVisible()
	expect(await galleryActions.evaluate(element => ({
		hoverBackground: getComputedStyle(element).getPropertyValue('--button-background-hover').trim(),
		hoverColor: getComputedStyle(element).getPropertyValue('--button-color-hover').trim(),
	}))).toEqual({ hoverBackground: '#e5e5ea', hoverColor: '#1c1c1e' })
	await page.getByRole('button', { name: 'Display', exact: true }).click()
	await expect(page.getByText('Group', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	const firstMediaButton = page.getByRole('button', { name: /^Open (?!folder)/ }).first()
	await expect(firstMediaButton).toBeVisible()
	expect((await firstMediaButton.boundingBox())?.y).toBeLessThan(844)
	const mediaButton = page.getByRole('button', { name: 'Open proof.png' })
	await expect(mediaButton).toBeVisible()
	await mediaButton.scrollIntoViewIfNeeded()
	await mediaButton.click()
	const dialog = page.getByRole('dialog', { name: 'proof.png' })
	await expect(dialog).toBeVisible()
	await expect(page.getByRole('button', { name: 'Slideshow' })).toBeHidden()
	const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
	expect(overflow).toBeLessThanOrEqual(1)
	await dialog.getByRole('button', { name: 'Feedback', exact: true }).click()
	const feedbackSheet = page.locator('ion-modal.lightbox-feedback-sheet')
	await expect(feedbackSheet).toBeVisible()
	const closeFeedback = feedbackSheet.getByRole('button', { name: 'Close feedback' })
	await expect(closeFeedback).toBeVisible()
	await closeFeedback.click()
	await page.getByRole('button', { name: 'Close', exact: true }).click()

	await waitForGalleryImages(page)
	await expect(page).toHaveScreenshot('public-gallery-mobile.png', {
		animations: 'disabled',
		fullPage: true,
		// Nextcloud may regenerate JPEG previews with small encoder-level pixel
		// differences while preserving the exact layout and source image.
		maxDiffPixelRatio: 0.03,
	})
})

test('changing a published gallery download policy updates the native share', async ({ request, baseURL }) => {
	const fixture = await state()
	const apiHeaders = { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`, 'OCS-APIRequest': 'true' }
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const created = await request.post(`${galleries}?format=json`, { headers: apiHeaders, data: { folderId: fixture.folderId, title: 'E2E download policy sync', settings: { mode: 'presentation', publicLocale: 'en' } } })
	const gallery = await created.json() as { id: number }
	const galleryEndpoint = `${galleries}/${gallery.id}`
	try {
		const media = await request.get(`${galleryEndpoint}/media?format=json&limit=100`, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ id: number; name: string }> }
		const proof = media.items.find(item => item.name === 'proof.png')
		expect(proof).toBeTruthy()
		const published = await request.post(`${galleryEndpoint}/publish?format=json`, { headers: apiHeaders, data: { allowDownloads: false } })
		expect(published.ok()).toBe(true)
		const token = (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken
		expect((await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/media/${proof!.id}/download`)).status()).toBe(403)
		const before = await request.get(`${galleryEndpoint}?format=json`, { headers: apiHeaders }).then(response => response.json()) as { revision: number }
		const updated = await request.put(`${galleryEndpoint}?format=json`, { headers: apiHeaders, data: { settings: { delivery: { downloadScope: 'all' } }, expectedRevision: before.revision } })
		expect(updated.ok()).toBe(true)
		const download = await request.get(`${baseURL}/apps/proofing_gallery/public/${token}/media/${proof!.id}/download`)
		expect(download.status()).toBe(200)
	} finally {
		await request.delete(`${galleryEndpoint}?format=json`, { headers: apiHeaders })
	}
})

test('large mobile masonry stays reachable and responds to a touch swipe', async ({ browser, baseURL, request }) => {
	test.setTimeout(60_000)
	const { largeFolderId, largeExtension } = await state()
	const firstName = `mobile-01.${largeExtension}`
	const secondName = `mobile-02.${largeExtension}`
	const lastName = `mobile-23.${largeExtension}`
	const apiHeaders = {
		Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
		'Content-Type': 'application/json',
		'OCS-APIRequest': 'true',
	}
	const galleryResponse = await request.post(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries?format=json`, {
		headers: apiHeaders,
		data: {
			folderId: largeFolderId,
			title: 'E2E Mobile Gallery',
			purpose: 'showcase',
			settings: { publicLocale: 'en', presentation: { openerStyle: 'compact', layout: 'masonry', showFilenames: false } },
		},
	})
	expect(galleryResponse.ok()).toBe(true)
	const gallery = await galleryResponse.json() as { id: number }
	const publishResponse = await request.post(
		`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${gallery.id}/publish?format=json`,
		{ headers: apiHeaders, data: {} },
	)
	expect(publishResponse.ok()).toBe(true)
	const publish = await publishResponse.json() as { gallery: { shareToken: string } }
	const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const desktopPage = await desktopContext.newPage()
	await desktopPage.goto(`${baseURL}/s/${publish.gallery.shareToken}`)
	await waitForGalleryImages(desktopPage)
	await desktopPage.getByRole('button', { name: `Open ${firstName}` }).click()
	await expect(desktopPage.getByRole('button', { name: 'Previous' })).toBeVisible()
	await expect(desktopPage.getByRole('button', { name: 'Next' })).toBeVisible()
	const desktopNavigation = await desktopPage.evaluate(() => {
		const previous = document.querySelector('.lightbox-nav--previous')?.getBoundingClientRect()
		const next = document.querySelector('.lightbox-nav--next')?.getBoundingClientRect()
		const strip = document.querySelector('.public-filmstrip--side')?.getBoundingClientRect()
		return {
			previous: previous?.toJSON(),
			next: next?.toJSON(),
			strip: strip?.toJSON(),
			nextTopmost: next ? document.elementFromPoint(next.x + next.width / 2, next.y + next.height / 2)?.classList.contains('lightbox-nav--next') : false,
		}
	})
	expect(desktopNavigation.previous).toBeTruthy()
	expect(desktopNavigation.next).toBeTruthy()
	expect(desktopNavigation.nextTopmost).toBe(true)
	if (desktopNavigation.strip && desktopNavigation.next) { expect(desktopNavigation.next.x + desktopNavigation.next.width).toBeLessThan(desktopNavigation.strip.x) }
	await desktopPage.getByRole('button', { name: 'Next' }).click()
	await expect(desktopPage.getByRole('dialog', { name: secondName })).toBeVisible()
	await desktopPage.getByRole('button', { name: 'Previous' }).click()
	await expect(desktopPage.getByRole('dialog', { name: firstName })).toBeVisible()
	await desktopPage.setViewportSize({ width: 768, height: 900 })
	await expect(desktopPage.getByRole('button', { name: 'Previous' })).toBeVisible()
	await expect(desktopPage.getByRole('button', { name: 'Next' })).toBeVisible()
	await desktopContext.close()

	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		hasTouch: true,
		isMobile: true,
	})
	const page = await context.newPage()
	const openViewOptions = async () => {
		await page.getByRole('button', { name: 'More options', exact: true }).click()
		await page.getByRole('button', { name: 'Display', exact: true }).click()
		await expect(page.getByText('Layout', { exact: true })).toBeVisible()
	}
	const tapLightboxControl = async (name: string) => {
		const control = page.getByRole('button', { name, exact: true }).last()
		await expect(control).toBeVisible()
		const box = await control.boundingBox()
		expect(box).not.toBeNull()
		await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2)
	}
	await page.goto(`${baseURL}/s/${publish.gallery.shareToken}`)
	await expect(page.locator('#proofing_gallery_public').getByRole('heading', { name: 'E2E Mobile Gallery' })).toBeVisible()
	await expect(page.getByText('Proofing Gallery', { exact: true })).toHaveCount(0)
	expect(await page.locator('.public-gallery').evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await openViewOptions()
	await page.locator('.gallery-sheet ion-segment-button').filter({ hasText: 'Grid' }).click()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	await waitForGalleryImages(page)
	await expect.poll(() => page.locator('.media-tile').evaluateAll((tiles) => tiles.slice(0, 6).every((tile) => {
		const image = tile.querySelector('img')
		const rect = tile.getBoundingClientRect()
		const imageRatio = image ? image.naturalWidth / image.naturalHeight : 0
		return imageRatio > 0 && Math.abs(rect.width / rect.height - imageRatio) < 0.02
	}))).toBe(true)
	await openViewOptions()
	await page.locator('.gallery-sheet ion-segment-button').filter({ hasText: 'List' }).click()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	const firstListTile = page.locator('.media-grid--list .media-tile').first()
	await expect(firstListTile).toBeVisible()
	expect((await firstListTile.boundingBox())?.height).toBeGreaterThanOrEqual(108)
	expect(await firstListTile.locator('img').evaluate((image) => getComputedStyle(image).objectFit)).toBe('contain')
	await openViewOptions()
	await page.locator('.gallery-sheet ion-segment-button').filter({ hasText: 'Masonry' }).click()
	await page.getByRole('button', { name: 'Close', exact: true }).click()

	await page.getByRole('button', { name: `Open ${firstName}` }).click()
	const shell = page.getByRole('dialog', { name: firstName, exact: true })
	await expect(shell).toBeVisible()
	await expect(page.getByRole('navigation', { name: 'Photo filmstrip' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Next' })).toBeVisible()
	await expect(shell).toHaveClass(/lightbox-shell--chrome-hidden/, { timeout: 7000 })
	await page.getByRole('button', { name: 'Show photo controls' }).evaluate(button => button.click())
	await expect(shell).not.toHaveClass(/lightbox-shell--chrome-hidden/)
	await shell.getByRole('button', { name: 'More options' }).click()
	const lightboxActions = page.locator('ion-action-sheet.lightbox-action-sheet').last()
	await expect(lightboxActions).toBeVisible()
	await lightboxActions.getByRole('button', { name: 'Slideshow' }).click()
	await expect(lightboxActions).toBeHidden()
	const slideshowProgress = page.locator('.lightbox-slideshow-progress')
	await expect(slideshowProgress).toBeVisible()
	await expect(slideshowProgress.locator('i')).toHaveCSS('animation-duration', '5s')
	await shell.getByRole('button', { name: 'More options' }).click()
	await expect(lightboxActions).toBeVisible()
	await lightboxActions.getByRole('button', { name: 'Pause' }).click()
	await expect(lightboxActions).toBeHidden()
	await expect(slideshowProgress).toHaveCount(0)
	await shell.getByRole('button', { name: 'More options' }).click()
	await expect(lightboxActions).toBeVisible()
	await lightboxActions.getByRole('button', { name: 'Hide thumbnails' }).click()
	await expect(lightboxActions).toBeHidden()
	await expect(page.getByRole('navigation', { name: 'Photo filmstrip' })).toHaveCount(0)
	await shell.getByRole('button', { name: 'Close' }).click()
	await page.getByRole('button', { name: `Open ${firstName}` }).click()
	await expect(page.getByRole('navigation', { name: 'Photo filmstrip' })).toHaveCount(0)
	await shell.getByRole('button', { name: 'More options' }).click()
	await expect(lightboxActions.getByRole('button', { name: 'Show thumbnails' })).toBeVisible()
	await lightboxActions.getByRole('button', { name: 'Show thumbnails' }).click()
	// The filmstrip changes before Ionic finishes dismissing its dialog.
	await expect(lightboxActions).toBeHidden()
	await expect(page.getByRole('navigation', { name: 'Photo filmstrip' })).toBeVisible()

	const activeImage = page.locator(`.pswp__img[alt="${firstName}"]`)
	const beforePinch = await activeImage.boundingBox()
	expect(beforePinch).not.toBeNull()
	const touch = await context.newCDPSession(page)
	const centerX = beforePinch!.x + beforePinch!.width / 2
	const centerY = beforePinch!.y + beforePinch!.height / 2
	const touchPoints = (distance: number) => [
		{ x: centerX - distance, y: centerY, id: 11 },
		{ x: centerX + distance, y: centerY, id: 12 },
	]
	await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(40) })
	for (const distance of [50, 60, 70, 80, 90]) {
		await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(distance) })
	}
	await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
	await expect.poll(async () => (await activeImage.boundingBox())!.width).toBeGreaterThan(beforePinch!.width * 1.1)
	await touch.detach()
	const afterPinch = await activeImage.boundingBox()
	expect(beforePinch).not.toBeNull()
	expect(afterPinch).not.toBeNull()
	expect(afterPinch!.width).toBeGreaterThan(beforePinch!.width * 1.1)
	await tapLightboxControl('Close')
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await page.getByRole('button', { name: `Open ${firstName}` }).click()
	await expect(shell).toBeVisible()
	await page.waitForTimeout(900)

	const swipe = async (fromX: number, toX: number) => {
		const points = Array.from({ length: 5 }, (_, index) => fromX + (toX - fromX) * ((index + 1) / 5))
		await page.evaluate(({ fromX }) => {
			const target = document.querySelector('.pswp__scroll-wrap')
			target?.dispatchEvent(new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				clientX: fromX,
				clientY: 420,
				isPrimary: true,
				pointerId: 1,
				pointerType: 'touch',
				buttons: 1,
			}))
		}, { fromX })
		for (const x of points) {
			await page.evaluate(({ x }) => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x, clientY: 420, isPrimary: true, pointerId: 1, pointerType: 'touch', buttons: 1 })), { x })
			await page.waitForTimeout(35)
		}
		await page.evaluate(({ toX }) => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: toX, clientY: 420, isPrimary: true, pointerId: 1, pointerType: 'touch', buttons: 0 })), { toX })
	}
	await swipe(340, 70)
	await expect(page.getByRole('dialog', { name: secondName })).toBeVisible()
	await swipe(70, 340)
	await expect(page.getByRole('dialog', { name: firstName })).toBeVisible()
	await tapLightboxControl('Close')
	await expect(page.getByRole('dialog')).toHaveCount(0)

	await page.locator('.public-gallery-app > .ion-page > ion-content').evaluate(async (content: HTMLElement & { scrollToBottom(duration?: number): Promise<void> }) => content.scrollToBottom(0))
	const lastMedia = page.getByRole('button', { name: `Open ${lastName}` })
	await expect(lastMedia).toBeVisible()
	const lastBox = await lastMedia.boundingBox()
	expect(lastBox?.y).toBeGreaterThanOrEqual(0)
	expect(lastBox?.y).toBeLessThan(844)
	await lastMedia.click()
	await expect(page.getByRole('dialog', { name: lastName })).toBeVisible()
	await expect(page.getByRole('navigation', { name: 'Photo filmstrip' })
		.getByRole('button', { name: `Open ${lastName}` })).toHaveAttribute('aria-current', 'true')
	await context.close()
})

test('editorial story and contextual light table work on desktop and mobile', async ({ browser, baseURL, request }) => {
	const { largeFolderId, largeExtension } = await state()
	const headers = {
		Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
		'Content-Type': 'application/json',
		'OCS-APIRequest': 'true',
	}
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const createdResponse = await request.post(`${galleries}?format=json`, {
		headers,
		data: { folderId: largeFolderId, title: 'E2E Editorial Story', purpose: 'proofing', settings: { mode: 'collaboration', publicLocale: 'en', presentation: { openerStyle: 'compact' } } },
	})
	expect(createdResponse.ok()).toBe(true)
	const created = await createdResponse.json() as { id: number, revision: number }
	const mediaResponse = await request.get(`${galleries}/${created.id}/media?format=json&limit=4`, { headers })
	expect(mediaResponse.ok()).toBe(true)
	const media = await mediaResponse.json() as { items: Array<{ id: number, name: string }> }
	expect(media.items.length).toBeGreaterThanOrEqual(2)
	const updated = await request.put(`${galleries}/${created.id}?format=json`, {
		headers,
		data: { expectedRevision: created.revision, settings: { presentation: { layout: 'story', showFilenames: true, story: { showAllMedia: true, sections: [{
			id: 'opening', title: 'A quiet visual story', body: 'Portrait and landscape photographs share one deliberate sequence.', style: 'split', mediaIds: media.items.slice(0, 2).map(item => item.id),
		}] } } } },
	})
	expect(updated.ok()).toBe(true)
	const published = await request.post(`${galleries}/${created.id}/publish?format=json`, { headers, data: {} })
	expect(published.ok()).toBe(true)
	const token = (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken

	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
	const page = await context.newPage()
	await page.goto(`${baseURL}/s/${token}`)
	await expect(page.getByText('A quiet visual story')).toBeVisible()
	for (const item of media.items.slice(0, 2)) await expect(page.locator('.story-gallery figcaption').getByText(item.name, { exact: true })).toBeVisible()
	await expect(page.getByText('A/B mode', { exact: false })).toHaveCount(0)
	await page.getByRole('button', { name: 'More options', exact: true }).click()
	await page.getByRole('button', { name: 'Select', exact: true }).click()
	await page.getByRole('button', { name: `Open ${media.items[0]!.name}` }).click()
	await page.getByRole('button', { name: `Open ${media.items[1]!.name}` }).click()
	await page.locator('.gallery-app-header').getByRole('button', { name: 'Compare', exact: true }).click()
	await expect(page.getByRole('dialog', { name: 'Compare photos' })).toBeVisible()
	await expect(page.locator('.compare-table__grid figure')).toHaveCount(2)
	await page.getByRole('button', { name: 'Close' }).click()

	await page.setViewportSize({ width: 390, height: 844 })
	expect(await page.locator('.public-gallery').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await page.locator('.gallery-app-header').getByRole('button', { name: 'Compare', exact: true }).click()
	await expect(page.getByLabel('Move comparison divider')).toBeVisible()
	expect(await page.getByRole('dialog', { name: 'Compare photos' }).evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await page.getByRole('button', { name: 'Close' }).click()
	await page.evaluate(() => window.scrollTo(0, 500))
	// Let the app persist the scroll event before injecting the saved photo;
	// otherwise its debounced handler can overwrite this test fixture.
	await page.waitForTimeout(150)
	await page.evaluate(({ token, fileId }) => {
		localStorage.setItem(`proofing-gallery-continuation:${token}`, JSON.stringify({ scrollY: 500, fileId, path: '' }))
	}, { token, fileId: media.items[0]!.id })
	await page.reload()
	await page.getByRole('button', { name: 'Continue viewing' }).click()
	await expect(page.getByRole('dialog', { name: media.items[0]!.name })).toBeVisible()
	await context.close()

	await request.delete(`${galleries}/${created.id}?format=json`, { headers })
})
