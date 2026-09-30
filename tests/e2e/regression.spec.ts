import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import AxeBuilder from '@axe-core/playwright'
import { expect, request as requestFactory, test } from '@playwright/test'

import { expectSuccessToast } from './dialogs.ts'

const auth = `Basic ${Buffer.from('admin:admin').toString('base64')}`
const apiHeaders = { Authorization: auth, 'OCS-APIRequest': 'true' }
const execFileAsync = promisify(execFile)
const mailpitUrl = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026'

async function state(): Promise<{ galleryId: number, token: string, folderId: number, largeFolderId: number }> {
	return JSON.parse(await readFile(path.join(process.cwd(), 'test-results-e2e-state.json'), 'utf8'))
}

test('design assets are reusable and cannot be deleted while referenced', async ({ request, baseURL }) => {
	const stable = await state()
	const assets = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/design-assets`
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAFklEQVQImWP8z8DAwMDAxMDAwMDAAAANHQEDDMfniQAAAABJRU5ErkJggg==', 'base64')
	const uploaded = await request.post(`${assets}?format=json`, {
		headers: apiHeaders,
		multipart: {
			kind: 'watermark',
			asset: { name: 'studio-mark.png', mimeType: 'image/png', buffer: png },
		},
	})
	const uploadedBody = await uploaded.text()
	expect(uploaded.status(), uploadedBody).toBe(201)
	const asset = JSON.parse(uploadedBody) as { id: string; name: string; kind: string; mimeType: string }
	expect(asset).toEqual(expect.objectContaining({ name: 'studio-mark.png', kind: 'watermark', mimeType: 'image/png' }))

	const listed = await request.get(`${assets}?format=json&kind=watermark`, { headers: apiHeaders })
	expect(listed.status()).toBe(200)
	expect((await listed.json() as { items: Array<{ id: string }> }).items.map(item => item.id)).toContain(asset.id)
	const content = await request.get(`${assets}/${asset.id}?format=json`, { headers: apiHeaders })
	expect(content.status()).toBe(200)
	expect(content.headers()['content-type']).toContain('image/png')
	const rejected = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { folderId: stable.folderId, title: `E2E Foreign asset ${Date.now()}`, settings: { presentation: { watermarkImageAssetId: 'b'.repeat(32) } } },
	})
	expect(rejected.status()).toBe(422)

	const created = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { folderId: stable.folderId, title: `E2E Design assets ${Date.now()}`, settings: { presentation: { watermarkImageAssetId: asset.id } } },
	})
	expect(created.status()).toBe(201)
	let gallery = await created.json() as { id: number; revision: number }
	expect((await request.delete(`${assets}/${asset.id}?format=json`, { headers: apiHeaders })).status()).toBe(409)

	const detached = await request.put(`${galleries}/${gallery.id}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { expectedRevision: gallery.revision, settings: { presentation: { watermarkImageAssetId: null } } },
	})
	expect(detached.status()).toBe(200)
	gallery = await detached.json() as { id: number; revision: number }
	expect((await request.delete(`${assets}/${asset.id}?format=json`, { headers: apiHeaders })).status()).toBe(200)
	expect((await request.get(`${assets}/${asset.id}?format=json`, { headers: apiHeaders })).status()).toBe(404)
	await request.delete(`${galleries}/${gallery.id}?format=json`, { headers: apiHeaders })
})

test('uploaded gallery logos use the authenticated image route', async ({ request, baseURL }) => {
	const stable = await state()
	const assets = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/design-assets`
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAFklEQVQImWP8z8DAwMDAxMDAwMDAAAANHQEDDMfniQAAAABJRU5ErkJggg==', 'base64')
	const uploaded = await request.post(`${assets}?format=json`, {
		headers: apiHeaders,
		multipart: { kind: 'logo', asset: { name: 'wordmark.png', mimeType: 'image/png', buffer: png } },
	})
	expect(uploaded.status()).toBe(201)
	const asset = await uploaded.json() as { id: string }
	const created = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: {
			folderId: stable.folderId,
			title: `E2E uploaded logo ${Date.now()}`,
			settings: { presentation: { logoMode: 'upload', logoAssetId: asset.id } },
		},
	})
	expect(created.status()).toBe(201)
	const gallery = await created.json() as { id: number; settings: { schemaVersion: number; presentation: { logoBackground: string } } }
	try {
		expect(gallery.settings.schemaVersion).toBe(12)
		expect(gallery.settings.presentation.logoBackground).toBe('light')
		const logo = await request.get(`${baseURL}/apps/proofing_gallery/media/${gallery.id}/asset/logo`, { headers: apiHeaders })
		expect(logo.status()).toBe(200)
		expect(logo.headers()['content-type']).toContain('image/png')
		expect((await logo.body()).length).toBeGreaterThan(0)
	} finally {
		await request.delete(`${galleries}/${gallery.id}?format=json`, { headers: apiHeaders })
		await request.delete(`${assets}/${asset.id}?format=json`, { headers: apiHeaders })
	}
})

test('owner design preview renders and caches the exact watermark settings', async ({ request, baseURL }) => {
	const stable = await state()
	const media = await request.get(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/media?format=json&limit=1`, { headers: apiHeaders })
	const fileId = (await media.json() as { items: Array<{ id: number }> }).items[0]!.id
	const presentation = encodeURIComponent(JSON.stringify({ watermarkText: `Cache ${Date.now()}`, watermarkTextPosition: 'center', watermarkTextSize: 22 }))
	const endpoint = `${baseURL}/apps/proofing_gallery/media/${stable.galleryId}/${fileId}/design-preview?x=320&y=240&mode=cover&presentation=${presentation}`
	const first = await request.get(endpoint, { headers: apiHeaders })
	expect(first.status()).toBe(200)
	expect(first.headers()['content-type']).toMatch(/^image\/(?:png|webp)/)
	expect(first.headers()['x-proofing-derivative-cache']).toBe('miss')
	const second = await request.get(endpoint, { headers: apiHeaders })
	expect(second.status()).toBe(200)
	expect(second.headers()['x-proofing-derivative-cache']).toBe('hit')
	expect(await second.body()).toEqual(await first.body())
})

test('story media remains available beyond the current page without escaping the share scope', async ({ request, baseURL }) => {
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const mediaSource = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { folderId: stable.largeFolderId, title: `E2E story source ${Date.now()}` },
	}).then(response => response.json()) as { id: number }
	const mediaResponse = await request.get(`${galleries}/${mediaSource.id}/media?format=json&limit=2`, { headers: apiHeaders })
	const sourceItems = (await mediaResponse.json() as { items: Array<{ id: number }> }).items
	expect(sourceItems.length).toBeGreaterThan(1)
	const storyFileId = sourceItems[1]!.id
	const created = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: {
			folderId: stable.largeFolderId,
			title: `E2E paginated story ${Date.now()}`,
			settings: { presentation: { layout: 'story', story: { sections: [{ id: 'story_page_two', title: '', body: '', style: 'full', mediaIds: [storyFileId] }], showAllMedia: true } } },
		},
	})
	expect(created.status()).toBe(201)
	const gallery = await created.json() as { id: number }
	try {
		const resolved = await request.get(`${galleries}/${gallery.id}/story-media?format=json&fileIds=${storyFileId}`, { headers: apiHeaders })
		expect(resolved.status()).toBe(200)
		expect((await resolved.json() as { items: Array<{ id: number }> }).items.map(item => item.id)).toEqual([storyFileId])
		const published = await request.post(`${galleries}/${gallery.id}/publish?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { allowDownloads: false },
		}).then(response => response.json()) as { gallery: { shareToken: string } }
		const page = await request.get(`${baseURL}/apps/proofing_gallery/public/${published.gallery.shareToken}/gallery?limit=1&page=1`)
		expect(page.status()).toBe(200)
		const payload = await page.json() as { items: Array<{ id: number }>; s: Array<{ id: number; name: string }> }
		expect(payload.items).toHaveLength(1)
		expect(payload.items[0]?.id).not.toBe(storyFileId)
		expect(payload.s).toEqual([expect.objectContaining({ id: storyFileId, name: expect.any(String) })])
	} finally {
		await request.delete(`${galleries}/${gallery.id}?format=json`, { headers: apiHeaders })
		await request.delete(`${galleries}/${mediaSource.id}?format=json`, { headers: apiHeaders })
	}
})

test('installed Nextcloud collaboration apps are discovered @ecosystem', async ({ request, baseURL }) => {
	test.skip(process.env.E2E_ECOSYSTEM !== '1', 'Set E2E_ECOSYSTEM=1 with Calendar, Deck, and Talk installed')
	const stable = await state()
	const response = await request.get(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/review-integrations?format=json`, { headers: apiHeaders })
	expect(response.status()).toBe(200)
	const integrations = await response.json() as { calendar: { available: boolean }; deck: { available: boolean }; talk: { available: boolean } }
	expect(integrations.calendar.available).toBe(true)
	expect(integrations.deck.available).toBe(true)
	expect(integrations.talk.available).toBe(true)
})

test('application boot does not reset periodic background-job timestamps', async ({ request, baseURL }) => {
	const listJobs = async () => {
		const result = await execFileAsync('docker', [
			'compose', 'exec', '-T', '--user', 'www-data', 'nextcloud', 'php', 'occ', 'background-job:list', '--output=json',
		], { cwd: process.cwd() })
		return JSON.parse(result.stdout) as Array<{ id: number; class: string; last_run: number }>
	}
	const jobClass = 'OCA\\ProofingGallery\\BackgroundJob\\CleanupGalleryDataJob'
	const before = (await listJobs()).find(item => item.class === jobClass)
	expect(before).toBeDefined()
	for (let index = 0; index < 5; index++) {
		expect((await request.get(`${baseURL}/apps/proofing_gallery/`)).status()).toBeLessThan(500)
	}
	const after = (await listJobs()).find(item => item.class === jobClass)
	expect(after).toBeDefined()
	expect(after!.id).toBe(before!.id)
	expect(after!.last_run).toBe(before!.last_run)
})

test('archiving suspends native and app access and restore keeps the token', async ({ request, baseURL }) => {
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const created = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { folderId: stable.folderId, title: `E2E Archive ${Date.now()}` },
	})
	expect(created.status()).toBe(201)
	const galleryId = (await created.json() as { id: number }).id
	const published = await request.post(`${galleries}/${galleryId}/publish?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { allowDownloads: true },
	})
	expect(published.status()).toBe(200)
	const token = (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken
	expect((await request.get(`${baseURL}/s/${token}`)).status()).toBe(200)
	const publicDavHeaders = { Depth: '0', Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` }
	expect((await request.fetch(`${baseURL}/public.php/dav/files/${token}/`, {
		method: 'PROPFIND',
		headers: publicDavHeaders,
	})).status()).toBe(207)

	const archived = await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
	expect(archived.status()).toBe(200)
	expect((await archived.json() as { status: string }).status).toBe('archived')
	const privacyUrl = `${galleries}/${galleryId}/privacy`
	const privacy = await request.get(`${privacyUrl}?format=json`, { headers: apiHeaders })
	expect(privacy.status()).toBe(200)
	expect(await privacy.json()).toEqual(expect.objectContaining({ graceDays: 30, originalFilesAffected: false, activeRequest: null }))
	const exported = await request.get(`${privacyUrl}/export?format=json`, { headers: apiHeaders })
	expect(exported.status()).toBe(200)
	expect(exported.headers()['content-type']).toContain('application/x-ndjson')
	expect(await exported.text()).not.toContain(token)
	const scheduled = await request.post(`${privacyUrl}/purge?format=json`, { headers: apiHeaders })
	expect(scheduled.status()).toBe(201)
	const requestId = (await scheduled.json() as { id: number }).id
	expect(requestId).toBeGreaterThan(0)
	expect((await request.delete(`${privacyUrl}/purge/${requestId}?format=json`, { headers: apiHeaders })).status()).toBe(204)
	const archivedPage = await request.get(`${baseURL}/s/${token}`)
	expect(archivedPage.status()).toBe(404)
	expect(await archivedPage.text()).toContain('Gallery unavailable')
	expect([401, 403, 404, 405]).toContain((await request.fetch(`${baseURL}/public.php/dav/files/${token}/`, {
		method: 'PROPFIND',
		headers: publicDavHeaders,
	})).status())

	const restored = await request.post(`${galleries}/${galleryId}/restore?format=json`, { headers: apiHeaders })
	expect(restored.status()).toBe(200)
	const restoredGallery = await restored.json() as { status: string, shareToken: string }
	expect(restoredGallery).toEqual(expect.objectContaining({ status: 'published', shareToken: token }))
	expect((await request.get(`${baseURL}/s/${token}`)).status()).toBe(200)

	await request.delete(`${galleries}/${galleryId}/publish?format=json`, { headers: apiHeaders })
	await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
})

test('scheduled privacy purge removes app data but preserves original files', async ({ request, baseURL }) => {
	test.setTimeout(120_000)
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const created = await request.post(`${galleries}?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: { folderId: stable.folderId, title: `E2E Purge ${Date.now()}` },
	})
	expect(created.status()).toBe(201)
	const galleryId = (await created.json() as { id: number }).id
	await request.post(`${galleries}/${galleryId}/publish?format=json`, { headers: apiHeaders })
	expect((await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })).status()).toBe(200)
	const scheduled = await request.post(`${galleries}/${galleryId}/privacy/purge?format=json`, { headers: apiHeaders })
	expect(scheduled.status()).toBe(201)
	const requestId = (await scheduled.json() as { id: number }).id

	const php = 'require "/var/www/html/lib/base.php"; $db=\\OC::$server->get(\\OCP\\IDBConnection::class); $q=$db->getQueryBuilder(); $q->update("proofing_purge_requests")->set("execute_after", $q->createNamedParameter(0, \\OCP\\DB\\QueryBuilder\\IQueryBuilder::PARAM_INT))->where($q->expr()->eq("id", $q->createNamedParameter((int)$argv[1], \\OCP\\DB\\QueryBuilder\\IQueryBuilder::PARAM_INT)))->executeStatement();'
	await execFileAsync('docker', ['compose', 'exec', '-T', '--user', 'www-data', 'nextcloud', 'php', '-r', php, String(requestId)], { cwd: process.cwd() })

	for (let iteration = 0; iteration < 50; iteration++) {
		const list = await execFileAsync('docker', ['compose', 'exec', '-T', '--user', 'www-data', 'nextcloud', 'php', 'occ', 'background-job:list', '--output=json'], { cwd: process.cwd() })
		const jobs = JSON.parse(list.stdout) as Array<{ id: number; class: string }>
		const job = jobs.find(item => item.class.endsWith(iteration === 0 ? 'ProcessPurgeRequestsJob' : 'ContinuePurgeRequestsJob'))
		if (!job) {
			if (iteration === 0) throw new Error('Purge worker is not registered')
			break
		}
		await execFileAsync('docker', ['compose', 'exec', '-T', '--user', 'www-data', 'nextcloud', 'php', 'occ', 'background-job:execute', '--force-execute', String(job.id)], { cwd: process.cwd() })
	}

	expect((await request.get(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })).status()).toBe(404)
	expect((await request.get(`${baseURL}/remote.php/dav/files/admin/ProofingGalleryE2E/proof.png`, { headers: apiHeaders })).status()).toBe(200)
})

test('source cache refreshes and a missing published source recovers without changing its token', async ({ request, baseURL }) => {
	const stable = await state()
	const folderName = `ProofingGalleryRecovery-${Date.now()}`
	const dav = `${baseURL}/remote.php/dav/files/admin/${folderName}`
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	let galleryId: number | null = null

	try {
		expect((await request.fetch(dav, { method: 'MKCOL', headers: apiHeaders })).status()).toBe(201)
		const propfind = await request.fetch(dav, {
			method: 'PROPFIND',
			headers: { ...apiHeaders, Depth: '0', 'Content-Type': 'application/xml' },
			data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
		})
		const xml = await propfind.text()
		const folderId = Number(xml.match(/<(?:oc:)?fileid>(\d+)<\/(?:oc:)?fileid>/)?.[1])
		expect(folderId).toBeGreaterThan(0)

		const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
		expect((await request.put(`${dav}/one.png`, { headers: { ...apiHeaders, 'Content-Type': 'image/png' }, data: image })).ok()).toBe(true)

		const created = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId, title: 'Recovery regression' },
		})
		const gallery = await created.json() as { id: number, mediaSummary: { total: number } }
		galleryId = gallery.id
		expect(gallery.mediaSummary.total).toBe(1)

		expect((await request.put(`${dav}/two.png`, { headers: { ...apiHeaders, 'Content-Type': 'image/png' }, data: image })).ok()).toBe(true)
		const refreshed = await request.get(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders }).then(response => response.json()) as {
			mediaSummary: { total: number }
		}
		expect(refreshed.mediaSummary.total).toBe(2)

		const published = await request.post(`${galleries}/${galleryId}/publish?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { allowDownloads: true },
		}).then(response => response.json()) as { gallery: { shareToken: string } }
		const token = published.gallery.shareToken

		expect((await request.delete(dav, { headers: apiHeaders })).ok()).toBe(true)
		const missing = await request.get(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders }).then(response => response.json()) as {
			source: { state: string }
		}
		expect(missing.source.state).toBe('missing')

		const rebound = await request.put(`${galleries}/${galleryId}/source?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId },
		}).then(response => response.json()) as { shareToken: string, source: { state: string } }
		expect(rebound.source.state).toBe('readable')
		expect(rebound.shareToken).toBe(token)
		expect((await request.get(`${baseURL}/s/${token}`)).ok()).toBe(true)
	} finally {
		if (galleryId !== null) {
			await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
		}
		await request.delete(dav, { headers: apiHeaders })
	}
})

test('public HTML bootstraps media without a gallery discovery request', async ({ page, baseURL }) => {
	const { token } = await state()
	const discoveryRequests: string[] = []
	const failedAppResponses: string[] = []
	page.on('request', request => {
		if (/\/public\/[^/]+\/gallery(?:\?|$)/.test(request.url())) discoveryRequests.push(request.url())
	})
	page.on('response', response => {
		if (response.url().includes('/apps/proofing_gallery/') && response.status() >= 400) {
			failedAppResponses.push(`${response.status()} ${response.url()}`)
		}
	})

	await page.goto(`${baseURL}/s/${token}`)
	await expect(page.getByRole('button', { name: 'Open proof.png' })).toBeVisible()
	expect(discoveryRequests).toEqual([])
	expect(failedAppResponses).toEqual([])
})

test('owner chunk uploads expose resumable state and finalize into the gallery', async ({ request, baseURL }) => {
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
	let galleryId: number | null = null
	let fileId: number | null = null

	try {
		const created = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId, title: `Owner upload ${Date.now()}` },
		})
		galleryId = (await created.json() as { id: number }).id
		const uploads = `${galleries}/${galleryId}/owner-uploads`
		const initiated = await request.post(`${uploads}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { filename: `resumable-${Date.now()}.png`, mimeType: 'image/png', size: image.length, conflict: 'rename' },
		})
		expect(initiated.status()).toBe(201)
		const session = await initiated.json() as { id: string; chunkSize: number; chunks: number; uploadedChunks: number[] }
		expect(session).toEqual(expect.objectContaining({ chunks: 1, uploadedChunks: [] }))

		const chunk = await request.put(`${uploads}/${session.id}/chunks/0?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/octet-stream' },
			data: image,
		})
		expect(chunk.status()).toBe(200)
		const resumable = await request.get(`${uploads}/${session.id}?format=json`, { headers: apiHeaders })
		expect(await resumable.json()).toEqual(expect.objectContaining({ uploadedChunks: [0] }))

		const finalized = await request.post(`${uploads}/${session.id}/finalize?format=json`, { headers: apiHeaders })
		expect(finalized.status()).toBe(200)
		const result = await finalized.json() as { status: string; item: { id: number; mimeType: string } }
		expect(result).toEqual(expect.objectContaining({ status: 'completed', item: expect.objectContaining({ mimeType: 'image/png' }) }))
		fileId = result.item.id
	} finally {
		if (galleryId !== null && fileId !== null) await request.delete(`${galleries}/${galleryId}/media/${fileId}?format=json`, { headers: apiHeaders })
		if (galleryId !== null) await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
	}
})

test('parallel owner uploads commit with conflict-free names', async ({ request, baseURL }) => {
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
	let galleryId: number | null = null
	const fileIds: number[] = []

	try {
		const created = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId, title: `Parallel owner upload ${Date.now()}` },
		})
		galleryId = (await created.json() as { id: number }).id
		const uploads = `${galleries}/${galleryId}/owner-uploads`
		const initiated = await request.post(`${uploads}/batch?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { uploads: Array.from({ length: 3 }, () => ({ filename: 'parallel-proof.png', mimeType: 'image/png', size: image.length, conflict: 'rename' })) },
		})
		expect(initiated.status()).toBe(201)
		const sessions = (await initiated.json() as { uploads: Array<{ id: string; state: string }> }).uploads
		expect(sessions).toHaveLength(3)
		expect(sessions.every(session => session.state === 'pending')).toBe(true)

		const finalized = await Promise.all(sessions.map(session => request.put(`${uploads}/${session.id}/content?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/octet-stream' },
			data: image,
		})))
		expect(finalized.map(response => response.status())).toEqual([200, 200, 200])
		const items = await Promise.all(finalized.map(response => response.json() as Promise<{ item: { id: number; name: string } }>))
		fileIds.push(...items.map(result => result.item.id))
		expect(new Set(items.map(result => result.item.name)).size).toBe(3)
	} finally {
		if (galleryId !== null) {
			for (const fileId of fileIds) await request.delete(`${galleries}/${galleryId}/media/${fileId}?format=json`, { headers: apiHeaders })
			await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
		}
	}
})

test('owner upload conflicts can replace a file without retransmitting stale chunks', async ({ request, baseURL }) => {
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
	const filename = `replace-${Date.now()}.png`
	let galleryId: number | null = null
	let currentFileId: number | null = null

	try {
		const created = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId, title: `Owner replace ${Date.now()}` },
		})
		galleryId = (await created.json() as { id: number }).id
		const uploads = `${galleries}/${galleryId}/owner-uploads`
		const upload = async (conflict: 'rename' | 'overwrite', expectedFileId?: number, expectedEtag?: string) => {
			const initiated = await request.post(`${uploads}?format=json`, {
				headers: { ...apiHeaders, 'Content-Type': 'application/json' },
				data: { filename, mimeType: 'image/png', size: image.length, conflict, expectedFileId, expectedEtag },
			})
			const session = await initiated.json() as { id: string }
			expect((await request.put(`${uploads}/${session.id}/chunks/0?format=json`, {
				headers: { ...apiHeaders, 'Content-Type': 'application/octet-stream' },
				data: image,
			})).status()).toBe(200)
			return session.id
		}

		const firstSession = await upload('rename')
		const first = await request.post(`${uploads}/${firstSession}/finalize?format=json`, { headers: apiHeaders })
		const firstItem = (await first.json() as { item: { id: number; etag: string } }).item
		currentFileId = firstItem.id

		const preflight = await request.post(`${galleries}/${galleryId}/owner-upload-conflicts?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { filenames: [filename], path: '' },
		})
		expect(preflight.status()).toBe(200)
		const conflict = (await preflight.json() as { conflicts: Record<string, { id: number; etag: string }> }).conflicts[filename]
		expect(conflict.id).toBe(firstItem.id)

		const replacementSession = await upload('overwrite', conflict.id, 'stale-etag')
		const stale = await request.post(`${uploads}/${replacementSession}/finalize?format=json`, { headers: apiHeaders })
		expect(stale.status()).toBe(409)
		expect((await stale.json() as { code: string }).code).toBe('upload_conflict')
		expect((await request.put(`${uploads}/${replacementSession}/resolution?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { conflict: 'overwrite', expectedFileId: conflict.id, expectedEtag: conflict.etag },
		})).status()).toBe(200)

		const replaced = await request.post(`${uploads}/${replacementSession}/finalize?format=json`, { headers: apiHeaders })
		expect(replaced.status()).toBe(200)
		const replacedItem = (await replaced.json() as { item: { id: number; name: string } }).item
		expect(replacedItem.id).not.toBe(firstItem.id)
		expect(replacedItem.name).toBe(filename)
		currentFileId = replacedItem.id
	} finally {
		if (galleryId !== null && currentFileId !== null) await request.delete(`${galleries}/${galleryId}/media/${currentFileId}?format=json`, { headers: apiHeaders })
		if (galleryId !== null) await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
	}
})

test('parallel guest uploads finalize into the inbox with conflict-free names', async ({ request, baseURL }) => {
	const guestRequest = await requestFactory.newContext()
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
	let galleryId: number | null = null
	const uploadIds: string[] = []

	try {
		const created = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId, title: `Parallel guest upload ${Date.now()}`, settings: { allowGuestUploads: true } },
		})
		galleryId = (await created.json() as { id: number }).id
		const published = await request.post(`${galleries}/${galleryId}/publish?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { allowDownloads: false },
		})
		expect(published.status()).toBe(200)
		const token = (await published.json() as { gallery: { shareToken: string } }).gallery.shareToken
		const publicEndpoint = `${baseURL}/index.php/apps/proofing_gallery/public/${token}`
		const session = await guestRequest.post(`${publicEndpoint}/session`, { data: { displayName: 'Parallel uploader' } })
		expect(session.status()).toBe(201)
		const nonce = (await session.json() as { nonce: string }).nonce
		const headers = { 'Content-Type': 'application/json', 'X-Proofing-Nonce': nonce }
		const uploads = await Promise.all(Array.from({ length: 3 }, async () => {
			const initiated = await guestRequest.post(`${publicEndpoint}/uploads`, {
				headers,
				data: { filename: 'guest-proof.png', mimeType: 'image/png', size: image.length },
			})
			expect(initiated.status()).toBe(201)
			const upload = await initiated.json() as { id: string }
			uploadIds.push(upload.id)
			expect((await guestRequest.put(`${publicEndpoint}/uploads/${upload.id}/chunks/0`, {
				headers: { 'Content-Type': 'application/octet-stream', 'X-Proofing-Nonce': nonce },
				data: image,
			})).status()).toBe(200)
			return upload
		}))

		const finalized = await Promise.all(uploads.map(upload => guestRequest.post(`${publicEndpoint}/uploads/${upload.id}/finalize`, { headers })))
		expect(finalized.map(response => response.status())).toEqual([200, 200, 200])
		const inbox = await request.get(`${galleries}/${galleryId}/inbox?format=json`, { headers: apiHeaders }).then(response => response.json()) as Array<{ upload_id: string; filename: string }>
		const rows = inbox.filter(row => uploadIds.includes(row.upload_id))
		expect(rows).toHaveLength(3)
		expect(new Set(rows.map(row => row.filename)).size).toBe(3)
	} finally {
		await guestRequest.dispose()
		if (galleryId !== null) {
			for (const uploadId of uploadIds) await request.delete(`${galleries}/${galleryId}/inbox/${uploadId}?format=json`, { headers: apiHeaders })
			await request.delete(`${galleries}/${galleryId}/publish?format=json`, { headers: apiHeaders })
			await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
		}
	}
})

test('Live Push credentials are upload-only, independently rotated and revoked', async ({ request, baseURL }) => {
	const stable = await state()
	const adminSettings = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/settings?format=json`
	const livePush = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/live-push?format=json`
	const original = await request.get(adminSettings, { headers: apiHeaders }).then(response => response.json()) as {
		instanceSettings: { livePush: { enabled: boolean } }
	}
	let uploadedFileId: number | null = null
	try {
		const enabled = await request.put(adminSettings, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { instanceSettings: { livePush: { enabled: true } } },
		})
		expect(enabled.status()).toBe(200)
		const created = await request.post(livePush, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { label: 'E2E camera', path: '' },
		})
		expect(created.status()).toBe(201)
		const credential = await created.json() as { id: number; username: string; password: string }
		expect(credential.password).toHaveLength(48)

		const ingress = `${baseURL}/apps/proofing_gallery/live-push/upload?filename=live-push.png`
		expect((await request.put(ingress, { headers: { Authorization: 'Basic invalid' }, data: Buffer.from('invalid') })).status()).toBe(401)
		const uploaded = await request.put(ingress, {
			headers: { Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`, 'Content-Type': 'image/png' },
			data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3vTnWQAAAABJRU5ErkJggg==', 'base64'),
		})
		expect(uploaded.status()).toBe(201)
		uploadedFileId = (await uploaded.json() as { item: { id: number } }).item.id

		const rotated = await request.post(livePush.replace('?format=json', `/${credential.id}/rotate?format=json`), { headers: apiHeaders })
		expect(rotated.status()).toBe(200)
		const replacement = await rotated.json() as { password: string }
		expect(replacement.password).not.toBe(credential.password)
		expect((await request.put(ingress, { headers: { Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}` }, data: Buffer.from('old') })).status()).toBe(401)
		expect((await request.delete(livePush.replace('?format=json', `/${credential.id}?format=json`), { headers: apiHeaders })).status()).toBe(204)
		expect((await request.put(ingress, { headers: { Authorization: `Basic ${Buffer.from(`${credential.username}:${replacement.password}`).toString('base64')}` }, data: Buffer.from('revoked') })).status()).toBe(401)
	} finally {
		if (uploadedFileId !== null) await request.delete(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/media/${uploadedFileId}?format=json`, { headers: apiHeaders })
		await request.put(adminSettings, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { instanceSettings: { livePush: original.instanceSettings.livePush } },
		})
	}
})

test('custom domains require administrator DNS and HTTPS verification and revoke safely', async ({ request, baseURL }) => {
	const stable = await state()
	const adminSettings = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/settings?format=json`
	const adminDomains = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/domains?format=json`
	const domains = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/domains?format=json`
	const links = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/public-links?format=json`
	const original = await request.get(adminSettings, { headers: apiHeaders }).then(response => response.json()) as {
		instanceSettings: { customDomains: { enabled: boolean } }
	}
	let domainId: number | null = null
	try {
		expect((await request.put(adminSettings, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { instanceSettings: { customDomains: { enabled: true } } },
		})).status()).toBe(200)
		const publicLinks = await request.get(links, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ id: number; status: string }> }
		const link = publicLinks.items.find(item => item.status === 'active')
		expect(link).toBeDefined()
		expect((await request.post(domains, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' }, data: { publicLinkId: link!.id, domain: 'gallery.invalid' },
		})).status()).toBe(422)
		const requestedDomain = `gallery-${Date.now()}.example.com`
		const requested = await request.post(domains, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' }, data: { publicLinkId: link!.id, domain: requestedDomain },
		})
		expect(requested.status()).toBe(201)
		const mapping = await requested.json() as { id: number; status: string; verificationName: string; verificationValue: string }
		domainId = mapping.id
		expect(mapping).toEqual(expect.objectContaining({ status: 'pending', verificationName: expect.stringMatching(/^_proofing-gallery\./), verificationValue: expect.stringMatching(/^proofing-gallery-verification=/) }))
		const pendingPage = await request.get(`${adminDomains}&status=pending&search=${encodeURIComponent(requestedDomain)}&limit=1`, { headers: apiHeaders })
		expect(pendingPage.status()).toBe(200)
		expect(await pendingPage.json()).toEqual(expect.objectContaining({
			items: [expect.objectContaining({ id: domainId, domain: requestedDomain, status: 'pending' })],
			total: 1,
			nextCursor: null,
		}))
		expect((await request.get(`${adminDomains}&status=unknown`, { headers: apiHeaders })).status()).toBe(422)
		expect((await request.get(`${adminDomains}&cursor=not-a-cursor`, { headers: apiHeaders })).status()).toBe(422)
		expect((await request.post(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/domains/${domainId}/verify?format=json`, { headers: apiHeaders })).status()).toBe(422)
		const anonymousRequest = await requestFactory.newContext()
		expect((await anonymousRequest.post(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/domains/${domainId}/verify?format=json`, {
			headers: { 'OCS-APIRequest': 'true' },
		})).status()).toBe(401)
		await anonymousRequest.dispose()
		expect((await request.delete(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/domains/${domainId}?format=json`, { headers: apiHeaders })).status()).toBe(204)
		const revokedPage = await request.get(`${adminDomains}&status=revoked&search=${encodeURIComponent(requestedDomain)}`, { headers: apiHeaders })
		expect(revokedPage.status()).toBe(200)
		expect(await revokedPage.json()).toEqual(expect.objectContaining({
			items: expect.arrayContaining([expect.objectContaining({ id: domainId, status: 'revoked' })]),
		}))
		domainId = null
		expect((await request.get(`${baseURL}/apps/proofing_gallery/domain`)).status()).toBe(404)
	} finally {
		if (domainId !== null) await request.delete(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/domains/${domainId}?format=json`, { headers: apiHeaders })
		await request.put(adminSettings, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' }, data: { instanceSettings: { customDomains: original.instanceSettings.customDomains } },
		})
	}
})

test('administrator policies reject out-of-range API values and health remains accessible', async ({ browser, request, baseURL }) => {
	const unauthorized = await request.put(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/policies?format=json`, {
		headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json' },
		data: {
			maxUploadMiB: 1,
			maxSelectionFiles: 1,
			maxSelectionMiB: 1,
			eventRetentionDays: 7,
			previewRetentionDays: 1,
			pendingUploadRetentionHours: 1,
			completedUploadRetentionDays: 7,
		},
	})
	expect(unauthorized.status()).toBe(401)

	const invalid = await request.put(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/policies?format=json`, {
		headers: { ...apiHeaders, 'Content-Type': 'application/json' },
		data: {
			maxUploadMiB: 0,
			maxSelectionFiles: 100,
			maxSelectionMiB: 1024,
			eventRetentionDays: 180,
			previewRetentionDays: 30,
			pendingUploadRetentionHours: 24,
			completedUploadRetentionDays: 365,
		},
	})
	expect(invalid.status()).toBe(422)
	const settings = await request.get(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/settings?format=json`, {
		headers: apiHeaders,
	})
	expect(settings.status()).toBe(200)
	const settingsDocument = await settings.json() as {
		instanceSettings: { schemaVersion: number; media: { videoTranscoding: boolean; transcodeConcurrency: number }; semantic: { provider: string; externalTransfer: boolean } }
		coreSharing: { publicLinksAllowed: boolean }
		health: { video: { available: boolean; pending: number; failed: number } }
	}
	expect(settingsDocument.instanceSettings.schemaVersion).toBe(2)
	expect(settingsDocument.instanceSettings.media.videoTranscoding).toBe(true)
	expect(settingsDocument.instanceSettings.media.transcodeConcurrency).toBeGreaterThanOrEqual(1)
	expect(settingsDocument.instanceSettings.semantic).toEqual(expect.objectContaining({ provider: 'disabled', externalTransfer: false }))
	expect(typeof settingsDocument.coreSharing.publicLinksAllowed).toBe('boolean')
	expect(typeof settingsDocument.health.video.available).toBe('boolean')
	const logoEndpoint = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/branding/logo?format=json`
	const uploadedLogo = await request.post(logoEndpoint, {
		headers: apiHeaders,
		multipart: {
			logo: {
				name: 'studio.svg',
				mimeType: 'image/svg+xml',
				buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#9b4a32"/></svg>'),
			},
		},
	})
	expect(uploadedLogo.status()).toBe(201)
	expect((await uploadedLogo.json() as { asset: { id: string } }).asset.id).toMatch(/^[A-Za-z0-9]{32}\.svg$/)
	const displayedLogo = await request.get(logoEndpoint, { headers: apiHeaders })
	expect(displayedLogo.status()).toBe(200)
	expect(displayedLogo.headers()['content-type']).toContain('image/svg+xml')
	expect((await request.delete(logoEndpoint, { headers: apiHeaders })).status()).toBe(200)
	const galleryPage = await request.get(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/galleries?format=json&limit=3`, { headers: apiHeaders })
	expect(galleryPage.status()).toBe(200)
	expect((await galleryPage.json() as { items: unknown[] }).items).toHaveLength(3)

	const context = await browser.newContext()
	const page = await context.newPage()
	await page.goto(`${baseURL}/settings/admin/proofing_gallery`)
	await page.getByRole('textbox', { name: /Account name/ }).fill('admin')
	await page.getByRole('textbox', { name: 'Password' }).fill('admin')
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await expect(page.getByRole('heading', { level: 2, name: 'Proofing Gallery' })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Access and features' })).toBeVisible()
	await expect(page.getByLabel('Layout')).toBeVisible()
	await expect(page.getByLabel('Tile size')).toBeVisible()
	await expect(page.getByLabel('Spacing')).toBeVisible()
	await expect(page.getByLabel('Corners')).toBeVisible()
	const rolloutPage = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/v1/admin/galleries'))
	await page.getByRole('button', { name: 'Choose galleries' }).click()
	expect((await rolloutPage).status()).toBe(200)
	await expect(page.getByText('Select all shown')).toBeVisible()
	await page.getByRole('button', { name: /^Media/ }).click()
	await expect(page.getByRole('heading', { name: 'Video delivery' })).toBeVisible()
	await expect(page.getByLabel('FFmpeg executable')).toHaveValue('ffmpeg')
	await expect(page.getByRole('heading', { name: 'Media search' })).toBeVisible()
	await expect(page.getByLabel('Provider')).toHaveValue('disabled')
	await page.getByRole('button', { name: /^Operations/ }).click()
	await expect(page).toHaveURL(/#proofing-gallery\/operations$/)
	await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible()
	const refreshResponse = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/v1/admin/settings'))
	await page.getByRole('button', { name: 'Refresh status' }).click()
	expect((await refreshResponse).status()).toBe(200)
	await expect(page.getByText('Background cleanup')).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Custom gallery domains' })).toBeVisible()
	await page.getByRole('button', { name: /^Security/ }).click()
	await page.goBack()
	await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible()
	const adminStyles = page.locator('link[rel="stylesheet"][href*="proofing_gallery-admin"]')
	await expect(adminStyles).toHaveCount(1)
	let violations = await new AxeBuilder({ page }).include('#proofing-gallery-admin').analyze()
	expect(violations.violations).toEqual([])
	await page.setViewportSize({ width: 390, height: 844 })
	expect(await page.locator('#proofing-gallery-admin').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
	violations = await new AxeBuilder({ page }).include('#proofing-gallery-admin').analyze()
	expect(violations.violations).toEqual([])
	await context.close()
})

test('photographer preferences persist through the personal settings API and page', async ({ browser, request, baseURL }) => {
	const endpoint = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/user/preferences?format=json`
	const before = await request.get(endpoint, { headers: apiHeaders })
	expect(before.status()).toBe(200)
	const original = await before.json() as { preferences: Record<string, unknown> }
	try {
		const saved = await request.put(endpoint, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { preferences: { defaultPurpose: 'selection', publicLocale: 'de' } },
		})
		expect(saved.status()).toBe(200)
		const current = await request.get(endpoint, { headers: apiHeaders }).then(response => response.json()) as {
			preferences: { defaultPurpose: string, publicLocale: string }
			effectiveCapabilities: { galleryCreation: { allowed: boolean } }
		}
		expect(current.preferences).toMatchObject({ defaultPurpose: 'selection', publicLocale: 'de' })
		expect(typeof current.effectiveCapabilities.galleryCreation.allowed).toBe('boolean')

		const context = await browser.newContext()
		const page = await context.newPage()
		await page.goto(`${baseURL}/settings/user/additional`)
		await page.getByRole('textbox', { name: /Account name/ }).fill('admin')
		await page.getByRole('textbox', { name: 'Password' }).fill('admin')
		await page.getByRole('button', { name: 'Log in', exact: true }).click()
		await expect(page.locator('#proofing-gallery-personal').getByRole('heading', { name: 'Proofing Gallery' })).toBeVisible()
		await expect(page.getByLabel('Preferred purpose')).toHaveValue('selection')
		await page.getByLabel('Preferred purpose').selectOption('delivery')
		await expect(page.locator('.settings-save-bar')).toBeVisible()
		await page.setViewportSize({ width: 390, height: 844 })
		expect(await page.locator('#proofing-gallery-personal').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
		await page.getByRole('button', { name: 'Discard' }).click()
		await expect(page.locator('.settings-save-bar')).toHaveCount(0)
		await context.close()
	} finally {
		await request.put(endpoint, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { preferences: original.preferences },
		})
	}
})

test('collection anchor reconciliation is admin-only and preserves recent and referenced anchors', async ({ request, baseURL }) => {
	const endpoint = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/admin/collection-anchors/reconcile?format=json`
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const anchorName = `${Date.now().toString(16).padStart(16, '0')}0000000000000000`.slice(-32)
	const davRoot = `${baseURL}/remote.php/dav/files/admin/.proofing-gallery`
	const anchorPath = `${davRoot}/collections/${anchorName}`
	let collectionId: number | null = null

	try {
		expect([401, 404]).toContain((await request.post(`${endpoint}&dryRun=true`, {
			headers: { 'OCS-APIRequest': 'true' },
		})).status())
		for (const path of [davRoot, `${davRoot}/collections`, anchorPath]) {
			const response = await request.fetch(path, { method: 'MKCOL', headers: apiHeaders })
			expect([201, 405]).toContain(response.status())
		}

		const collection = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { title: `Reconcile guard ${Date.now()}`, sourceType: 'collection', folderId: null },
		})
		expect(collection.status()).toBe(201)
		collectionId = (await collection.json() as { id: number }).id

		const dryRun = await request.post(`${endpoint}&dryRun=true`, { headers: apiHeaders })
		expect(dryRun.status()).toBe(200)
		expect(await dryRun.json()).toEqual(expect.objectContaining({ dryRun: 1, candidates: 0, deleted: 0 }))

		const liveRun = await request.post(`${endpoint}&dryRun=false`, { headers: apiHeaders })
		expect(liveRun.status()).toBe(200)
		const result = await liveRun.json() as { deleted: number; recent: number; referenced: number }
		expect(result.deleted).toBe(0)
		expect(result.recent).toBeGreaterThanOrEqual(0)
		expect(result.referenced).toBeGreaterThanOrEqual(0)
		expect((await request.fetch(anchorPath, { method: 'PROPFIND', headers: { ...apiHeaders, Depth: '0' } })).status()).toBe(207)
	} finally {
		if (collectionId !== null) {
			await request.delete(`${galleries}/${collectionId}?format=json`, { headers: apiHeaders })
		}
		await request.delete(anchorPath, { headers: apiHeaders })
	}
})

test('owner presets preserve gallery identity and explicit public language', async ({ page, request, baseURL }) => {
	const stable = await state()
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const presets = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/presets`
	const name = `German delivery ${Date.now()}`
	let presetId: number | null = null
	let galleryId: number | null = null
	let collectionId: number | null = null
	let projectId: number | null = null

	try {
		const created = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { title: `Preset target ${Date.now()}`, folderId: stable.folderId },
		}).then(response => response.json()) as { id: number; folderId: number; settings: Record<string, unknown> }
		galleryId = created.id
		const mediaPage = await request.get(`${galleries}/${galleryId}/media?limit=2&format=json`, { headers: apiHeaders })
		const mediaItems = (await mediaPage.json() as { items: Array<{ id: number }> }).items
		expect(mediaItems.length).toBeGreaterThan(0)
		const localFileId = mediaItems[0]!.id
		const settings = {
			...created.settings,
			publicLocale: 'de',
			showFilenames: false,
			allowGuestUploads: true,
			presentation: {
				...(created.settings.presentation as Record<string, unknown>),
				heroFileId: localFileId,
				logoFileId: localFileId,
				logoMode: 'gallery',
				story: {
					sections: [{ id: 'story_portability', title: 'Opening', body: '', style: 'full', mediaIds: [localFileId] }],
					showAllMedia: true,
				},
			},
		}
		const configured = await request.put(`${galleries}/${galleryId}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { settings },
		}).then(response => response.json()) as { settings: Record<string, unknown> }
		const presetResponse = await request.post(`${presets}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { name, settings: configured.settings },
		})
		expect(presetResponse.status()).toBe(201)
		const preset = await presetResponse.json() as { id: number; settings: { presentation: { heroFileId: number | null; logoFileId: number | null; logoMode: string; story: { sections: Array<{ mediaIds: number[] }> } } } }
		presetId = preset.id
		expect(preset.settings.presentation).toEqual(expect.objectContaining({ heroFileId: null, logoFileId: null, logoMode: 'inherit' }))
		expect(preset.settings.presentation.story.sections[0]?.mediaIds).toEqual([])
		expect((await request.post(`${presets}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { name, settings: configured.settings },
		})).status()).toBe(422)

		const projectResponse = await request.post(`${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/projects?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: {
				title: `Preset project ${Date.now()}`,
				purpose: 'delivery',
				sourceMode: 'existing',
				folderId: stable.folderId,
				designPreset: { mode: 'preset', id: presetId },
			},
		})
		expect(projectResponse.status()).toBe(201)
		const project = await projectResponse.json() as { id: number; settings: { presentation: { showFilenames: boolean } } }
		projectId = project.id
		expect(project.settings.presentation.showFilenames).toBe(false)
		const readiness = await request.get(`${galleries}/${projectId}/readiness?format=json`, { headers: apiHeaders })
		expect(await readiness.json()).toEqual(expect.objectContaining({ ready: true, revision: expect.any(Number) }))

		const published = await request.post(`${galleries}/${galleryId}/publish?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { allowDownloads: false },
		}).then(response => response.json()) as { gallery: { shareToken: string } }
		const token = published.gallery.shareToken
		const applied = await request.post(`${presets}/${presetId}/apply/${galleryId}?format=json`, { headers: apiHeaders })
		const appliedGallery = await applied.json() as { folderId: number; shareToken: string; settings: { publicLocale: string; presentation: { heroFileId: number | null; logoFileId: number | null; story: { sections: Array<{ mediaIds: number[] }> } } } }
		expect(appliedGallery).toEqual(expect.objectContaining({ folderId: stable.folderId, shareToken: token }))
		expect(appliedGallery.settings.publicLocale).toBe('de')
		expect(appliedGallery.settings.presentation.heroFileId).toBe(localFileId)
		expect(appliedGallery.settings.presentation.logoFileId).toBe(localFileId)
		expect(appliedGallery.settings.presentation.story.sections[0]?.mediaIds).toEqual([localFileId])

		await page.goto(`${baseURL}/s/${token}`)
		await expect(page.locator('html')).toHaveAttribute('lang', 'de')
		await expect(page.getByText(/^\d+ Foto(?:s)?$/)).toBeVisible()

		const collection = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { title: `Preset collection ${Date.now()}`, sourceType: 'collection', folderId: null },
		}).then(response => response.json()) as { id: number }
		collectionId = collection.id
		const appliedCollection = await request.post(`${presets}/${presetId}/apply/${collectionId}?format=json`, { headers: apiHeaders })
		expect((await appliedCollection.json() as { settings: { delivery: { guestUploads: boolean } } }).settings.delivery.guestUploads).toBe(false)
	} finally {
		if (presetId !== null) await request.delete(`${presets}/${presetId}?format=json`, { headers: apiHeaders })
		if (galleryId !== null) await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
		if (collectionId !== null) await request.delete(`${galleries}/${collectionId}?format=json`, { headers: apiHeaders })
		if (projectId !== null) await request.delete(`${galleries}/${projectId}?format=json`, { headers: apiHeaders })
	}
})

test('owner preset and locale controls remain clear and responsive', async ({ page, baseURL }) => {
	const presetName = `UI preset ${Date.now()}`
	await page.goto(`${baseURL}/apps/proofing_gallery/`)
	await page.getByRole('textbox', { name: /Account name/ }).fill('admin')
	await page.getByRole('textbox', { name: 'Password' }).fill('admin')
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await page.getByRole('button', { name: /^E2E Gallery (?:Presentation|Proofing)/ }).click()
	await expect(page.getByRole('heading', { name: 'Reusable preset' })).toBeVisible()

	const locale = page.getByRole('combobox', { name: 'Public gallery language' })
	const originalLocale = await locale.inputValue()
	await locale.selectOption(originalLocale === 'de' ? 'en' : 'de')
	await expect(page.locator('.save-indicator[data-state="pending"]')).toBeVisible()
	await expect(page.locator('.save-indicator[data-state="saved"]')).toBeVisible()
	await locale.selectOption(originalLocale)
	await expect(page.locator('.save-indicator[data-state="pending"]')).toBeVisible()
	await expect(page.locator('.save-indicator[data-state="saved"]')).toBeVisible()
	await expect(locale).toHaveValue(originalLocale)

	await page.getByRole('button', { name: 'Reusable preset' }).click()
	await page.getByRole('textbox', { name: 'Preset name' }).fill(presetName)
	await page.getByRole('button', { name: 'Save as new' }).click()
	await expectSuccessToast(page, 'Preset created.')
	await expect(page.getByRole('combobox', { name: 'Saved preset' })).toHaveValue(/\d+/)
	await page.getByRole('button', { name: 'Apply', exact: true }).click()
	await expectSuccessToast(page, 'Preset applied.')

	const accessibility = await new AxeBuilder({ page }).include('.settings-page').analyze()
	expect(accessibility.violations).toEqual([])
	await page.setViewportSize({ width: 390, height: 844 })
	await expect(page.getByRole('heading', { name: 'Reusable preset' })).toBeVisible()
	expect(await page.locator('.settings-page').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)

	page.once('dialog', dialog => dialog.accept())
	await page.getByRole('button', { name: 'Delete preset' }).click()
	await expectSuccessToast(page, 'Preset deleted.')
})

test('invitation templates are owner-scoped, validated and render editable plain text', async ({ request, baseURL }) => {
	const stable = await state()
	const templates = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/invitation-templates`
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const secondaryUid = `template-user-${Date.now()}`
	const secondaryAuth = `Basic ${Buffer.from(`${secondaryUid}:Testing-Password-2026!`).toString('base64')}`
	let templateId: number | null = null
	let galleryId: number | null = null
	let secondaryRequest: Awaited<ReturnType<typeof requestFactory.newContext>> | null = null

	try {
		const userResponse = await request.post(`${baseURL}/ocs/v2.php/cloud/users?format=json`, {
			headers: apiHeaders,
			form: { userid: secondaryUid, password: 'Testing-Password-2026!' },
		})
		expect(userResponse.status()).toBe(200)
		secondaryRequest = await requestFactory.newContext({
			baseURL: baseURL ?? undefined,
			extraHTTPHeaders: { Authorization: secondaryAuth, 'OCS-APIRequest': 'true' },
		})

		const invalid = await request.post(`${templates}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { name: 'Invalid placeholder', body: 'Hello {recipient}' },
		})
		expect(invalid.status()).toBe(422)

		const createdTemplate = await request.post(`${templates}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { name: `Client delivery ${Date.now()}`, body: '<b>Hello {gallery}</b>\nFrom {owner}\n{url}' },
		})
		expect(createdTemplate.status()).toBe(201)
		templateId = (await createdTemplate.json() as { id: number }).id

		const gallery = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId, title: 'Literal <client> delivery' },
		}).then(response => response.json()) as { id: number }
		galleryId = gallery.id
		await request.post(`${galleries}/${galleryId}/publish?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { allowDownloads: false },
		})

		const rendered = await request.post(`${templates}/${templateId}/render/${galleryId}?format=json`, { headers: apiHeaders })
		expect(rendered.status()).toBe(200)
		const body = (await rendered.json() as { body: string }).body
		expect(body).toContain('<b>Hello Literal <client> delivery</b>')
		expect(body).toContain('/s/')

		expect((await secondaryRequest.get(`${templates}?format=json`).then(response => response.json()) as { items: unknown[] }).items).toEqual([])
		expect((await secondaryRequest.delete(`${templates}/${templateId}?format=json`)).status()).toBe(404)
		expect((await request.delete(`${templates}/${templateId}?format=json`, { headers: apiHeaders })).status()).toBe(204)
		templateId = null
	} finally {
		await secondaryRequest?.dispose()
		if (templateId !== null) await request.delete(`${templates}/${templateId}?format=json`, { headers: apiHeaders })
		if (galleryId !== null) await request.delete(`${galleries}/${galleryId}?format=json`, { headers: apiHeaders })
		await request.delete(`${baseURL}/ocs/v2.php/cloud/users/${encodeURIComponent(secondaryUid)}?format=json`, { headers: apiHeaders })
	}
})

test('notification subscriptions are opt-in, eligible, deduplicated and scoped on unsubscribe', async ({ request, baseURL }) => {
	const stable = await state()
	const stableSubscriptions = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries/${stable.galleryId}/notification-subscriptions`
	const galleries = `${baseURL}/ocs/v2.php/apps/proofing_gallery/api/v1/galleries`
	const managers = `${galleries}/${stable.galleryId}/managers`
	const groupUid = `notify-group-${Date.now()}`
	let secondGalleryId: number | null = null
	let groupManagerId: number | null = null

	async function runDigestJob() {
		const list = await execFileAsync('docker', [
			'compose', 'exec', '-T', '--user', 'www-data', 'nextcloud', 'php', 'occ', 'background-job:list', '--output=json',
		], { cwd: process.cwd() })
		const jobs = JSON.parse(list.stdout) as Array<{ id: number; class: string }>
		const job = jobs.find(item => item.class.endsWith('SendNotificationDigestsJob'))
		expect(job).toBeDefined()
		await execFileAsync('docker', [
			'compose', 'exec', '-T', '--user', 'www-data', 'nextcloud', 'php', 'occ',
			'background-job:execute', '--force-execute', String(job!.id),
		], { cwd: process.cwd() })
	}

	try {
		const existing = await request.get(`${stableSubscriptions}?format=json`, { headers: apiHeaders }).then(response => response.json()) as {
			items: Array<{ id: number }>
		}
		for (const item of existing.items) {
			await request.delete(`${stableSubscriptions}/${item.id}?format=json`, { headers: apiHeaders })
		}
		expect((await request.get(`${stableSubscriptions}?format=json`, { headers: apiHeaders }).then(response => response.json()) as { items: unknown[] }).items).toEqual([])

		await request.post(`${baseURL}/ocs/v2.php/cloud/users?format=json`, {
			headers: apiHeaders,
			form: { userid: groupUid, password: 'Testing-Password-2026!' },
		})
		await request.post(`${baseURL}/ocs/v2.php/cloud/groups?format=json`, {
			headers: apiHeaders,
			form: { groupid: groupUid },
		})
		const groupManager = await request.put(`${managers}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { type: 'group', principalId: groupUid, role: 'viewer' },
		})
		expect(groupManager.status()).toBe(201)
		groupManagerId = (await groupManager.json() as { id: number }).id
		expect((await request.put(`${stableSubscriptions}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { recipientUid: groupUid, eventTypes: ['like.changed'], frequency: 'daily', locale: 'auto' },
		})).status()).toBe(422)
		expect((await request.put(`${stableSubscriptions}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { recipientUid: 'arbitrary-person', eventTypes: ['like.changed'], frequency: 'daily', locale: 'auto' },
		})).status()).toBe(422)

		const daily = await request.put(`${stableSubscriptions}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { recipientUid: 'admin', eventTypes: ['like.changed'], locale: 'de' },
		})
		expect((await daily.json() as { frequency: string }).frequency).toBe('daily')
		const immediate = await request.put(`${stableSubscriptions}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { recipientUid: 'admin', eventTypes: ['like.changed'], frequency: 'immediate', locale: 'de' },
		})
		expect(immediate.status()).toBe(200)

		const second = await request.post(`${galleries}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { folderId: stable.folderId, title: `Unsubscribe scope ${Date.now()}`, settings: { publicLocale: 'de' } },
		}).then(response => response.json()) as { id: number }
		secondGalleryId = second.id
		const secondSubscriptions = `${galleries}/${secondGalleryId}/notification-subscriptions`
		expect((await request.put(`${secondSubscriptions}?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { recipientUid: 'admin', eventTypes: ['like.changed'], frequency: 'daily', locale: 'auto' },
		})).status()).toBe(200)

		await request.post(`${galleries}/${secondGalleryId}/publish?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { allowDownloads: false },
		})
		await request.delete(`${mailpitUrl}/api/v1/messages`)
		expect((await request.post(`${galleries}/${secondGalleryId}/invite?format=json`, {
			headers: { ...apiHeaders, 'Content-Type': 'application/json' },
			data: { recipient: 'client@example.test', message: '<b>Literal invitation text</b>' },
		})).status()).toBe(202)
		const invitationMailbox = await request.get(`${mailpitUrl}/api/v1/messages`).then(response => response.json()) as {
			count: number; messages: Array<{ ID: string; Subject: string }>
		}
		expect(invitationMailbox.count).toBe(1)
		expect(invitationMailbox.messages[0].Subject).toContain('hat')
		const invitationMail = await request.get(`${mailpitUrl}/api/v1/message/${invitationMailbox.messages[0].ID}`).then(response => response.json()) as { Text: string; HTML: string }
		expect(invitationMail.Text).toContain('<b>Literal invitation text</b>')
		expect(invitationMail.HTML).not.toContain('<b>Literal invitation text</b>')
		expect(invitationMail.HTML).toContain('&lt;b&gt;Literal invitation text&lt;/b&gt;')

		await request.delete(`${mailpitUrl}/api/v1/messages`)
		// Other serial scenarios can leave due digests queued even though their
		// mailbox is empty. Drain them before observing this scenario's message.
		await runDigestJob()
		await request.delete(`${mailpitUrl}/api/v1/messages`)
		const endpoint = (suffix: string) => `${baseURL}/index.php/apps/proofing_gallery/public/${stable.token}/${suffix}`
		const media = await request.get(endpoint('gallery')).then(response => response.json()) as { items: Array<{ id: number; folder: boolean }> }
		const file = media.items.find(item => !item.folder)
		expect(file).toBeDefined()
		const session = await request.post(endpoint('session'), { data: { displayName: 'Digest reviewer' } })
		const nonce = (await session.json() as { nonce: string }).nonce
		expect((await request.post(endpoint(`collaboration/media/${file!.id}/like`), {
			headers: { 'X-Proofing-Nonce': nonce },
		})).status()).toBe(200)

		await runDigestJob()
		let mailbox = await request.get(`${mailpitUrl}/api/v1/messages`).then(response => response.json()) as {
			count: number; messages: Array<{ ID: string; Subject: string }>
		}
		let ownMessages = mailbox.messages.filter(message => message.Subject.includes('Aktualisierungen für „E2E Gallery“'))
		expect(ownMessages).toHaveLength(1)
		await runDigestJob()
		mailbox = await request.get(`${mailpitUrl}/api/v1/messages`).then(response => response.json()) as typeof mailbox
		ownMessages = mailbox.messages.filter(message => message.Subject.includes('Aktualisierungen für „E2E Gallery“'))
		expect(ownMessages).toHaveLength(1)

		const message = await request.get(`${mailpitUrl}/api/v1/message/${ownMessages[0]!.ID}`).then(response => response.json()) as { Text: string }
		const unsubscribePath = message.Text.match(/http:\/\/localhost(\/index\.php\/apps\/proofing_gallery\/notifications\/unsubscribe\/[A-Za-z0-9]{48})/)?.[1]
		expect(unsubscribePath).toBeDefined()
		expect((await request.get(`${baseURL}${unsubscribePath}`)).status()).toBe(200)
		const stableAfter = await request.get(`${stableSubscriptions}?format=json`, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ active: boolean; channels: { email: { enabled: boolean } } }> }
		const secondAfter = await request.get(`${secondSubscriptions}?format=json`, { headers: apiHeaders }).then(response => response.json()) as { items: Array<{ active: boolean; channels: { email: { enabled: boolean } } }> }
		expect(stableAfter.items[0].active).toBe(true)
		expect(stableAfter.items[0].channels.email.enabled).toBe(false)
		expect(secondAfter.items[0].active).toBe(true)
		expect(secondAfter.items[0].channels.email.enabled).toBe(true)
	} finally {
		const items = await request.get(`${stableSubscriptions}?format=json`, { headers: apiHeaders }).then(response => response.json()).catch(() => ({ items: [] })) as { items: Array<{ id: number }> }
		for (const item of items.items) await request.delete(`${stableSubscriptions}/${item.id}?format=json`, { headers: apiHeaders })
		if (groupManagerId !== null) await request.delete(`${managers}/${groupManagerId}?format=json`, { headers: apiHeaders })
		if (secondGalleryId !== null) await request.delete(`${galleries}/${secondGalleryId}?format=json`, { headers: apiHeaders })
		await request.delete(`${baseURL}/ocs/v2.php/cloud/groups/${encodeURIComponent(groupUid)}?format=json`, { headers: apiHeaders })
		await request.delete(`${baseURL}/ocs/v2.php/cloud/users/${encodeURIComponent(groupUid)}?format=json`, { headers: apiHeaders })
	}
})

test('notification and invitation controls stay understandable and responsive', async ({ page, baseURL }) => {
	const templateName = `UI invitation ${Date.now()}`
	await page.goto(`${baseURL}/apps/proofing_gallery/`)
	await page.getByRole('textbox', { name: /Account name/ }).fill('admin')
	await page.getByRole('textbox', { name: 'Password' }).fill('admin')
	await page.getByRole('button', { name: 'Log in', exact: true }).click()
	await page.getByRole('button', { name: /^E2E Gallery (?:Presentation|Proofing)/ }).click()
	const settingsNavigation = page.getByRole('navigation', { name: 'Gallery settings' })
	await settingsNavigation.locator('summary').click()
	await settingsNavigation.getByRole('button', { name: 'Team', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
	await expect(page.getByRole('switch', { name: 'Nextcloud notification center' })).toBeChecked()
	await page.getByText('Email digest', { exact: true }).click()
	await expect(page.getByRole('switch', { name: 'Email digest' })).toBeChecked()
	await page.getByRole('combobox', { name: 'Delivery' }).selectOption('daily')
	await expect(page.getByRole('combobox', { name: 'Delivery' })).toHaveValue('daily')
	await page.getByRole('button', { name: /^(Subscribe|Update subscription)$/ }).click()
	await expectSuccessToast(page, 'Notification subscription saved.')
	await expect(page.getByRole('button', { name: 'Update subscription' })).toBeVisible()

	let violations = await new AxeBuilder({ page }).include('.settings-content').analyze()
	expect(violations.violations).toEqual([])
	await page.setViewportSize({ width: 390, height: 844 })
	const panelOverflow = await page.getByRole('heading', { name: 'Notifications' }).locator('..').evaluate(element => element.scrollWidth > element.clientWidth)
	expect(panelOverflow).toBe(false)
	await page.getByRole('button', { name: 'Remove subscription' }).click()
	await expectSuccessToast(page, 'Notification subscription removed.')

	await page.setViewportSize({ width: 1280, height: 900 })
	await page.locator('.settings-header__actions').getByRole('button', { name: 'Share', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Email invitation' })).toBeVisible()
	await page.getByRole('textbox', { name: 'Template name' }).fill(templateName)
	await page.getByRole('textbox', { name: 'Personal message (optional)' }).fill('<b>Hello {gallery}</b> — {owner}\n{url}')
	await page.getByRole('button', { name: 'Save as template' }).click()
	await expectSuccessToast(page, 'Invitation template saved.')
	const templateSelect = page.getByRole('combobox', { name: 'Message template' })
	await templateSelect.selectOption({ label: 'New template' })
	await templateSelect.selectOption({ label: templateName })
	await expect(page.getByRole('textbox', { name: 'Personal message (optional)' })).toHaveValue(/<b>Hello E2E Gallery<\/b>.*\/s\//s)
	violations = await new AxeBuilder({ page }).include('.sharing-dialog').analyze()
	expect(violations.violations).toEqual([])
	await page.setViewportSize({ width: 390, height: 844 })
	const dialogOverflow = await page.locator('.sharing-dialog').evaluate(element => element.scrollWidth > element.clientWidth)
	expect(dialogOverflow).toBe(false)
	page.once('dialog', dialog => dialog.accept())
	await page.getByRole('button', { name: 'Delete template' }).click()
	await expectSuccessToast(page, 'Invitation template deleted.')
})
