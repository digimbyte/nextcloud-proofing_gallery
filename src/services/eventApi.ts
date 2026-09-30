import type { PublicShareRecovery } from '../domain/publicShareRecovery.ts'
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'

import type { Gallery, GalleryPublicLink, MediaItem, PublicLinkPolicy } from '../types.ts'
import type { GallerySettings } from '../domain/gallerySettings.ts'

const galleriesUrl = generateOcsUrl('/apps/proofing_gallery/api/v1/galleries')
const galleriesV2Url = generateOcsUrl('/apps/proofing_gallery/api/v2/galleries')

export type EventFolderRole = 'shared' | 'group' | 'private' | 'ignored'
export type EventSetupStep = 'photos' | 'visibility' | 'recipients' | 'delivery'
export interface EventFolderPreview {
	id: number
	parentId: number | null
	parentPath: string
	depth: number
	path: string
	name: string
	directMediaCount: number
	totalMediaCount: number
	mediaCount: number
	suggestion: EventFolderRole
	role?: EventFolderRole
}
export interface EventSetupRecipient {
	key: string
	folderId: number
	groupFolderIds: number[]
	name: string
	email: string
	locale: 'de' | 'en' | null
	pin: string
}
export interface EventSetupDelivery {
	pinMode: 'none' | 'generated' | 'manual'
	expiresAt: string
	releaseMode: 'draft' | 'now' | 'schedule'
	releaseAt: string
	sendInvitations: boolean
}
export interface EventSetup {
	revision: number
	currentStep: EventSetupStep
	folderAssignments: Array<{ folderId: number; role: EventFolderRole }>
	recipients: EventSetupRecipient[]
	delivery: EventSetupDelivery
	folders: EventFolderPreview[]
	readiness: { ready: boolean; checks: Array<{ code: string; state: 'ready' | 'warning' | 'blocked' }> }
	capacity: number
}
export interface EventDesignScope {
	id: string
	kind: 'shared' | 'recipient'
	label: string
}
export interface EventDesignMediaPage {
	scopes: EventDesignScope[]
	activeScope: string | null
	items: MediaItem[]
	total: number
	limit: number
	offset: number
}
export interface EventRecipient {
	recovery?: PublicShareRecovery
	id: number
	setupKey: string | null
	folderPath: string
	folderState: 'readable' | 'missing'
	name: string
	email: string | null
	locale: 'de' | 'en' | null
	status: 'draft' | 'published' | 'invited' | 'failed' | 'revoked'
	invitedAt: number | null
	link: GalleryPublicLink | null
	waveId: number | null
	publicationStatus: 'draft' | 'publishing' | 'published' | 'failed' | 'revoked'
	invitationStatus: 'not_requested' | 'pending' | 'sent' | 'failed'
	errorCode: string | null
	attempts: number
	groupRoots: string[]
	health?: 'healthy' | 'degraded' | 'revoked' | 'unpublished'
	allowedActions?: Array<'edit' | 'resend' | 'rotate_pin' | 'rotate_link' | 'revoke' | 'delete'>
	updatedAt?: number
}

export interface EventRecipientPage {
	items: EventRecipient[]
	total: number
	nextCursor: string | null
	health: { healthy: number; degraded: number; revoked: number; unpublished: number }
}

export async function fetchEventRecipients(id: number, params: { limit?: number; cursor?: string | null; status?: string; query?: string; setupKey?: string } = {}): Promise<EventRecipientPage> {
	return (await axios.get<EventRecipientPage>(`${galleriesV2Url}/${id}/event/recipients`, { params })).data
}

export async function fetchLatestEventRecipientLinks(id: number, setupKeys: string[]): Promise<EventRecipient[]> {
	return (await axios.get<{ items: EventRecipient[] }>(`${galleriesV2Url}/${id}/event/recipient-links`, { params: { keys: setupKeys.join(',') } })).data.items
}

export async function editEventRecipient(id: number, recipientId: number, payload: { folderPath: string; groupRoots: string[]; name: string; email: string; locale: 'de' | 'en' | null; password?: string; expiresAt?: string; recoverMissingShare?: boolean }): Promise<EventRecipient> {
	return (await axios.put(`${galleriesV2Url}/${id}/event/recipients/${recipientId}`, payload)).data
}

export async function operateEventRecipient(id: number, recipientId: number, action: 'resend' | 'revoke' | 'delete' | 'rotate_pin' | 'rotate_link'): Promise<EventRecipient | { recipient: EventRecipient; pin: string } | { deleted: boolean }> {
	if (action === 'delete') return (await axios.delete(`${galleriesV2Url}/${id}/event/recipients/${recipientId}`)).data
	if (action === 'rotate_pin' || action === 'rotate_link') return (await axios.post(`${galleriesV2Url}/${id}/event/recipients/${recipientId}/rotate`, { mode: action === 'rotate_pin' ? 'pin' : 'link' })).data
	return (await axios.post(`${galleriesV2Url}/${id}/event/recipients/${recipientId}/${action}`)).data
}

export async function bulkEventRecipients(id: number, recipientIds: number[], action: 'resend' | 'revoke' | 'delete'): Promise<{ processed: number; failed: number }> {
	return (await axios.post(`${galleriesV2Url}/${id}/event/recipients/bulk`, { recipientIds, action })).data
}

export async function reconcileEventRecipients(id: number): Promise<{ changed: number; healthy: number; degraded: number }> {
	return (await axios.post(`${galleriesV2Url}/${id}/event/reconcile`)).data
}

export async function downloadEventStatus(id: number): Promise<Blob> {
	return (await axios.get(`${galleriesV2Url}/${id}/event/status-export`, { responseType: 'blob' })).data
}
export interface EventWave {
	id: number
	status: 'draft' | 'scheduled' | 'releasing' | 'released' | 'partial_failed' | 'cancelled'
	sharedRoots: string[]
	expiresAt: string | null
	releaseAt: number | null
	sendInvitations: boolean
	total: number
	processed: number
	failed: number
	pinExportAvailable: boolean
	createdAt: number
	updatedAt: number
}
export interface EventOverview {
	folders: EventFolderPreview[]
	suggested: boolean
	items: EventRecipient[]
	summary: { total: number; draft: number; published: number; invited: number; failed: number }
	waves: EventWave[]
}

export interface EventOperations {
	summary: { total: number; draft: number; published: number; invited: number; failed: number; revoked: number }
	waves: EventWave[]
}

export interface EventImportRow {
	line: number
	folderInput: string
	folderPath: string | null
	groupInputs: string[]
	groupRoots: string[]
	name: string
	email: string
	locale: 'de' | 'en' | null
	pin: string
	conflicts: string[]
}
export interface EventImportPreview {
	headers: string[]
	rows: EventImportRow[]
	summary: { total: number; ready: number; conflicts: number }
}

export async function previewEventImport(id: number, csv: string, matchMode: 'exact' | 'prefix'): Promise<EventImportPreview> {
	return (await axios.post<EventImportPreview>(`${galleriesUrl}/${id}/event/import-preview`, { csv, matchMode })).data
}

export async function createEventWave(id: number, payload: {
	sharedRoots: string[]
	recipients: Array<{ folderPath: string; groupRoots?: string[]; name: string; email: string; locale: 'de' | 'en' | null; pin: string }>
	policy?: PublicLinkPolicy
	expiresAt?: string | null
	releaseAt?: string | null
	sendInvitations?: boolean
	releaseNow?: boolean
}): Promise<EventWave> {
	return (await axios.post(`${galleriesUrl}/${id}/event/waves`, payload)).data
}

export async function releaseEventWave(id: number, waveId: number): Promise<{ gallery: Gallery; wave: EventWave }> {
	return (await axios.post(`${galleriesV2Url}/${id}/event/waves/${waveId}/release`)).data
}

export async function retryEventWave(id: number, waveId: number): Promise<EventWave> {
	return (await axios.post(`${galleriesUrl}/${id}/event/waves/${waveId}/retry`)).data
}

export async function cancelEventWave(id: number, waveId: number): Promise<EventWave> {
	return (await axios.delete(`${galleriesUrl}/${id}/event/waves/${waveId}`)).data
}

export async function downloadEventPins(id: number, waveId: number): Promise<Blob> {
	return (await axios.get(`${galleriesUrl}/${id}/event/waves/${waveId}/pin-export`, { responseType: 'blob' })).data
}

export async function fetchEventOverview(id: number): Promise<EventOverview> {
	return (await axios.get<EventOverview>(`${galleriesUrl}/${id}/event`)).data
}

export async function fetchEventOperations(id: number): Promise<EventOperations> {
	return (await axios.get<EventOperations>(`${galleriesV2Url}/${id}/event/operations`)).data
}

export async function fetchEventSetup(id: number): Promise<EventSetup> {
	return (await axios.get<EventSetup>(`${galleriesV2Url}/${id}/event/setup`)).data
}

export async function fetchEventDesignMedia(id: number, scope = 'shared', query = '', limit = 60, offset = 0): Promise<EventDesignMediaPage> {
	return (await axios.get<EventDesignMediaPage>(`${galleriesV2Url}/${id}/event/design-media`, { params: { scope, query, limit, offset } })).data
}

export async function saveEventSetup(id: number, setup: Pick<EventSetup, 'currentStep' | 'folderAssignments' | 'recipients' | 'delivery'>, expectedRevision: number): Promise<EventSetup> {
	return (await axios.put<EventSetup>(`${galleriesV2Url}/${id}/event/setup`, { setup, expectedRevision })).data
}

export async function deliverEventSetup(id: number, setupRevision: number, requestKey: string): Promise<{ gallery: Gallery; wave: EventWave }> {
	return (await axios.post(`${galleriesV2Url}/${id}/event/deliver`, { setupRevision, requestKey })).data
}

export async function applyEventDownloadPolicy(id: number, downloadScope: GallerySettings['delivery']['downloadScope']): Promise<{ updated: number; skipped: number }> {
	return (await axios.post(`${galleriesV2Url}/${id}/event/download-policy`, { downloadScope })).data
}

export async function createEventRecipients(id: number, payload: {
	sharedRoots: string[]
	recipients: Array<{ folderPath: string; name: string; email: string; locale: 'de' | 'en' | null; pin: string }>
	policy?: PublicLinkPolicy
	expiresAt?: string | null
}): Promise<EventOverview & { created: number; skipped: number }> {
	return (await axios.post(`${galleriesUrl}/${id}/event/recipients`, payload)).data
}

export async function inviteEventRecipient(id: number, recipientId: number, message = ''): Promise<EventOverview> {
	return (await axios.post(`${galleriesUrl}/${id}/event/recipients/${recipientId}/invite`, { message })).data
}
