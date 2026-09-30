<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { missingPublicShare, publicShareError, shareRecoveryMessage } from '../domain/publicShareRecovery.ts'
import type { ShareRecoveryChoices } from '../domain/publicShareRecovery.ts'
import PublicShareRecoveryForm from './PublicShareRecoveryForm.vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import QRCode from 'qrcode'
import { onMounted, ref } from 'vue'
import { fetchGallery, fetchPublicLinks, fetchShareAudit, makePublicLinkPrimary, requestCustomDomain, revokeCustomDomain, revokePublicLink, savePublicLink } from '../services/galleryApi.ts'
import type { Gallery, GalleryPublicLink, PublicLinkPolicy, ShareAuditItem } from '../types.ts'

const recoveryNeeded = ref(false)
const recoveryNotice = ref('')
const props = defineProps<{ gallery: Gallery }>()
const emit = defineEmits<{ 'gallery-updated': [gallery: Gallery] }>()
const links = ref<GalleryPublicLink[]>([])
const presets = ref<Record<string, PublicLinkPolicy>>({})
const audit = ref<ShareAuditItem[]>([])
const auditTotal = ref(0)
const auditCursor = ref<string | null>(null)
const auditLoadingMore = ref(false)
const loading = ref(true)
const saving = ref(false)
const editingId = ref<number | null | 'new'>(null)
const qrUrl = ref('')
const qrData = ref('')
const permissionKeys: Array<Exclude<keyof PublicLinkPolicy, 'view' | 'downloadScope'>> = ['likes', 'colors', 'comments', 'annotations', 'selections', 'ratings', 'pick', 'upload', 'export', 'metadata']
const permissionLabels: Record<(typeof permissionKeys)[number], string> = {
	likes: t('proofing_gallery', 'Likes'),
	colors: t('proofing_gallery', 'Color workflow'),
	comments: t('proofing_gallery', 'Comments'),
	annotations: t('proofing_gallery', 'Image annotations'),
	selections: t('proofing_gallery', 'Client selections'),
	ratings: t('proofing_gallery', 'Client ratings'),
	pick: t('proofing_gallery', 'Pick'),
	upload: t('proofing_gallery', 'Upload'),
	export: t('proofing_gallery', 'Export'),
	metadata: t('proofing_gallery', 'Metadata'),
}
const downloadScopeLabels: Record<PublicLinkPolicy['downloadScope'], string> = {
	none: t('proofing_gallery', 'Downloads disabled'),
	individual: t('proofing_gallery', 'Individual files'),
	selection: t('proofing_gallery', 'Saved selections'),
	all: t('proofing_gallery', 'Files, selections, and entire gallery'),
}
const presetLabels: Record<string, string> = {
	presentation: t('proofing_gallery', 'Presentation'),
	selection: t('proofing_gallery', 'Selection'),
	proofing: t('proofing_gallery', 'Proofing'),
	delivery: t('proofing_gallery', 'Delivery'),
	upload: t('proofing_gallery', 'Upload'),
}
const reviewStatusLabels: Record<string, string> = {
	awaiting_feedback: t('proofing_gallery', 'Review open'),
	submitted: t('proofing_gallery', 'Submitted for approval'),
	changes_requested: t('proofing_gallery', 'Changes requested'),
	approved: t('proofing_gallery', 'Approved'),
}
const draft = ref(createDraft())

function createDraft() {
	return {
		name: '',
		preset: 'presentation',
		startPath: '',
		viewMode: 'folder' as 'folder' | 'recursive',
		groupDepth: 1,
		minOwnerRating: 0,
		publicLocale: null as 'en' | 'de' | null,
		reviewEnabled: ['selection', 'proofing'].includes(props.gallery.purpose),
		reviewDueDate: '',
		reviewSelectionMinimum: null as number | null,
		reviewSelectionMaximum: null as number | null,
		password: '',
		expiresAt: '',
		policy: ({ view: true, likes: false, colors: false, comments: false, annotations: false, selections: false, ratings: false, pick: false, upload: false, export: false, metadata: false, downloadScope: 'none' }) as PublicLinkPolicy,
	}
}

async function load() {
	loading.value = true
	try {
		const [linkData, auditData] = await Promise.all([fetchPublicLinks(props.gallery.id), fetchShareAudit(props.gallery.id)])
		links.value = linkData.items
		presets.value = linkData.presets
		audit.value = auditData.items
		auditTotal.value = auditData.total
		auditCursor.value = auditData.nextCursor
	} catch { showError(t('proofing_gallery', 'Public links could not be loaded.')) } finally { loading.value = false }
}

function startNew() {
	recoveryNeeded.value = false
	draft.value = createDraft()
	applyPreset('presentation')
	editingId.value = 'new'
}

function edit(link: GalleryPublicLink) {
	recoveryNeeded.value = false
	recoveryNotice.value = ''
	draft.value = { ...createDraft(), name: link.name, startPath: link.startPath, viewMode: link.viewMode, groupDepth: link.groupDepth, minOwnerRating: link.minOwnerRating, publicLocale: link.publicLocale, reviewEnabled: link.reviewEnabled, reviewDueDate: link.reviewDueDate ?? '', reviewSelectionMinimum: link.reviewSelectionMinimum, reviewSelectionMaximum: link.reviewSelectionMaximum, policy: structuredClone(link.policy) }
	editingId.value = link.id
}

function applyPreset(name: string) {
	draft.value.preset = name
	if (presets.value[name]) draft.value.policy = structuredClone(presets.value[name])
}

function updatePermission(key: Exclude<keyof PublicLinkPolicy, 'view' | 'downloadScope'>, value: boolean) {
	draft.value.policy[key] = value
	if (key === 'comments' && !value) draft.value.policy.annotations = false
}

async function save(choices?: ShareRecoveryChoices) {
	if (recoveryNeeded.value && !choices) return
	saving.value = true
	try {
		const link = await savePublicLink(props.gallery.id, editingId.value === 'new' ? null : editingId.value as number, {
			...draft.value, reviewDueDate: draft.value.reviewDueDate || null, password: draft.value.password || null, expiresAt: draft.value.expiresAt || null, ...choices,
		})
		links.value = editingId.value === 'new' ? [...links.value, link] : links.value.map(item => item.id === link.id ? link : item)
		editingId.value = null
		recoveryNeeded.value = false
		recoveryNotice.value = shareRecoveryMessage(link.recovery) ?? ''
		if (link.primary) emit('gallery-updated', await fetchGallery(props.gallery.id))
		showSuccess(recoveryNotice.value || t('proofing_gallery', 'Public link saved.'))
	} catch (error) {
		if (missingPublicShare(error)) recoveryNeeded.value = true
		else showError(publicShareError(error, t('proofing_gallery', 'The public link could not be saved. Check its scope and permissions.')))
	} finally { saving.value = false }
}

async function makePrimary(link: GalleryPublicLink) {
	try {
		await makePublicLinkPrimary(props.gallery.id, link.id)
		links.value = links.value.map(item => ({ ...item, primary: item.id === link.id }))
		emit('gallery-updated', await fetchGallery(props.gallery.id))
		showSuccess(t('proofing_gallery', 'Primary link changed.'))
	} catch { showError(t('proofing_gallery', 'The primary link could not be changed.')) }
}

async function revoke(link: GalleryPublicLink) {
	if (!window.confirm(t('proofing_gallery', 'Revoke {name}? Guests using this URL will immediately lose access.', { name: link.name }))) return
	try {
		const updated = await revokePublicLink(props.gallery.id, link.id)
		links.value = links.value.map(item => item.id === updated.id ? updated : item)
		const auditPage = await fetchShareAudit(props.gallery.id)
		audit.value = auditPage.items; auditTotal.value = auditPage.total; auditCursor.value = auditPage.nextCursor
	} catch { showError(t('proofing_gallery', 'The public link could not be revoked.')) }
}

async function loadMoreAudit() {
	if (!auditCursor.value || auditLoadingMore.value) return
	auditLoadingMore.value = true
	try {
		const page = await fetchShareAudit(props.gallery.id, auditCursor.value)
		audit.value.push(...page.items); auditTotal.value = page.total; auditCursor.value = page.nextCursor
	} catch { showError(t('proofing_gallery', 'Access audit could not be loaded.')) } finally { auditLoadingMore.value = false }
}

async function showQr(link: GalleryPublicLink) {
	qrUrl.value = link.url
	qrData.value = await QRCode.toDataURL(link.url, { width: 360, margin: 2 })
}

async function copy(link: GalleryPublicLink) {
	await navigator.clipboard.writeText(link.url)
	showSuccess(t('proofing_gallery', 'Gallery link copied.'))
}

async function addDomain(link: GalleryPublicLink) {
	const domain = window.prompt(t('proofing_gallery', 'Enter the custom domain for this link'))?.trim()
	if (!domain) return
	try {
		await requestCustomDomain(props.gallery.id, link.id, domain)
		await load()
		showSuccess(t('proofing_gallery', 'Domain requested. Add the displayed DNS TXT record, then ask an administrator to verify it.'))
	} catch { showError(t('proofing_gallery', 'The custom domain could not be requested.')) }
}

async function copyDomainRecord(link: GalleryPublicLink) {
	if (!link.customDomain) return
	await navigator.clipboard.writeText(`${link.customDomain.verificationName} TXT ${link.customDomain.verificationValue}`)
	showSuccess(t('proofing_gallery', 'DNS verification record copied.'))
}

async function removeDomain(link: GalleryPublicLink) {
	if (!link.customDomain || !window.confirm(t('proofing_gallery', 'Revoke this custom domain? The standard gallery link remains available.'))) return
	try {
		await revokeCustomDomain(props.gallery.id, link.customDomain.id)
		await load()
		showSuccess(t('proofing_gallery', 'Custom domain revoked.'))
	} catch { showError(t('proofing_gallery', 'The custom domain could not be revoked.')) }
}

function formatDate(timestamp: number) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp * 1000) }
onMounted(load)
</script>

<template>
	<section class="link-manager" aria-labelledby="public-link-manager-title">
		<header>
			<div>
				<span>{{ t('proofing_gallery', 'LINK PORTFOLIO') }}</span><h3 id="public-link-manager-title">
					{{ t('proofing_gallery', 'Client links') }}
				</h3>
			</div>
			<NcButton variant="primary" :disabled="loading" @click="startNew">
				{{ t('proofing_gallery', 'New client link') }}
			</NcButton>
		</header>
		<p class="link-manager__lead">
			{{ t('proofing_gallery', 'Give every audience its own URL, permissions and folder scope. No password or token is written to the audit log.') }}
		</p>
		<div v-if="loading" role="status">
			{{ t('proofing_gallery', 'Loading…') }}
		</div>
		<div v-else class="link-cards">
			<article v-for="link in links" :key="link.id" :class="{ 'is-revoked': link.status === 'revoked' }">
				<div class="link-card__top">
					<div><strong>{{ link.name }}</strong><span v-if="link.primary">{{ t('proofing_gallery', 'PRIMARY') }}</span></div><small>{{ link.status === 'active' ? t('proofing_gallery', 'Active') : t('proofing_gallery', 'Revoked') }}</small>
				</div>
				<p>{{ link.viewMode === 'recursive' ? t('proofing_gallery', 'Recursive') : t('proofing_gallery', 'Folder view') }} · {{ link.allowedRoots?.length ? link.allowedRoots.join(' + ') : (link.startPath || t('proofing_gallery', 'Gallery root')) }} · {{ downloadScopeLabels[link.policy.downloadScope] }}</p>
				<p v-if="link.reviewEnabled" class="link-card__review">
					{{ t('proofing_gallery', 'Review round {round}: {status}', { round: link.review.current?.round ?? 1, status: reviewStatusLabels[link.review.current?.status ?? 'awaiting_feedback'] ?? link.review.current?.status ?? '' }) }}<template v-if="link.reviewDueDate">
						· {{ link.reviewDueDate }}
					</template>
				</p>
				<div v-if="link.customDomain" class="link-domain" :data-status="link.customDomain.status">
					<div><strong>{{ link.customDomain.domain }}</strong><span>{{ link.customDomain.status === 'verified' ? t('proofing_gallery', 'Verified HTTPS domain') : t('proofing_gallery', 'Waiting for DNS and administrator verification') }}</span></div>
					<code v-if="link.customDomain.status === 'pending'">{{ link.customDomain.verificationName }} TXT {{ link.customDomain.verificationValue }}</code>
					<NcButton v-if="link.customDomain.status === 'pending'" variant="tertiary" @click="copyDomainRecord(link)">
						{{ t('proofing_gallery', 'Copy DNS record') }}
					</NcButton>
					<NcButton variant="tertiary" @click="removeDomain(link)">
						{{ t('proofing_gallery', 'Remove domain') }}
					</NcButton>
				</div>
				<div v-if="link.status === 'active'" class="link-card__actions">
					<NcButton variant="tertiary" @click="copy(link)">
						{{ t('proofing_gallery', 'Copy') }}
					</NcButton>
					<NcButton variant="tertiary" @click="showQr(link)">
						{{ t('proofing_gallery', 'QR code') }}
					</NcButton>
					<a :href="`mailto:?subject=${encodeURIComponent(gallery.title)}&body=${encodeURIComponent(link.url)}`">{{ t('proofing_gallery', 'Email') }}</a>
					<NcButton variant="tertiary" @click="edit(link)">
						{{ t('proofing_gallery', 'Edit') }}
					</NcButton>
					<NcButton v-if="!link.customDomain" variant="tertiary" @click="addDomain(link)">
						{{ t('proofing_gallery', 'Custom domain') }}
					</NcButton>
					<NcButton v-if="!link.primary" variant="tertiary" @click="makePrimary(link)">
						{{ t('proofing_gallery', 'Make primary') }}
					</NcButton>
					<NcButton v-if="!link.primary" variant="error" @click="revoke(link)">
						{{ t('proofing_gallery', 'Revoke') }}
					</NcButton>
				</div>
			</article>
		</div>

		<p v-if="recoveryNotice" role="status">
			{{ recoveryNotice }}
		</p>
		<PublicShareRecoveryForm v-if="recoveryNeeded && editingId !== null"
			:busy="saving"
			@confirm="save"
			@cancel="recoveryNeeded = false" />
		<form v-if="editingId !== null" class="link-editor" @submit.prevent="save()">
			<h4>{{ editingId === 'new' ? t('proofing_gallery', 'Create client link') : t('proofing_gallery', 'Edit client link') }}</h4>
			<div class="link-editor__grid">
				<label><span>{{ t('proofing_gallery', 'Link name') }}</span><input v-model="draft.name"
					name="linkName"
					required
					maxlength="120"></label>
				<label><span>{{ t('proofing_gallery', 'Permission preset') }}</span><select v-model="draft.preset" name="linkPreset" @change="applyPreset(draft.preset)"><option v-for="(_, name) in presets" :key="name" :value="name">{{ presetLabels[name] ?? name }}</option></select></label>
				<label><span>{{ t('proofing_gallery', 'Start folder') }}</span><input v-model="draft.startPath" name="linkStartPath" :placeholder="t('proofing_gallery', 'Client / Finals')"></label>
				<label><span>{{ t('proofing_gallery', 'View mode') }}</span><select v-model="draft.viewMode" name="linkViewMode"><option value="folder">{{ t('proofing_gallery', 'Folder view') }}</option><option value="recursive">{{ t('proofing_gallery', 'Recursive') }}</option></select></label>
				<label><span>{{ t('proofing_gallery', 'Minimum owner rating') }}</span><select v-model.number="draft.minOwnerRating" name="linkMinRating"><option v-for="rating in 6" :key="rating - 1" :value="rating - 1">{{ rating - 1 }} ★</option></select></label>
				<label><span>{{ t('proofing_gallery', 'Public language') }}</span><select v-model="draft.publicLocale" name="linkLocale"><option :value="null">{{ t('proofing_gallery', 'Gallery default') }}</option><option value="de">{{ t('proofing_gallery', 'German') }}</option><option value="en">{{ t('proofing_gallery', 'English') }}</option></select></label>
				<label><span>{{ t('proofing_gallery', 'Password') }}</span><input v-model="draft.password"
					name="linkPassword"
					type="password"
					autocomplete="new-password"></label>
				<label><span>{{ t('proofing_gallery', 'Expires on') }}</span><input v-model="draft.expiresAt" name="linkExpiry" type="date"></label>
				<label class="link-editor__review"><span>{{ t('proofing_gallery', 'Review round') }}</span><span><input v-model="draft.reviewEnabled" name="reviewEnabled" type="checkbox"> {{ t('proofing_gallery', 'Let guests submit this link for approval') }}</span></label>
				<label v-if="draft.reviewEnabled"><span>{{ t('proofing_gallery', 'Review due date') }}</span><input v-model="draft.reviewDueDate" name="reviewDueDate" type="date"></label>
				<label v-if="draft.reviewEnabled"><span>{{ t('proofing_gallery', 'Minimum selections') }}</span><input v-model.number="draft.reviewSelectionMinimum"
					name="reviewSelectionMinimum"
					type="number"
					min="0"
					max="1000"
					:placeholder="t('proofing_gallery', 'Gallery default')"></label>
				<label v-if="draft.reviewEnabled"><span>{{ t('proofing_gallery', 'Maximum selections') }}</span><input v-model.number="draft.reviewSelectionMaximum"
					name="reviewSelectionMaximum"
					type="number"
					min="0"
					max="1000"
					:placeholder="t('proofing_gallery', 'Gallery default')"></label>
			</div>
			<fieldset>
				<legend>{{ t('proofing_gallery', 'Permissions') }}</legend><label v-for="key in permissionKeys" :key="key"><input :checked="draft.policy[key]"
					type="checkbox"
					:name="`policy-${key}`"
					:disabled="key === 'annotations' && !draft.policy.comments"
					@change="updatePermission(key, ($event.target as HTMLInputElement).checked)">{{ permissionLabels[key] }}</label><label><span>{{ t('proofing_gallery', 'Download access') }}</span><select v-model="draft.policy.downloadScope" name="linkDownloads"><option v-for="(label, scope) in downloadScopeLabels" :key="scope" :value="scope">{{ label }}</option></select></label>
			</fieldset>
			<div class="link-editor__actions">
				<NcButton type="submit" variant="primary" :disabled="saving">
					{{ saving ? t('proofing_gallery', 'Saving…') : t('proofing_gallery', 'Save link') }}
				</NcButton><NcButton type="button" variant="tertiary" @click="editingId = null">
					{{ t('proofing_gallery', 'Cancel') }}
				</NcButton>
			</div>
		</form>

		<div v-if="qrData" class="link-qr">
			<img :src="qrData" :alt="t('proofing_gallery', 'QR code for the selected client link')"><div>
				<strong>{{ t('proofing_gallery', 'Ready to scan') }}</strong><a :href="qrUrl" target="_blank">{{ qrUrl }}</a><NcButton variant="tertiary" @click="qrData = ''">
					{{ t('proofing_gallery', 'Close') }}
				</NcButton>
			</div>
		</div>
		<details class="link-audit">
			<summary>{{ t('proofing_gallery', 'Access audit') }} <span>{{ audit.length }}/{{ auditTotal }}</span></summary><p v-if="!audit.length">
				{{ t('proofing_gallery', 'No audited link activity yet.') }}
			</p><ol v-else>
				<li v-for="(item, index) in audit" :key="`${item.createdAt}-${index}`">
					<strong>{{ item.event }}</strong><span>{{ item.outcome }} · {{ formatDate(item.createdAt) }}</span><small>{{ t('proofing_gallery', 'Link #{id}', { id: item.publicLinkId }) }}<template v-if="item.fileId"> · {{ t('proofing_gallery', 'File #{id}', { id: item.fileId }) }}</template></small>
				</li>
			</ol>
			<NcButton v-if="auditCursor"
				variant="tertiary"
				:disabled="auditLoadingMore"
				@click="loadMoreAudit">
				{{ t('proofing_gallery', 'Load older audit entries') }}
			</NcButton>
		</details>
	</section>
</template>

<style scoped>
.link-manager { display: grid; gap: 16px; padding: 24px 0; border-top: 1px solid var(--color-border); }

.link-manager > header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }

.link-manager > header span { color: var(--color-primary-element); font-size: 11px; font-weight: 800; letter-spacing: .12em; }

.link-manager h3 { margin: 2px 0 0; font-size: 24px; }

.link-manager__lead { max-width: 68ch; margin: 0; color: var(--color-text-maxcontrast); }

.link-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 10px; }

.link-cards article { display: grid; gap: 12px; min-width: 0; padding: 16px; border: 1px solid var(--color-border); border-top: 4px solid var(--color-primary-element); background: var(--color-main-background); }

.link-cards article.is-revoked { opacity: .55; border-top-color: var(--color-text-maxcontrast); }

.link-card__top, .link-card__top > div, .link-card__actions { display: flex; align-items: center; gap: 8px; }

.link-card__top { justify-content: space-between; }

.link-card__top span { padding: 3px 6px; background: var(--color-primary-element-light); color: var(--color-primary-element); font-size: 10px; font-weight: 800; }

.link-cards p { margin: 0; overflow-wrap: anywhere; color: var(--color-text-maxcontrast); font-size: 12px; }

.link-card__actions { flex-wrap: wrap; }

.link-card__actions a { padding: 7px 10px; color: var(--color-main-text); }

.link-domain { display: grid; gap: 8px; padding: 11px; border-radius: 10px; background: color-mix(in srgb, var(--color-primary-element) 9%, var(--color-background-dark)); }

.link-domain > div { display: grid; gap: 2px; }

.link-domain span { color: var(--color-text-maxcontrast); font-size: 12px; }

.link-domain code { overflow-wrap: anywhere; font-size: 11px; }

.link-domain[data-status="verified"] { box-shadow: inset 3px 0 #20a66a; }

.link-editor { display: grid; gap: 16px; padding: 20px; border: 2px solid var(--color-primary-element); background: var(--color-background-dark); }

.link-editor h4 { margin: 0; font-size: 20px; }

.link-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

.link-editor label { display: grid; gap: 5px; min-width: 0; font-size: 12px; }

.link-editor :is(input,select) { box-sizing: border-box; min-height: 42px; width: 100%; padding: 8px 10px; border: 1px solid var(--color-border-maxcontrast); border-radius: var(--border-radius-large); background: var(--color-main-background); color: var(--color-main-text); }

.link-editor fieldset { display: flex; flex-wrap: wrap; gap: 10px 16px; padding: 14px; border: 1px solid var(--color-border); }

.link-editor fieldset label { display: flex; align-items: center; }

.link-editor fieldset input { width: auto; min-height: 0; }

.link-editor__actions { display: flex; gap: 8px; }

.link-qr { display: flex; gap: 18px; padding: 18px; background: #111; color: #fff; }

.link-qr img { width: 144px; height: 144px; }

.link-qr div { display: grid; align-content: center; gap: 8px; min-width: 0; }

.link-qr a { overflow: hidden; color: #fff; text-overflow: ellipsis; }

.link-audit { padding: 14px; border: 1px solid var(--color-border); }

.link-audit summary { cursor: pointer; font-weight: 700; }

.link-audit ol { display: grid; gap: 8px; padding: 12px 0 0; margin: 0; list-style: none; }

.link-audit li { display: grid; grid-template-columns: 100px 1fr auto; gap: 10px; font-size: 12px; }

@media (max-width: 640px) { .link-manager > header { align-items: stretch; flex-direction: column; }.link-editor__grid { grid-template-columns: 1fr; }.link-qr { flex-direction: column; }.link-audit li { grid-template-columns: 80px 1fr; }.link-audit li small { grid-column: 1 / -1; } }
</style>
