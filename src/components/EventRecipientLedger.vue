<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { missingPublicShare, publicShareError, shareRecoveryMessage } from '../domain/publicShareRecovery.ts'
import type { ShareRecoveryChoices } from '../domain/publicShareRecovery.ts'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { computed, defineAsyncComponent, ref, watch } from 'vue'

import { normalizeEventRecipientMatch as normalizeMatch, eventRecipientStatusLabel as statusLabel } from '../domain/eventDeliveryPresentation.ts'
import { bulkEventRecipients, editEventRecipient, fetchEventRecipients, fetchLatestEventRecipientLinks, operateEventRecipient } from '../services/eventApi.ts'
import type { EventFolderPreview, EventRecipient, EventSetupDelivery, EventSetupRecipient } from '../services/eventApi.ts'
import type { Gallery } from '../types.ts'
import { eventDeliveryIcons } from './eventDeliveryIcons.ts'

const PublicShareRecoveryForm = defineAsyncComponent(() => import('./PublicShareRecoveryForm.vue'))
const recoveryNeeded = ref(false)
const recoveryNotice = ref('')
const props = defineProps<{
	gallery: Gallery
	folders: EventFolderPreview[]
	privateFolders: EventFolderPreview[]
	groupFolders: EventFolderPreview[]
	sharedFolders: EventFolderPreview[]
	delivery: EventSetupDelivery
	saving: boolean
}>()
const emit = defineEmits<{ save: []; 'operations-updated': [] }>()
const recipients = defineModel<EventSetupRecipient[]>('recipients', { required: true })
const { AlertCircle: AlertCircleIcon, CheckCircle: CheckCircleIcon, ChevronDown: ChevronDownIcon, ContentCopy: ContentCopyIcon, History: HistoryIcon, LinkVariant: LinkVariantIcon, OpenInNew: OpenInNewIcon } = eventDeliveryIcons
const pageSize = 50
const query = ref('')
const needsAttention = ref(false)
const page = ref(0)
const expandedKey = ref<string | null>(null)
const latestLinks = ref(new Map<string, EventRecipient>())
const legacyRecipients = ref<EventRecipient[]>([])
const histories = ref(new Map<string, EventRecipient[]>())
const historyLoadingKey = ref<string | null>(null)
const selected = ref<number[]>([])
const recipientAction = ref<number | null>(null)
const liveEditor = ref<EventRecipient | null>(null)
const operationBusy = ref(false)
const oneTimePin = ref('')

interface Entry { folder: EventFolderPreview; recipient: EventSetupRecipient | null; releasedOnly?: EventRecipient }
const entries = computed<Entry[]>(() => {
	const configured = props.privateFolders.flatMap<Entry>(folder => {
		const assigned = recipients.value.filter(recipient => recipient.folderId === folder.id)
		return assigned.length ? assigned.map(recipient => ({ folder, recipient })) : [{ folder, recipient: null } satisfies Entry]
	})
	const releasedOnly = legacyRecipients.value
		.filter((item, index, items) => items.findIndex(candidate => (item.setupKey && candidate.setupKey === item.setupKey) || (!item.setupKey && !candidate.setupKey && normalizeMatch(candidate.name) === normalizeMatch(item.name) && normalizeMatch(candidate.folderPath) === normalizeMatch(item.folderPath))) === index)
		.filter(item => !configured.some(entry => entry.recipient && ((item.setupKey && item.setupKey === entry.recipient.key) || (normalizeMatch(item.name) === normalizeMatch(entry.recipient.name) && normalizeMatch(item.folderPath) === normalizeMatch(entry.folder.path)))))
		.map<Entry>(item => ({
			folder: { id: -item.id, parentId: null, parentPath: '', depth: 0, path: item.folderPath, name: item.folderPath.split('/').at(-1) ?? item.folderPath, directMediaCount: 0, totalMediaCount: 0, mediaCount: 0, suggestion: 'private' },
			recipient: { key: item.setupKey ?? `released_${item.id}`, folderId: -item.id, groupFolderIds: [], name: item.name, email: item.email ?? '', locale: item.locale, pin: '' },
			releasedOnly: item,
		}))
	return [...configured, ...releasedOnly]
})
const filtered = computed(() => entries.value.filter(({ folder, recipient }) => {
	const needle = query.value.trim().toLocaleLowerCase()
	const matches = !needle || `${folder.name} ${folder.path} ${recipient?.name ?? ''} ${recipient?.email ?? ''}`.toLocaleLowerCase().includes(needle)
	return matches && (!needsAttention.value || !recipient?.name.trim() || Boolean(props.delivery.sendInvitations && !recipient.email.trim()))
}))
const visible = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))

function folderById(id: number): EventFolderPreview | undefined { return props.folders.find(folder => folder.id === id) }
function recipientCount(folderId: number): number { return recipients.value.filter(recipient => recipient.folderId === folderId).length }
function emptyRecipient(folder: EventFolderPreview): EventSetupRecipient { return { key: crypto.randomUUID().replaceAll('-', ''), folderId: folder.id, groupFolderIds: [], name: folder.name, email: '', locale: null, pin: '' } }
function addRecipient(folder: EventFolderPreview, blank = true) { recipients.value = [...recipients.value, { ...emptyRecipient(folder), name: blank ? '' : folder.name }] }
function removeRecipient(key: string) { recipients.value = recipients.value.filter(recipient => recipient.key !== key) }
function latestFor(recipient: EventSetupRecipient, folder: EventFolderPreview): EventRecipient | null {
	const keyed = latestLinks.value.get(recipient.key)
	if (keyed) return keyed
	const matches = legacyRecipients.value.filter(item => normalizeMatch(item.name) === normalizeMatch(recipient.name) && normalizeMatch(item.folderPath) === normalizeMatch(folder.path))
	return matches.length === 1 ? matches[0] : null
}

async function loadVisibleLinks() {
	const keys = visible.value.flatMap(entry => entry.recipient ? [entry.recipient.key] : [])
	try {
		const [links, legacy] = await Promise.all([
			keys.length ? fetchLatestEventRecipientLinks(props.gallery.id, keys) : Promise.resolve([]),
			fetchEventRecipients(props.gallery.id, { limit: 100 }),
		])
		const next = new Map(latestLinks.value)
		for (const link of links) if (link.setupKey) next.set(link.setupKey, link)
		latestLinks.value = next
		const signature = (items: EventRecipient[]) => items.map(item => `${item.id}:${item.status}:${item.folderState}:${item.updatedAt ?? 0}`).join('|')
		if (signature(legacy.items) !== signature(legacyRecipients.value)) legacyRecipients.value = legacy.items
	} catch {
		// Recipient setup remains usable without operational history.
	}
}

async function toggleRecipient(recipient: EventSetupRecipient, folder: EventFolderPreview) {
	if (expandedKey.value === recipient.key) { expandedKey.value = null; return }
	expandedKey.value = recipient.key
	if (histories.value.has(recipient.key)) return
	historyLoadingKey.value = recipient.key
	try {
		let items = (await fetchEventRecipients(props.gallery.id, { limit: 100, setupKey: recipient.key })).items
		if (!items.length) items = (await fetchEventRecipients(props.gallery.id, { limit: 100, query: recipient.name })).items.filter(item => normalizeMatch(item.name) === normalizeMatch(recipient.name) && normalizeMatch(item.folderPath) === normalizeMatch(folder.path))
		const next = new Map(histories.value); next.set(recipient.key, items); histories.value = next
	} catch { showError(t('proofing_gallery', 'Link history could not be loaded.')) } finally { historyLoadingKey.value = null }
}

async function copyLink(recipient: EventRecipient) {
	if (!recipient.link?.url) return
	await navigator.clipboard.writeText(recipient.link.url)
	showSuccess(t('proofing_gallery', 'Recipient link copied.'))
}

function replaceOperationalRecipient(nextRecipient: EventRecipient) {
	if (nextRecipient.setupKey) {
		const links = new Map(latestLinks.value); links.set(nextRecipient.setupKey, nextRecipient); latestLinks.value = links
		const history = new Map(histories.value)
		if (history.has(nextRecipient.setupKey)) history.set(nextRecipient.setupKey, history.get(nextRecipient.setupKey)!.map(item => item.id === nextRecipient.id ? nextRecipient : item))
		histories.value = history
	}
	legacyRecipients.value = legacyRecipients.value.map(item => item.id === nextRecipient.id ? nextRecipient : item)
}

async function operate(recipient: EventRecipient, action: 'resend' | 'revoke' | 'delete' | 'rotate_pin' | 'rotate_link') {
	if (['revoke', 'delete', 'rotate_link'].includes(action) && !window.confirm(t('proofing_gallery', 'Apply this action to {name}?', { name: recipient.name }))) return
	recipientAction.value = recipient.id
	try {
		const result = await operateEventRecipient(props.gallery.id, recipient.id, action)
		if ('deleted' in result) {
			for (const [key, items] of histories.value) histories.value.set(key, items.filter(item => item.id !== recipient.id))
			latestLinks.value = new Map([...latestLinks.value].filter(([, item]) => item.id !== recipient.id))
			legacyRecipients.value = legacyRecipients.value.filter(item => item.id !== recipient.id)
		} else {
			const updated = 'recipient' in result ? result.recipient : result
			replaceOperationalRecipient(updated)
			if ('pin' in result) oneTimePin.value = result.pin
		}
		emit('operations-updated'); showSuccess(t('proofing_gallery', 'Recipient link updated.'))
	} catch (error) {
		if (missingPublicShare(error) && recipient.allowedActions?.includes('edit')) {
			liveEditor.value = { ...recipient, groupRoots: [...recipient.groupRoots] }
			recoveryNeeded.value = true
		} else showError(publicShareError(error, t('proofing_gallery', 'The recipient action could not be completed.')))
	} finally { recipientAction.value = null }
}

async function saveLiveRecipient(choices?: ShareRecoveryChoices) {
	if (recoveryNeeded.value && !choices) return
	if (!liveEditor.value) return
	recipientAction.value = liveEditor.value.id
	try {
		const updated = await editEventRecipient(props.gallery.id, liveEditor.value.id, { folderPath: liveEditor.value.folderPath, groupRoots: liveEditor.value.groupRoots, name: liveEditor.value.name, email: liveEditor.value.email ?? '', locale: liveEditor.value.locale, ...choices })
		replaceOperationalRecipient(updated); liveEditor.value = null; recoveryNeeded.value = false; emit('operations-updated')
		recoveryNotice.value = shareRecoveryMessage(updated.recovery) ?? ''; showSuccess(recoveryNotice.value || t('proofing_gallery', 'Live recipient link updated.'))
	} catch (error) {
		if (missingPublicShare(error)) recoveryNeeded.value = true
		else showError(publicShareError(error, t('proofing_gallery', 'The live recipient link could not be updated.')))
	} finally { recipientAction.value = null }
}

async function bulkAction(action: 'resend' | 'revoke' | 'delete') {
	if (!selected.value.length) return
	operationBusy.value = true
	try { await bulkEventRecipients(props.gallery.id, selected.value, action); selected.value = []; await loadVisibleLinks(); emit('operations-updated'); showSuccess(t('proofing_gallery', 'Selected recipient links updated.')) } catch { showError(t('proofing_gallery', 'Some recipient links could not be updated.')) } finally { operationBusy.value = false }
}

watch([query, needsAttention], () => { page.value = 0 })
watch([visible, page], () => { loadVisibleLinks().catch(() => {}) }, { immediate: true })
</script>

<template>
	<p v-if="recoveryNotice" role="status">
		{{ recoveryNotice }}
	</p>
	<div class="event-list-toolbar">
		<div class="toolbar-search">
			<LinkVariantIcon :size="18" aria-hidden="true" /><input v-model="query" type="search" :placeholder="t('proofing_gallery', 'Search recipients or folders')">
		</div>
		<label class="filter-chip"><input v-model="needsAttention" type="checkbox"> {{ t('proofing_gallery', 'Needs attention') }}</label><span>{{ t('proofing_gallery', '{count} recipients', { count: filtered.length }) }}</span>
	</div>
	<div v-if="selected.length" class="event-bulk-bar">
		<strong>{{ t('proofing_gallery', '{count} released links selected', { count: selected.length }) }}</strong><NcButton variant="tertiary" :disabled="operationBusy" @click="bulkAction('resend')">
			{{ t('proofing_gallery', 'Send again') }}
		</NcButton><NcButton variant="tertiary" :disabled="operationBusy" @click="bulkAction('revoke')">
			{{ t('proofing_gallery', 'Revoke') }}
		</NcButton><NcButton variant="tertiary" :disabled="operationBusy" @click="bulkAction('delete')">
			{{ t('proofing_gallery', 'Delete') }}
		</NcButton>
	</div>
	<div class="recipient-ledger" role="list">
		<article v-for="entry in visible"
			:key="entry.releasedOnly ? `released-${entry.releasedOnly.id}` : entry.recipient?.key ?? `folder-${entry.folder.id}`"
			class="recipient-row"
			:class="{ expanded: entry.recipient && expandedKey === entry.recipient.key }"
			role="listitem">
			<template v-if="entry.recipient">
				<template v-for="released in [entry.releasedOnly ?? latestFor(entry.recipient, entry.folder)]" :key="released?.id ?? entry.recipient.key">
					<div class="recipient-row__summary">
						<input v-if="released"
							v-model="selected"
							type="checkbox"
							:value="released.id"
							:aria-label="t('proofing_gallery', 'Select {name}', { name: entry.recipient.name })"><span v-else class="recipient-select-placeholder" /><span class="recipient-monogram" aria-hidden="true">{{ (entry.recipient.name || entry.folder.name).slice(0, 2).toLocaleUpperCase() }}</span><div class="recipient-identity">
								<strong>{{ entry.recipient.name || entry.folder.name }}</strong><small>{{ entry.recipient.email || t('proofing_gallery', 'Manual delivery') }} · {{ entry.folder.path }}</small>
							</div><div class="scope-ribbon" :aria-label="t('proofing_gallery', 'Visible content: shared, group, and private')">
								<i data-scope="shared" :title="t('proofing_gallery', '{count} shared folders', { count: sharedFolders.length })" /><i v-if="entry.recipient.groupFolderIds.length"
									data-scope="group"
									:style="{ flexGrow: entry.recipient.groupFolderIds.length }"
									:title="t('proofing_gallery', '{count} group folders', { count: entry.recipient.groupFolderIds.length })" /><i data-scope="private" :style="{ flexGrow: Math.max(1, entry.folder.totalMediaCount / 10) }" :title="t('proofing_gallery', '{count} private photos', { count: entry.folder.totalMediaCount })" />
							</div><span class="recipient-status" :data-status="released?.folderState === 'missing' ? 'failed' : released?.status ?? 'unreleased'"><CheckCircleIcon v-if="released && released.folderState !== 'missing' && !['failed', 'revoked'].includes(released.status)" :size="17" /><AlertCircleIcon v-else-if="released" :size="17" /><LinkVariantIcon v-else :size="17" />{{ released?.folderState === 'missing' ? t('proofing_gallery', 'Folder unavailable') : statusLabel(released) }}</span><NcButton v-if="released?.link?.status === 'active'" variant="primary" @click.stop="copyLink(released)">
								<template #icon>
									<ContentCopyIcon :size="18" />
								</template>{{ t('proofing_gallery', 'Copy link') }}
							</NcButton><button class="recipient-expand"
								type="button"
								:aria-expanded="expandedKey === entry.recipient.key"
								:aria-label="t('proofing_gallery', 'Show details for {name}', { name: entry.recipient.name })"
								@click="toggleRecipient(entry.recipient, entry.folder)">
								<ChevronDownIcon :size="22" />
							</button>
					</div>
					<div v-if="expandedKey === entry.recipient.key" class="recipient-row__details">
						<section v-if="!entry.releasedOnly" class="recipient-next">
							<header>
								<div><span>{{ t('proofing_gallery', 'Next delivery') }}</span><h4>{{ t('proofing_gallery', 'Recipient details') }}</h4></div><NcButton variant="tertiary" @click="addRecipient(entry.folder)">
									{{ t('proofing_gallery', 'Add separate contact') }}
								</NcButton>
							</header><div class="recipient-fields">
								<label><span>{{ t('proofing_gallery', 'Client name') }}</span><input v-model="entry.recipient.name" maxlength="120"><small>{{ t('proofing_gallery', 'Shown as the title of the private link.') }}</small></label><label><span>{{ t('proofing_gallery', 'Email (optional)') }}</span><input v-model="entry.recipient.email" type="email"><small>{{ delivery.sendInvitations ? t('proofing_gallery', 'Required when invitations are enabled.') : t('proofing_gallery', 'Keep empty for manual delivery.') }}</small></label><label><span>{{ t('proofing_gallery', 'Language') }}</span><select v-model="entry.recipient.locale"><option :value="null">{{ t('proofing_gallery', 'Gallery default') }}</option><option value="de">{{ t('proofing_gallery', 'German') }}</option><option value="en">{{ t('proofing_gallery', 'English') }}</option></select><small>{{ t('proofing_gallery', 'Controls the public gallery language.') }}</small></label>
							</div><fieldset v-if="groupFolders.length" class="group-token-picker">
								<legend>{{ t('proofing_gallery', 'Additional group access') }}</legend><label v-for="group in groupFolders" :key="group.id" :class="{ selected: entry.recipient.groupFolderIds.includes(group.id) }"><input v-model="entry.recipient.groupFolderIds" type="checkbox" :value="group.id"><span>{{ group.path }}</span></label>
							</fieldset><div class="inline-actions">
								<NcButton variant="secondary" :disabled="saving" @click="emit('save')">
									{{ saving ? t('proofing_gallery', 'Saving…') : t('proofing_gallery', 'Save next delivery') }}
								</NcButton><NcButton v-if="recipientCount(entry.folder.id) > 1" variant="tertiary" @click="removeRecipient(entry.recipient.key)">
									{{ t('proofing_gallery', 'Remove contact') }}
								</NcButton>
							</div>
						</section>
						<section class="scope-inspector">
							<header><span>{{ t('proofing_gallery', 'Exact access') }}</span><strong>{{ sharedFolders.reduce((sum, folder) => sum + folder.totalMediaCount, 0) + entry.recipient.groupFolderIds.reduce((sum, id) => sum + (folderById(id)?.totalMediaCount ?? 0), 0) + entry.folder.totalMediaCount }} {{ t('proofing_gallery', 'photos available') }}</strong></header><dl>
								<div data-scope="shared">
									<dt>{{ t('proofing_gallery', 'Everyone') }}</dt><dd>{{ sharedFolders.map(folder => folder.path).join(', ') || '—' }}</dd>
								</div><div data-scope="group">
									<dt>{{ t('proofing_gallery', 'Selected groups') }}</dt><dd>{{ entry.recipient.groupFolderIds.map(id => folderById(id)?.path).filter(Boolean).join(', ') || '—' }}</dd>
								</div><div data-scope="private">
									<dt>{{ t('proofing_gallery', 'Private') }}</dt><dd>{{ entry.folder.path }}</dd>
								</div>
							</dl>
						</section>
						<section class="link-history">
							<header><div><HistoryIcon :size="20" /><span>{{ t('proofing_gallery', 'Released link history') }}</span></div><small>{{ histories.get(entry.recipient.key)?.length ?? 0 }} {{ t('proofing_gallery', 'releases') }}</small></header><div v-if="historyLoadingKey === entry.recipient.key" class="history-loading">
								<NcLoadingIcon :size="24" /> {{ t('proofing_gallery', 'Loading link history…') }}
							</div><div v-else-if="!histories.get(entry.recipient.key)?.length" class="history-empty">
								{{ t('proofing_gallery', 'No links have been released for this recipient yet.') }}
							</div><article v-for="history in histories.get(entry.recipient.key) ?? []" :key="history.id">
								<div><strong>{{ statusLabel(history) }}</strong><small>{{ history.folderPath }} · #{{ history.waveId ?? '—' }}</small></div><NcButton v-if="history.link?.status === 'active'" variant="tertiary" @click="copyLink(history)">
									<template #icon>
										<ContentCopyIcon :size="17" />
									</template>{{ t('proofing_gallery', 'Copy') }}
								</NcButton><a v-if="history.link?.status === 'active'"
									:href="history.link.url"
									target="_blank"
									rel="noopener"><OpenInNewIcon :size="17" />{{ t('proofing_gallery', 'Open') }}</a><NcButton v-if="history.allowedActions?.includes('edit')" variant="tertiary" @click="recoveryNeeded = false; liveEditor = { ...history, groupRoots: [...history.groupRoots] }">
										{{ t('proofing_gallery', 'Edit live link') }}
									</NcButton><NcButton v-if="history.allowedActions?.includes('resend')"
									variant="tertiary"
									:disabled="recipientAction === history.id"
									@click="operate(history, 'resend')">
									{{ t('proofing_gallery', 'Send again') }}
								</NcButton><details>
									<summary>{{ t('proofing_gallery', 'More') }}</summary><button v-if="history.allowedActions?.includes('rotate_pin')" type="button" @click="operate(history, 'rotate_pin')">
										{{ t('proofing_gallery', 'Rotate PIN') }}
									</button><button v-if="history.allowedActions?.includes('rotate_link')" type="button" @click="operate(history, 'rotate_link')">
										{{ t('proofing_gallery', 'Rotate link') }}
									</button><button v-if="history.allowedActions?.includes('revoke')" type="button" @click="operate(history, 'revoke')">
										{{ t('proofing_gallery', 'Revoke') }}
									</button><button v-if="history.allowedActions?.includes('delete')" type="button" @click="operate(history, 'delete')">
										{{ t('proofing_gallery', 'Delete') }}
									</button>
								</details>
							</article>
						</section>
						<section v-if="liveEditor && histories.get(entry.recipient.key)?.some(item => item.id === liveEditor?.id)" class="live-link-editor">
							<PublicShareRecoveryForm v-if="recoveryNeeded"
								:busy="recipientAction !== null"
								@confirm="saveLiveRecipient"
								@cancel="recoveryNeeded = false" />
							<header>
								<strong>{{ t('proofing_gallery', 'Edit this released link') }}</strong><button type="button" @click="liveEditor = null">
									×
								</button>
							</header><div class="recipient-fields">
								<label><span>{{ t('proofing_gallery', 'Client name') }}</span><input v-model="liveEditor.name" maxlength="120"></label><label><span>{{ t('proofing_gallery', 'Email') }}</span><input v-model="liveEditor.email" type="email"></label><label><span>{{ t('proofing_gallery', 'Private folder') }}</span><select v-model="liveEditor.folderPath"><option v-for="folder in folders" :key="folder.id" :value="folder.path">{{ folder.path }}</option></select></label>
							</div><div class="inline-actions">
								<NcButton variant="primary" :disabled="recipientAction === liveEditor.id" @click="saveLiveRecipient()">
									{{ t('proofing_gallery', 'Save live link') }}
								</NcButton><NcButton variant="tertiary" @click="liveEditor = null">
									{{ t('proofing_gallery', 'Cancel') }}
								</NcButton>
							</div>
						</section>
					</div>
				</template>
			</template>
			<div v-else class="recipient-row__empty">
				<AlertCircleIcon :size="20" /><span><strong>{{ entry.folder.name }}</strong><small>{{ t('proofing_gallery', 'This private folder needs a recipient.') }}</small></span><NcButton variant="secondary" @click="addRecipient(entry.folder, false)">
					{{ t('proofing_gallery', 'Add recipient') }}
				</NcButton>
			</div>
		</article>
	</div>
	<div v-if="pages > 1" class="event-pager">
		<NcButton variant="tertiary" :disabled="page === 0" @click="page--">
			{{ t('proofing_gallery', 'Previous') }}
		</NcButton><span>{{ t('proofing_gallery', 'Page {page} of {pages}', { page: page + 1, pages }) }}</span><NcButton variant="tertiary" :disabled="page + 1 >= pages" @click="page++">
			{{ t('proofing_gallery', 'Next') }}
		</NcButton>
	</div>
	<div v-if="oneTimePin" class="one-time-pin" role="status">
		<strong>{{ t('proofing_gallery', 'Copy this new PIN now. It will not be shown again.') }}</strong><code>{{ oneTimePin }}</code><button type="button" @click="oneTimePin = ''">
			×
		</button>
	</div>
</template>
