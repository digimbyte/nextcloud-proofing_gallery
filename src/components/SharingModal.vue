<script setup lang="ts">
import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { missingPublicShare, publicShareError, shareRecoveryMessage } from '../domain/publicShareRecovery.ts'
import type { ShareRecoveryChoices } from '../domain/publicShareRecovery.ts'
import PublicShareRecoveryForm from './PublicShareRecoveryForm.vue'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import QRCode from 'qrcode'
import { computed, ref, watch } from 'vue'

import {
	createInvitationTemplate,
	deleteInvitationTemplate,
	fetchInvitationTemplates,
	publishGallery,
	renderInvitationTemplate,
	revokeGallery,
	sendInvitation,
	updateInvitationTemplate,
} from '../services/galleryApi.ts'
import type { Gallery, InvitationTemplate } from '../types.ts'

const recoveryNeeded = ref(false)
const recoveryNotice = ref('')
const props = defineProps<{ show: boolean; gallery: Gallery }>()
const emit = defineEmits<{
	close: []
	updated: [gallery: Gallery]
}>()

const password = ref('')
const removePassword = ref(false)
const expiresAt = ref('')
const publicUrl = ref(props.gallery.shareToken ? absoluteShareUrl(props.gallery.shareToken) : '')
const publishing = ref(false)
const recipient = ref('')
const invitationMessage = ref('')
const sending = ref(false)
const templates = ref<InvitationTemplate[]>([])
const templatesLoading = ref(false)
const templateSaving = ref(false)
const selectedTemplateId = ref<number | null>(null)
const templateName = ref('')
const qrDataUrl = ref('')
const qrSvg = ref('')
const published = computed(() => publicUrl.value !== '')
const publishDisabled = computed(() => publishing.value
	|| (!published.value && props.gallery.sourceType === 'collection' && props.gallery.mediaSummary.total === 0))

watch(() => props.gallery, gallery => {
	publicUrl.value = gallery.shareToken ? absoluteShareUrl(gallery.shareToken) : ''
})

watch(publicUrl, async url => {
	qrDataUrl.value = ''
	qrSvg.value = ''
	if (!url) return
	try {
		const options = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#111111', light: '#ffffff' } }
		const [dataUrl, svg] = await Promise.all([
			QRCode.toDataURL(url, { ...options, width: 480 }),
			QRCode.toString(url, { ...options, type: 'svg' }),
		])
		if (publicUrl.value === url) {
			qrDataUrl.value = dataUrl
			qrSvg.value = svg
		}
	} catch {
		showError(t('proofing_gallery', 'The QR code could not be generated.'))
	}
}, { immediate: true })

watch(() => props.show, async show => {
	if (!show) return
	recoveryNeeded.value = false
	recoveryNotice.value = ''
	templatesLoading.value = true
	try {
		templates.value = await fetchInvitationTemplates()
	} catch {
		templates.value = []
		showError(t('proofing_gallery', 'Invitation templates could not be loaded.'))
	} finally {
		templatesLoading.value = false
	}
})

async function selectTemplate() {
	if (selectedTemplateId.value === null) {
		templateName.value = ''
		return
	}
	const selected = templates.value.find(template => template.id === selectedTemplateId.value)
	if (!selected) return
	templateName.value = selected.name
	try {
		invitationMessage.value = await renderInvitationTemplate(selected.id, props.gallery.id)
	} catch {
		showError(t('proofing_gallery', 'The invitation template could not be applied.'))
	}
}

async function saveTemplate() {
	if (!templateName.value.trim() || !invitationMessage.value.trim()) return
	templateSaving.value = true
	try {
		if (selectedTemplateId.value === null) {
			const template = await createInvitationTemplate(templateName.value, invitationMessage.value)
			templates.value = [...templates.value, template].sort((left, right) => left.name.localeCompare(right.name))
			selectedTemplateId.value = template.id
		} else {
			const template = await updateInvitationTemplate(selectedTemplateId.value, templateName.value, invitationMessage.value)
			templates.value = templates.value.map(item => item.id === template.id ? template : item)
		}
		showSuccess(t('proofing_gallery', 'Invitation template saved.'))
	} catch {
		showError(t('proofing_gallery', 'The invitation template could not be saved. Check its name and placeholders.'))
	} finally {
		templateSaving.value = false
	}
}

async function removeTemplate() {
	if (selectedTemplateId.value === null) return
	if (!window.confirm(t('proofing_gallery', 'Delete this invitation template?'))) return
	try {
		await deleteInvitationTemplate(selectedTemplateId.value)
		templates.value = templates.value.filter(template => template.id !== selectedTemplateId.value)
		selectedTemplateId.value = null
		templateName.value = ''
		showSuccess(t('proofing_gallery', 'Invitation template deleted.'))
	} catch {
		showError(t('proofing_gallery', 'The invitation template could not be deleted.'))
	}
}

async function publish(choices?: ShareRecoveryChoices) {
	if (recoveryNeeded.value && !choices) return
	publishing.value = true
	try {
		const result = await publishGallery(props.gallery.id, {
			password: removePassword.value ? '' : password.value || null,
			expiresAt: expiresAt.value,
			expectedRevision: props.gallery.revision,
			...choices,
		})
		publicUrl.value = result.url
		password.value = ''
		removePassword.value = false
		emit('updated', result.gallery)
		recoveryNeeded.value = false
		recoveryNotice.value = shareRecoveryMessage(result.recovery) ?? ''
		showSuccess(recoveryNotice.value || t('proofing_gallery', 'Public gallery link updated.'))
	} catch (error) {
		if (missingPublicShare(error)) recoveryNeeded.value = true
		else showError(publicShareError(error, t('proofing_gallery', 'The public link could not be updated.')))
	} finally {
		publishing.value = false
	}
}

async function revoke() {
	if (!window.confirm(t('proofing_gallery', 'Revoke this public link? Existing guests will lose access.'))) {
		return
	}
	try {
		const gallery = await revokeGallery(props.gallery.id)
		publicUrl.value = ''
		recoveryNeeded.value = false
		recoveryNotice.value = ''
		emit('updated', gallery)
		showSuccess(t('proofing_gallery', 'Public link revoked.'))
	} catch {
		showError(t('proofing_gallery', 'The public link could not be revoked.'))
	}
}

async function copyLink() {
	await navigator.clipboard.writeText(publicUrl.value)
	showSuccess(t('proofing_gallery', 'Gallery link copied.'))
}

function downloadQr(kind: 'png' | 'svg') {
	const content = kind === 'png' ? qrDataUrl.value : URL.createObjectURL(new Blob([qrSvg.value], { type: 'image/svg+xml' }))
	if (!content) return
	const link = document.createElement('a')
	link.href = content
	link.download = `${props.gallery.slug || 'gallery'}-qr.${kind}`
	link.click()
	if (kind === 'svg') URL.revokeObjectURL(content)
}

async function sendInvite() {
	sending.value = true
	try {
		await sendInvitation(props.gallery.id, {
			recipient: recipient.value,
			message: invitationMessage.value,
		})
		recipient.value = ''
		invitationMessage.value = ''
		showSuccess(t('proofing_gallery', 'Invitation sent.'))
	} catch {
		showError(t('proofing_gallery', 'The invitation could not be sent.'))
	} finally {
		sending.value = false
	}
}

function absoluteShareUrl(token: string): string {
	return new URL(generateUrl(`/s/${token}`), window.location.origin).toString()
}

function updateOpen(open: boolean) {
	if (!open) emit('close')
}
</script>

<template>
	<NcDialog
		:open="show"
		:name="t('proofing_gallery', 'Share gallery')"
		size="normal"
		@update:open="updateOpen">
		<div class="sharing-dialog">
			<div class="sharing-dialog__title">
				<h2>{{ gallery.title }}</h2>
			</div>

			<section>
				<h3>{{ t('proofing_gallery', 'Public link') }}</h3>
				<p v-if="recoveryNotice" role="status">
					{{ recoveryNotice }}
				</p>
				<PublicShareRecoveryForm v-if="recoveryNeeded"
					:busy="publishing"
					@confirm="publish"
					@cancel="recoveryNeeded = false" />
				<div v-if="published" class="link-field">
					<input :value="publicUrl" readonly :aria-label="t('proofing_gallery', 'Public gallery link')">
					<NcButton @click="copyLink">
						{{ t('proofing_gallery', 'Copy') }}
					</NcButton>
				</div>
				<p v-else class="sharing-dialog__hint">
					{{ gallery.sourceType === 'collection'
						? t('proofing_gallery', 'Publishing creates a standard Nextcloud link protected by an empty collection anchor.')
						: t('proofing_gallery', 'Publishing creates a standard Nextcloud link share for the source folder.') }}
				</p>
				<div v-if="published && qrDataUrl" class="qr-share">
					<img :src="qrDataUrl"
						:alt="t('proofing_gallery', 'QR code for the public gallery link')">
					<div>
						<strong>{{ t('proofing_gallery', 'QR code') }}</strong>
						<p>{{ t('proofing_gallery', 'Generated locally in your browser. The gallery link is not sent to a third party.') }}</p>
						<span>
							<NcButton variant="tertiary" @click="downloadQr('png')">
								{{ t('proofing_gallery', 'Download PNG') }}
							</NcButton>
							<NcButton variant="tertiary" @click="downloadQr('svg')">
								{{ t('proofing_gallery', 'Download SVG') }}
							</NcButton>
						</span>
					</div>
				</div>
			</section>

			<section>
				<h3>{{ t('proofing_gallery', 'Protection and delivery') }}</h3>
				<div class="sharing-fields">
					<NcTextField
						id="proofing-gallery-share-password"
						v-model="password"
						name="password"
						type="password"
						autocomplete="new-password"
						:disabled="removePassword"
						:label="published
							? t('proofing_gallery', 'Set or replace password')
							: t('proofing_gallery', 'Password (optional)')" />
					<label class="date-field">
						<span>{{ t('proofing_gallery', 'Expires on (optional)') }}</span>
						<input id="proofing-gallery-share-expiry"
							v-model="expiresAt"
							name="expiresAt"
							type="date">
					</label>
				</div>
				<p v-if="published && !removePassword" class="sharing-dialog__hint">
					{{ t('proofing_gallery', 'Leave the password empty to keep the current protection.') }}
				</p>
				<NcCheckboxRadioSwitch v-if="published" v-model="removePassword" type="checkbox">
					{{ t('proofing_gallery', 'Remove the current password') }}
				</NcCheckboxRadioSwitch>
				<div class="delivery-summary">
					<strong>{{ t('proofing_gallery', 'Downloads') }}</strong>
					<span>{{ gallery.settings.delivery.downloadScope === 'none'
						? t('proofing_gallery', 'Disabled')
						: gallery.settings.delivery.downloadScope === 'individual'
							? t('proofing_gallery', 'Individual files')
							: gallery.settings.delivery.downloadScope === 'selection'
								? t('proofing_gallery', 'Saved selections')
								: t('proofing_gallery', 'Files and selections') }}</span>
					<small>{{ t('proofing_gallery', 'Change downloads in the Delivery workspace.') }}</small>
				</div>
				<p v-if="!published && gallery.sourceType === 'collection' && gallery.mediaSummary.total === 0" class="sharing-dialog__hint">
					{{ t('proofing_gallery', 'Add at least one available file before publishing this collection.') }}
				</p>
				<NcButton variant="primary" :disabled="publishDisabled" @click="publish()">
					{{ publishing
						? t('proofing_gallery', 'Updating…')
						: published
							? t('proofing_gallery', 'Update public link')
							: t('proofing_gallery', 'Publish gallery') }}
				</NcButton>
				<NcButton v-if="published" variant="tertiary" @click="revoke">
					{{ t('proofing_gallery', 'Revoke link') }}
				</NcButton>
			</section>
			<section v-if="published">
				<h3>{{ t('proofing_gallery', 'Email invitation') }}</h3>
				<div class="template-fields">
					<label>
						<span>{{ t('proofing_gallery', 'Message template') }}</span>
						<select v-model="selectedTemplateId" :disabled="templatesLoading" @change="selectTemplate">
							<option :value="null">{{ templatesLoading ? t('proofing_gallery', 'Loading…') : t('proofing_gallery', 'New template') }}</option>
							<option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
						</select>
					</label>
					<NcTextField
						id="proofing-gallery-template-name"
						v-model="templateName"
						:label="t('proofing_gallery', 'Template name')" />
				</div>
				<NcTextField
					id="proofing-gallery-recipient"
					v-model="recipient"
					name="recipient"
					type="email"
					autocomplete="email"
					:label="t('proofing_gallery', 'Recipient email')" />
				<NcTextArea
					id="proofing-gallery-invitation-message"
					v-model="invitationMessage"
					name="message"
					:label="t('proofing_gallery', 'Personal message (optional)')" />
				<p class="sharing-dialog__hint">
					{{ t('proofing_gallery', 'Available placeholders: {gallery}, {owner}, {url}. The applied message remains editable.') }}
				</p>
				<div class="template-actions">
					<NcButton :disabled="!templateName.trim() || !invitationMessage.trim() || templateSaving" @click="saveTemplate">
						{{ templateSaving ? t('proofing_gallery', 'Saving…') : selectedTemplateId === null ? t('proofing_gallery', 'Save as template') : t('proofing_gallery', 'Update template') }}
					</NcButton>
					<NcButton v-if="selectedTemplateId !== null" variant="tertiary" @click="removeTemplate">
						{{ t('proofing_gallery', 'Delete template') }}
					</NcButton>
				</div>
				<NcButton :disabled="!recipient || sending" @click="sendInvite">
					{{ sending ? t('proofing_gallery', 'Sending…') : t('proofing_gallery', 'Send invitation') }}
				</NcButton>
			</section>
		</div>
	</NcDialog>
</template>

<style scoped>
.sharing-dialog {
	padding: 30px;
}

.sharing-dialog__title {
	margin-bottom: 24px;
}

.sharing-dialog h2 {
	margin: 0;
	font-size: 20px;
	font-weight: 600;
}

.sharing-dialog section {
	display: grid;
	gap: 12px;
	padding: 20px 0;
	border-top: 1px solid var(--color-border);
}

.sharing-dialog h3 {
	margin: 0;
	font-size: 14px;
}

.sharing-dialog__hint {
	margin: 0;
	color: var(--color-text-maxcontrast);
	line-height: 1.5;
}

.link-field {
	display: flex;
	gap: 8px;
}

.link-field input {
	min-width: 0;
	flex: 1;
	padding: 9px 11px;
	border: 1px solid var(--color-border-maxcontrast);
	border-radius: 8px;
	background: var(--color-background-dark);
	color: var(--color-main-text);
}

.qr-share {
	display: grid;
	grid-template-columns: 116px 1fr;
	gap: 16px;
	align-items: center;
	padding: 12px;
	border: 1px solid var(--color-border);
	border-radius: 8px;
}

.qr-share img {
	display: block;
	width: 116px;
	height: 116px;
}

.qr-share p {
	margin: 4px 0 10px;
	color: var(--color-text-maxcontrast);
}

.qr-share span {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.sharing-fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

.template-fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

.template-fields label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.template-fields select {
	min-height: 44px;
	padding: 8px 10px;
	border: 1px solid var(--color-border-maxcontrast);
	border-radius: 8px;
	background: var(--color-main-background);
	color: var(--color-main-text);
}

.template-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.date-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	color: var(--color-text-maxcontrast);
	font-size: 13px;
}

.date-field input,
.date-field select {
	min-height: 44px;
	padding: 8px 10px;
	border: 1px solid var(--color-border-maxcontrast);
	border-radius: 8px;
	background: var(--color-main-background);
	color: var(--color-main-text);
}

.delivery-summary {
	display: grid;
	grid-template-columns: minmax(120px, auto) 1fr;
	gap: 3px 16px;
	padding: 12px 0;
	border-block: 1px solid var(--color-border);
}

.delivery-summary small {
	grid-column: 2;
	color: var(--color-text-maxcontrast);
}

@media (max-width: 600px) {
	.sharing-dialog {
		padding: 20px;
	}

	.sharing-fields {
		grid-template-columns: 1fr;
	}

	.template-fields {
		grid-template-columns: 1fr;
	}

	.qr-share {
		grid-template-columns: 84px 1fr;
	}

	.qr-share img {
		width: 84px;
		height: 84px;
	}
}
</style>
