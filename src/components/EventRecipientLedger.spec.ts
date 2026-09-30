import { flushPromises, shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const eventApi = vi.hoisted(() => ({
	fetchEventRecipients: vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
	fetchLatestEventRecipientLinks: vi.fn().mockResolvedValue([]),
}))

vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock('@nextcloud/vue/components/NcButton', () => ({ default: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' } }))
vi.mock('@nextcloud/vue/components/NcLoadingIcon', () => ({ default: { template: '<span />' } }))
vi.mock('../services/eventApi.ts', () => ({
	bulkEventRecipients: vi.fn(),
	editEventRecipient: vi.fn(),
	fetchEventRecipients: eventApi.fetchEventRecipients,
	fetchLatestEventRecipientLinks: eventApi.fetchLatestEventRecipientLinks,
	operateEventRecipient: vi.fn(),
}))

import { createDefaultGallerySettings } from '../domain/gallerySettings.ts'
import type { EventFolderPreview, EventSetupRecipient } from '../services/eventApi.ts'
import type { Gallery } from '../types.ts'
import EventRecipientLedger from './EventRecipientLedger.vue'

const folders: EventFolderPreview[] = Array.from({ length: 1000 }, (_, index) => ({
	id: index + 1,
	parentId: null,
	parentPath: '',
	depth: 0,
	path: `Client ${index + 1}`,
	name: `Client ${index + 1}`,
	directMediaCount: 1,
	totalMediaCount: 1,
	mediaCount: 1,
	suggestion: 'private',
}))
const recipients: EventSetupRecipient[] = folders.map(folder => ({
	key: `recipient${folder.id}`,
	folderId: folder.id,
	groupFolderIds: [],
	name: folder.name,
	email: '',
	locale: null,
	pin: '',
}))
const gallery = {
	id: 7,
	title: 'Large event',
	settings: createDefaultGallerySettings(),
} as Gallery

describe('EventRecipientLedger', () => {
	it('paginates large recipient collections without duplicating operations', async () => {
		const wrapper = shallowMount(EventRecipientLedger, {
			props: {
				gallery,
				folders,
				privateFolders: folders,
				groupFolders: [],
				sharedFolders: [],
				delivery: { pinMode: 'none', expiresAt: '', releaseMode: 'draft', releaseAt: '', sendInvitations: false },
				saving: false,
				recipients,
			},
		})
		await flushPromises()
		expect(wrapper.findAll('.recipient-row')).toHaveLength(50)
		expect(wrapper.text()).toContain('Page 1 of 20')
		expect(eventApi.fetchLatestEventRecipientLinks).toHaveBeenCalledTimes(1)
		wrapper.unmount()
	})
})
