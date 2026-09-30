import { expect, test } from '@playwright/test'

const auth = `Basic ${Buffer.from('admin:admin').toString('base64')}`
const headers = { Authorization: auth, 'OCS-APIRequest': 'true' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function fileId(response: Response): Promise<number> {
	const xml = await response.text()
	return Number(xml.match(/<(?:oc:)?fileid>(\d+)<\/(?:oc:)?fileid>/)?.[1])
}

test('event delivery exposes shared and assigned folders but rejects siblings', async ({ page, request, baseURL }) => {
	test.setTimeout(60_000)
	const dav = `${baseURL}/remote.php/dav/files/admin/ProofingGalleryE2EEvent`
	await request.delete(dav, { headers })
	expect((await request.fetch(dav, { method: 'MKCOL', headers })).status()).toBe(201)
	for (const folder of ['Allgemein', 'Anna', 'Ben', 'Leer', 'Klassen', 'Klassen/1a']) {
		expect((await request.fetch(`${dav}/${folder}`, { method: 'MKCOL', headers })).status()).toBe(201)
	}
	for (const [folder, name] of [['Allgemein', 'event.png'], ['Anna', 'anna.png'], ['Ben', 'ben.png']]) {
		expect((await request.put(`${dav}/${folder}/${name}`, { headers: { ...headers, 'Content-Type': 'image/png' }, data: png })).ok()).toBe(true)
	}
	const propfind = { method: 'PROPFIND', headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' }, data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>' }
	const folderId = await fileId(await request.fetch(dav, propfind))
	const annaFileId = await fileId(await request.fetch(`${dav}/Anna/anna.png`, propfind))
	const benFileId = await fileId(await request.fetch(`${dav}/Ben/ben.png`, propfind))
	expect(folderId).toBeGreaterThan(0)
	expect(annaFileId).toBeGreaterThan(0)
	expect(benFileId).toBeGreaterThan(0)

	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const projects = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/projects`
	const galleryResponse = await request.post(`${projects}?format=json`, { headers, data: { folderId, title: 'E2E Event privacy', sourceMode: 'existing', deliveryMode: 'event' } })
	expect(galleryResponse.status()).toBe(201)
	const gallery = await galleryResponse.json() as { id: number }
	const publishResponse = await request.post(`${galleries}/${gallery.id}/publish?format=json`, { headers, data: { allowDownloads: true } })
	expect(publishResponse.status()).toBe(200)
	const published = await publishResponse.json() as { gallery: { shareToken: string } }
	const masterToken = published.gallery.shareToken
	const emptyMaster = await request.get(`${baseURL}/index.php/apps/proofing_gallery/public/${masterToken}/gallery`).then((response) => response.json()) as { items: unknown[] }
	expect(emptyMaster.items).toEqual([])

	const eventPreview = await request.get(`${galleries}/${gallery.id}/event?format=json`, { headers })
	expect(eventPreview.status()).toBe(200)
	const preview = await eventPreview.json() as { suggested: boolean, folders: Array<{ path: string, mediaCount: number }> }
	expect(preview.suggested).toBe(false)
	expect(preview.folders.find((folder) => folder.path === 'Anna')?.mediaCount).toBe(1)
	expect(preview.folders.some((folder) => folder.path === 'Klassen/1a')).toBe(true)

	const importResponse = await request.post(`${galleries}/${gallery.id}/event/import-preview?format=json`, {
		headers,
		data: { csv: 'folder,name,email,locale,groups\r\nAnna,"Anna, Familie",anna@example.test,de,Klassen/1a\r\nAnna,Großeltern,,,Klassen/1a\r\nA,Unklar,,,', matchMode: 'prefix' },
	})
	expect(importResponse.status()).toBe(200)
	const importPreview = await importResponse.json() as { rows: Array<{ folderPath: string | null, groupRoots: string[], conflicts: string[] }>, summary: { ready: number, conflicts: number } }
	expect(importPreview.summary).toEqual({ total: 3, ready: 2, conflicts: 1 })
	expect(importPreview.rows[0]).toMatchObject({ folderPath: 'Anna', groupRoots: ['Klassen/1a'], conflicts: [] })
	expect(importPreview.rows[2].conflicts).toContain('folder_ambiguous')

	const draftResponse = await request.post(`${galleries}/${gallery.id}/event/waves?format=json`, {
		headers,
		data: { sharedRoots: ['Allgemein'], recipients: [
			{ folderPath: 'Ben', groupRoots: ['Klassen/1a'], name: 'Ben Eltern', email: '', locale: 'de', pin: 'Aa2!EventDraft' },
			{ folderPath: 'Ben', groupRoots: ['Klassen/1a'], name: 'Ben Großeltern', email: '', locale: 'de', pin: 'Aa2!EventDraft2' },
		] },
	})
	expect(draftResponse.status()).toBe(201)
	const draft = await draftResponse.json() as { id: number, status: string, processed: number }
	expect(draft).toMatchObject({ status: 'draft', processed: 0 })
	const draftedOverview = await request.get(`${galleries}/${gallery.id}/event?format=json`, { headers }).then((response) => response.json()) as { items: Array<{ id: number, name: string, link: unknown }>, waves: Array<{ id: number, pinExportAvailable: boolean }> }
	expect(draftedOverview.items.filter((item) => item.name.startsWith('Ben'))).toHaveLength(2)
	expect(draftedOverview.items.find((item) => item.name === 'Ben Eltern')?.link).toBeNull()
	expect(draftedOverview.waves.find((wave) => wave.id === draft.id)?.pinExportAvailable).toBe(false)
	const recipientsV2 = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v2/galleries/${gallery.id}/event`
	const recipientPageResponse = await request.get(`${recipientsV2}/recipients?format=json&limit=1&query=Ben`, { headers })
	expect(recipientPageResponse.status()).toBe(200)
	const recipientPage = await recipientPageResponse.json() as { items: Array<{ id: number, name: string, allowedActions: string[] }>, total: number, nextCursor: string | null }
	expect(recipientPage.total).toBe(2)
	expect(recipientPage.nextCursor).toBeTruthy()
	expect(recipientPage.items[0].allowedActions).toContain('edit')
	const editedRecipient = await request.put(`${recipientsV2}/recipients/${recipientPage.items[0].id}?format=json`, { headers, data: { folderPath: 'Ben', groupRoots: ['Klassen/1a'], name: 'Ben Familie', email: 'ben@example.test', locale: 'de' } })
	expect(editedRecipient.status()).toBe(200)
	expect((await editedRecipient.json() as { name: string }).name).toBe('Ben Familie')
	const secondRecipient = draftedOverview.items.find((item) => item.id !== recipientPage.items[0].id && item.name.startsWith('Ben'))
	expect(secondRecipient).toBeTruthy()
	const bulkDelete = await request.post(`${recipientsV2}/recipients/bulk?format=json`, { headers, data: { recipientIds: [secondRecipient!.id], action: 'delete' } })
	expect(await bulkDelete.json()).toMatchObject({ processed: 1, failed: 0 })
	const statusCsv = await request.get(`${recipientsV2}/status-export`, { headers })
	expect(statusCsv.status()).toBe(200)
	expect(await statusCsv.text()).toContain('Ben Familie')
	const cancelled = await request.delete(`${galleries}/${gallery.id}/event/waves/${draft.id}?format=json`, { headers })
	expect(cancelled.status()).toBe(200)
	expect((await cancelled.json() as { status: string }).status).toBe('cancelled')

	const deliveryResponse = await request.post(`${galleries}/${gallery.id}/event/recipients?format=json`, {
		headers,
		data: { sharedRoots: ['Allgemein'], recipients: [{ folderPath: 'Anna', name: 'Anna', email: '', locale: 'de', pin: '' }] },
	})
	expect(deliveryResponse.status()).toBe(201)
	const delivery = await deliveryResponse.json() as { items: Array<{ link: { url: string } }> }
	const token = new URL(delivery.items[0].link.url).pathname.split('/').filter(Boolean).at(-1)
	expect(token).toBeTruthy()

	const publicEndpoint = `${baseURL}/index.php/apps/proofing_gallery/public/${token}`
	const downloadPolicyEndpoint = `${recipientsV2}/download-policy?format=json`
	const selectionPolicy = await request.post(downloadPolicyEndpoint, { headers, data: { downloadScope: 'selection' } })
	expect(selectionPolicy.status()).toBe(200)
	expect(await selectionPolicy.json()).toMatchObject({ updated: 1, skipped: 1 })
	expect((await request.get(`${publicEndpoint}/media/${annaFileId}/download`)).status()).toBe(403)
	const allDownloadsPolicy = await request.post(downloadPolicyEndpoint, { headers, data: { downloadScope: 'all' } })
	expect(allDownloadsPolicy.status()).toBe(200)
	expect(await allDownloadsPolicy.json()).toMatchObject({ updated: 1, skipped: 1 })
	const root = await request.get(`${publicEndpoint}/gallery`).then((response) => response.json()) as {
		gallery: { deliveryMode: string }
		scope: { roots: Array<{ path: string, name: string, role: string }> }
		items: Array<{ name: string, folder: boolean, album: { role: string, mediaCount: number, folderCount: number, covers: unknown[] } }>
	}
	expect(root.gallery.deliveryMode).toBe('event')
	expect(root.items.map((item) => item.name).sort()).toEqual(['Allgemein', 'Anna'])
	expect(root.scope.roots).toEqual([
		{ path: 'Allgemein', name: 'Allgemein', role: 'shared' },
		{ path: 'Anna', name: 'Anna', role: 'private' },
	])
	expect(root.items.find((item) => item.name === 'Allgemein')?.album).toMatchObject({ role: 'shared', mediaCount: 1, folderCount: 0 })
	expect(root.items.find((item) => item.name === 'Anna')?.album).toMatchObject({ role: 'private', mediaCount: 1, folderCount: 0 })

	await page.goto(new URL(delivery.items[0].link.url).pathname)
	await expect(page.locator('.event-album').filter({ hasText: 'Allgemein' })).toContainText(/1 (photo|Foto)/)
	await expect(page.locator('.event-album').filter({ hasText: 'Anna' })).toContainText(/1 (photo|Foto)/)
	await page.locator('.public-appearance-button').click()
	await page.locator('.public-appearance-list ion-item').filter({ hasText: /^(Dark|Dunkel)$/ }).click()
	await expect(page.locator('body')).toHaveAttribute('data-proofing-public-theme', 'dark')
	await page.reload()
	await expect(page.locator('body')).toHaveAttribute('data-proofing-public-theme', 'dark')
	await page.setViewportSize({ width: 390, height: 844 })
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
	const annaAlbum = page.locator('.event-album').filter({ hasText: 'Anna' })
	await expect(annaAlbum).toBeVisible()
	await annaAlbum.locator('button').click()
	await page.locator('.media-tile__open').click()
	await page.getByRole('dialog', { name: 'anna.png' }).locator('ion-buttons ion-button').last().click()
	const publicActions = page.locator('ion-action-sheet.proofing-public-overlay').last()
	await expect(publicActions).toBeVisible()
	expect(await publicActions.evaluate((element) => getComputedStyle(element).getPropertyValue('--background').trim())).toBe('#1c1c1e')
	expect(await publicActions.locator('.action-sheet-group').first().evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	await page.setViewportSize({ width: 1280, height: 844 })
	const masterRoot = await request.get(`${baseURL}/index.php/apps/proofing_gallery/public/${masterToken}/gallery`).then((response) => response.json()) as { items: Array<{ name: string }> }
	expect(masterRoot.items).toEqual([])
	const forbiddenPreview = await request.get(`${publicEndpoint}/preview/${benFileId}/400/300`)
	expect(forbiddenPreview.status()).toBe(404)
	expect((await request.get(`${publicEndpoint}/media/${annaFileId}/download`)).status()).toBe(200)
	expect((await request.get(`${publicEndpoint}/media/${benFileId}/stream`)).status()).toBe(404)
	expect((await request.get(`${publicEndpoint}/media/${benFileId}/download`)).status()).toBe(404)
	const traversal = await request.get(`${publicEndpoint}/gallery?path=Ben`)
	expect(traversal.status()).toBe(404)

	const publicDav = await request.fetch(`${baseURL}/public.php/dav/files/${token}/`, {
		method: 'PROPFIND',
		headers: { Depth: '1', Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` },
	})
	expect(publicDav.status()).toBe(207)
	const publicDavListing = await publicDav.text()
	expect(publicDavListing).not.toContain('Allgemein')
	expect(publicDavListing).not.toContain('Anna')
	expect(publicDavListing).not.toContain('Ben')

	expect((await request.fetch(`${dav}/Anna`, { method: 'MOVE', headers: { ...headers, Destination: `${dav}/Anna-Renamed` } })).status()).toBe(201)
	const renamedRoot = await request.get(`${publicEndpoint}/gallery`).then((response) => response.json()) as { items: Array<{ name: string }> }
	expect(renamedRoot.items.map((item) => item.name).sort()).toEqual(['Allgemein', 'Anna-Renamed'])

	await page.goto(`${baseURL}/apps/proofing_gallery/`)
	await page.getByRole('textbox', { name: /Account name/ }).fill('admin')
	await page.getByRole('textbox', { name: 'Password' }).fill('admin')
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await page.getByRole('button', { name: 'Use dark appearance' }).click()
	await expect(page.locator('#proofing_gallery')).toHaveAttribute('data-studio-theme', 'dark')
	await page.goto(`${baseURL}/apps/proofing_gallery/#gallery/${gallery.id}/share`)
	await expect(page.locator('.event-workflow')).toBeVisible()
	await expect(page.locator('.event-workflow__hero')).toHaveCount(0)
	await expect(page.locator('#proofing_gallery')).toHaveAttribute('data-studio-theme', 'dark')
	await page.getByRole('button', { name: /Release/ }).click()
	await expect(page.locator('select[name="downloadScope"]')).toHaveValue('all')
	await page.getByRole('button', { name: /Recipients & links/ }).click()
	await expect(page.getByRole('heading', { name: 'Recipients & links' })).toBeVisible()
	await expect(page.getByText(/Anna-Renamed/).first()).toBeVisible()
	await page.setViewportSize({ width: 390, height: 844 })
	const workflow = page.locator('.event-workflow')
	expect(await workflow.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	const ledger = page.locator('.recipient-ledger')
	expect(await ledger.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

	const annaRecipient = (await request.get(`${recipientsV2}/recipients?format=json&query=Anna`, { headers }).then((response) => response.json()) as { items: Array<{ id: number }> }).items[0]
	const pinRotation = await request.post(`${recipientsV2}/recipients/${annaRecipient.id}/rotate?format=json`, { headers, data: { mode: 'pin' } })
	expect(pinRotation.status()).toBe(200)
	expect((await pinRotation.json() as { pin: string }).pin).toMatch(/^Aa2!\S{16}$/)
	const linkRotation = await request.post(`${recipientsV2}/recipients/${annaRecipient.id}/rotate?format=json`, { headers, data: { mode: 'link' } })
	expect(linkRotation.status()).toBe(200)
	expect((await linkRotation.json() as { recipient: { link: { url: string } }, pin: string }).recipient.link.url).not.toContain(token!)
	const reconcile = await request.post(`${recipientsV2}/reconcile?format=json`, { headers })
	expect(reconcile.status()).toBe(200)
	const eventAudit = await request.get(`${recipientsV2}/audit?format=json`, { headers }).then((response) => response.json()) as { items: Array<{ action: string }> }
	expect(eventAudit.items.map((item) => item.action)).toEqual(expect.arrayContaining(['recipient_edit', 'recipient_delete', 'recipient_export', 'recipient_pin_rotate', 'recipient_link_rotate', 'recipient_reconcile', 'download_policy_apply']))

	expect((await request.delete(`${dav}/Anna-Renamed`, { headers })).status()).toBe(204)
	const degraded = await request.get(`${galleries}/${gallery.id}/event?format=json`, { headers }).then((response) => response.json()) as { items: Array<{ folderState: string }> }
	expect(degraded.items[0].folderState).toBe('missing')
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Recipients & links' })).toBeVisible()
	await expect(page.getByText('Folder unavailable')).toBeVisible()
})

test('guided event setup persists and delivery retries are idempotent', async ({ request, baseURL }) => {
	const rootName = `ProofingGalleryE2EGuided-${Date.now()}`
	const dav = `${baseURL}/remote.php/dav/files/admin/${rootName}`
	expect((await request.fetch(dav, { method: 'MKCOL', headers })).status()).toBe(201)
	for (const folder of ['Allgemein', 'Klasse', 'Kind']) expect((await request.fetch(`${dav}/${folder}`, { method: 'MKCOL', headers })).status()).toBe(201)
	for (const folder of ['Allgemein', 'Kind']) expect((await request.put(`${dav}/${folder}/photo.png`, { headers: { ...headers, 'Content-Type': 'image/png' }, data: png })).ok()).toBe(true)
	const propfind = { method: 'PROPFIND', headers: { ...headers, Depth: '0', 'Content-Type': 'application/xml' }, data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>' }
	const folderId = await fileId(await request.fetch(dav, propfind))
	const projects = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/projects`
	const created = await request.post(`${projects}?format=json`, { headers, data: { folderId, title: 'Guided event', sourceMode: 'existing', deliveryMode: 'event' } })
	expect(created.status()).toBe(201)
	const gallery = await created.json() as { id: number, shareToken: string | null }
	expect(gallery.shareToken).toBeNull()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const ensured = await request.post(`${galleries}/${gallery.id}/folders/ensure?format=json`, { headers, data: { paths: ['Import/Unterordner', 'Import'] } })
	expect(ensured.status()).toBe(200)
	expect(await ensured.json()).toEqual({ paths: ['Import', 'Import/Unterordner'] })
	const event = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v2/galleries/${gallery.id}/event`
	const initial = await request.get(`${event}/setup?format=json`, { headers }).then((response) => response.json()) as { revision: number, folders: Array<{ id: number, path: string }> }
	expect(initial.folders.map((folder) => folder.path)).toEqual(expect.arrayContaining(['Import', 'Import/Unterordner']))
	const idFor = (path: string) => initial.folders.find((folder) => folder.path === path)!.id
	const setup = {
		currentStep: 'review',
		folderAssignments: [
			{ folderId: idFor('Allgemein'), role: 'shared' },
			{ folderId: idFor('Klasse'), role: 'group' },
			{ folderId: idFor('Kind'), role: 'private' },
		],
		recipients: [{ key: 'guidedrecipient1', folderId: idFor('Kind'), groupFolderIds: [idFor('Klasse')], name: 'Familie Kind', email: '', locale: 'de', pin: '' }],
		delivery: { pinMode: 'none', expiresAt: '', releaseMode: 'draft', releaseAt: '', sendInvitations: false },
	}
	const savedResponse = await request.put(`${event}/setup?format=json`, { headers, data: { setup, expectedRevision: initial.revision } })
	expect(savedResponse.status()).toBe(200)
	const saved = await savedResponse.json() as { revision: number, readiness: { ready: boolean } }
	expect(saved.readiness.ready).toBe(true)
	const reloaded = await request.get(`${event}/setup?format=json`, { headers }).then((response) => response.json()) as { revision: number, currentStep: string }
	expect(reloaded).toMatchObject({ revision: saved.revision, currentStep: 'delivery' })
	const sharedDesign = await request.get(`${event}/design-media?format=json&scope=shared`, { headers }).then((response) => response.json()) as { activeScope: string, items: Array<{ name: string }>, scopes: Array<{ id: string }> }
	expect(sharedDesign.activeScope).toBe('shared')
	expect(sharedDesign.items.map((item) => item.name)).toEqual(['photo.png'])
	const recipientScope = sharedDesign.scopes.find((scope) => scope.id.startsWith('recipient:'))
	expect(recipientScope).toBeTruthy()
	const recipientDesign = await request.get(`${event}/design-media?format=json&scope=${encodeURIComponent(recipientScope!.id)}`, { headers }).then((response) => response.json()) as { activeScope: string, items: Array<{ name: string }> }
	expect(recipientDesign.activeScope).toBe(recipientScope!.id)
	expect(recipientDesign.items.map((item) => item.name)).toEqual(['photo.png', 'photo.png'])
	const requestKey = `guided_${Date.now()}`
	const first = await request.post(`${event}/deliver?format=json`, { headers, data: { setupRevision: saved.revision, requestKey } })
	const second = await request.post(`${event}/deliver?format=json`, { headers, data: { setupRevision: saved.revision, requestKey } })
	expect(first.status()).toBe(201)
	expect(second.status()).toBe(201)
	const firstDelivery = await first.json() as { gallery: { shareToken: string | null }, wave: { id: number, status: string } }
	const secondDelivery = await second.json() as { wave: { id: number } }
	expect(firstDelivery.gallery.shareToken).toBeNull()
	expect(firstDelivery.wave.status).toBe('draft')
	expect(secondDelivery.wave.id).toBe(firstDelivery.wave.id)
	const configuredLinks = await request.get(`${event}/recipient-links?format=json&keys=guidedrecipient1`, { headers })
	expect(configuredLinks.status()).toBe(200)
	expect(await configuredLinks.json()).toMatchObject({ items: [{ setupKey: 'guidedrecipient1', waveId: firstDelivery.wave.id }] })
	const released = await request.post(`${event}/waves/${firstDelivery.wave.id}/release?format=json`, { headers })
	expect(released.status()).toBe(202)
	const releasedDelivery = await released.json() as { gallery: { shareToken: string | null }, wave: { status: string } }
	expect(releasedDelivery.gallery.shareToken).toBeTruthy()
	expect(releasedDelivery.wave.status).toBe('releasing')
	const operations = await request.get(`${event}/operations?format=json`, { headers }).then((response) => response.json()) as { summary: { total: number }, waves: Array<{ id: number, status: string }> }
	expect(operations.summary.total).toBeGreaterThanOrEqual(1)
	expect(operations.waves).toContainEqual(expect.objectContaining({ id: firstDelivery.wave.id }))
	const technicalBase = await request.get(`${baseURL}/index.php/apps/proofing_gallery/public/${releasedDelivery.gallery.shareToken}/gallery`).then((response) => response.json()) as { items: unknown[] }
	expect(technicalBase.items).toEqual([])
	const legacyDraftResponse = await request.post(`${event}/deliver?format=json`, { headers, data: { setupRevision: saved.revision, requestKey: `guided_legacy_${Date.now()}` } })
	const legacyDraft = await legacyDraftResponse.json() as { wave: { id: number } }
	const legacyRelease = await request.post(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${gallery.id}/event/waves/${legacyDraft.wave.id}/release?format=json`, { headers })
	expect(legacyRelease.status()).toBe(202)
	expect(await legacyRelease.json()).toMatchObject({ id: legacyDraft.wave.id, status: 'releasing' })
})
