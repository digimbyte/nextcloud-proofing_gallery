<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { computed, ref } from 'vue'
import type { ShareRecoveryChoices } from '../domain/publicShareRecovery.ts'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ confirm: [choices: ShareRecoveryChoices]; cancel: [] }>()
const password = ref('')
const expiresAt = ref('')
const noPassword = ref(false)
const noExpiry = ref(false)
const ready = computed(() => (noPassword.value || password.value.length > 0) && (noExpiry.value || expiresAt.value.length > 0))

function confirm() {
	if (ready.value) emit('confirm', { password: noPassword.value ? '' : password.value, expiresAt: noExpiry.value ? '' : expiresAt.value, recoverMissingShare: true })
}
</script>

<template>
	<section class="share-recovery" aria-live="polite">
		<strong>{{ t('proofing_gallery', 'Recover gallery link') }}</strong>
		<p>{{ t('proofing_gallery', 'The previous share was removed outside Proofing Gallery. Its password and expiry cannot be recovered. Choose new protection below. The previous URL will be restored when allowed; otherwise a new URL will be created.') }}</p>
		<label><span>{{ t('proofing_gallery', 'Replacement password') }}</span><input v-model="password"
			type="password"
			autocomplete="new-password"
			:disabled="busy || noPassword"></label>
		<NcCheckboxRadioSwitch v-model="noPassword" type="checkbox" :disabled="busy">
			{{ t('proofing_gallery', 'Recover without a password') }}
		</NcCheckboxRadioSwitch>
		<label><span>{{ t('proofing_gallery', 'Replacement expiry') }}</span><input v-model="expiresAt" type="date" :disabled="busy || noExpiry"></label>
		<NcCheckboxRadioSwitch v-model="noExpiry" type="checkbox" :disabled="busy">
			{{ t('proofing_gallery', 'Recover without an expiry') }}
		</NcCheckboxRadioSwitch>
		<div>
			<NcButton variant="primary" :disabled="busy || !ready" @click="confirm">
				{{ t('proofing_gallery', 'Recover link') }}
			</NcButton>
			<NcButton variant="tertiary" :disabled="busy" @click="emit('cancel')">
				{{ t('proofing_gallery', 'Cancel') }}
			</NcButton>
		</div>
	</section>
</template>

<style scoped>
.share-recovery { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--color-border); border-radius: var(--border-radius-large); background: var(--color-main-background); color: var(--color-main-text); }

.share-recovery label { display: grid; gap: 4px; }

.share-recovery input { width: 100%; }

.share-recovery > div { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
