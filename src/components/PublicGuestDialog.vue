<script setup lang="ts">
/* eslint-disable vue/no-deprecated-slot-attribute -- Ionic Vue maps Web Component slots through the slot attribute. */
import { t } from '@nextcloud/l10n'
import { closeOutline } from 'ionicons/icons'

import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar } from '@ionic/vue'
import { ref } from 'vue'

const props = defineProps<{ open: boolean; joining: boolean; viewer?: { displayName: string; email: string | null } | null }>()
const name = ref(props.viewer?.displayName ?? '')
const email = ref(props.viewer?.email ?? '')
defineEmits<{ dismiss: []; submit: [identity: { displayName: string; email: string }] }>()
</script>

<template>
	<IonModal :is-open="open" class="proofing-public-overlay guest-dialog" @did-dismiss="$emit('dismiss')">
		<IonHeader>
			<IonToolbar>
				<IonTitle>{{ t('proofing_gallery', 'Who is giving feedback?') }}</IonTitle>
				<IonButtons slot="end">
					<IonButton :aria-label="t('proofing_gallery', 'Close')" @click="$emit('dismiss')">
						<IonIcon slot="icon-only" :icon="closeOutline" />
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonHeader>
		<IonContent>
			<form class="guest-dialog__form" @submit.prevent="$emit('submit', { displayName: name, email })">
				<p>{{ t('proofing_gallery', 'Your name keeps comments and selections clear for everyone.') }}</p>
				<div class="guest-dialog__fields">
					<label for="proofing-gallery-guest-name"><span>{{ t('proofing_gallery', 'Your name') }}</span><input id="proofing-gallery-guest-name"
						v-model="name"
						name="displayName"
						autocomplete="name"
						required
						maxlength="120"></label>
					<label for="proofing-gallery-guest-email"><span>{{ t('proofing_gallery', 'Email (optional)') }}</span><input id="proofing-gallery-guest-email"
						v-model="email"
						name="email"
						autocomplete="email"
						type="email"></label>
				</div>
				<button class="guest-dialog__submit" type="submit" :disabled="joining">
					<span>{{ joining ? t('proofing_gallery', 'Saving…') : t('proofing_gallery', 'Continue') }}</span>
				</button>
			</form>
		</IonContent>
	</IonModal>
</template>

<style scoped>
.guest-dialog { z-index: 100300 !important; --background: var(--gallery-surface); --border-radius: 16px; --height: min(420px, calc(100dvh - 24px)); --max-width: 480px; --width: calc(100% - 32px); }

:global(ion-modal.guest-dialog::part(content)) { box-shadow: 0 28px 80px rgb(0 0 0 / 56%); }

:global(ion-modal.guest-dialog .ion-page) { height: 100%; }

.guest-dialog ion-toolbar { --background: var(--gallery-surface); --border-color: var(--gallery-border); --color: var(--gallery-text); }

.guest-dialog ion-content { --background: var(--gallery-surface); --overflow: auto; }

.guest-dialog__form { display: grid; gap: 20px; padding: 22px; color: var(--gallery-text); }

.guest-dialog__form > p { margin: 0; color: var(--gallery-muted); line-height: 1.5; }

.guest-dialog__fields { display: grid; gap: 14px; }

.guest-dialog__fields label { display: grid; gap: 7px; color: var(--gallery-text); font-size: 13px; font-weight: 700; }

.guest-dialog__fields input { box-sizing: border-box; width: 100%; min-height: 48px; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--gallery-text) 24%, var(--gallery-border)); border-radius: 11px; outline: none; background: color-mix(in srgb, var(--gallery-surface) 82%, black); color: var(--gallery-text); font: inherit; font-size: 15px; transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease; }

.guest-dialog__fields input:hover { border-color: color-mix(in srgb, var(--gallery-text) 38%, var(--gallery-border)); }

.guest-dialog__fields input:focus { border-color: var(--gallery-accent); background: var(--gallery-surface); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gallery-accent) 28%, transparent); }

.guest-dialog button.guest-dialog__submit { display: grid; box-sizing: border-box; width: 100%; min-height: 48px; place-items: center; padding: 0 18px; border: 1px solid color-mix(in srgb, var(--gallery-accent) 74%, white); border-radius: 11px; background: var(--gallery-accent); box-shadow: 0 8px 22px color-mix(in srgb, var(--gallery-accent) 28%, transparent); color: var(--proofing-public-accent-contrast, #000); font: inherit; font-size: 15px; font-weight: 750; line-height: 1; cursor: pointer; transition: filter 120ms ease, transform 120ms ease, box-shadow 120ms ease; }

.guest-dialog__submit:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 10px 26px color-mix(in srgb, var(--gallery-accent) 36%, transparent); transform: translateY(-1px); }

.guest-dialog__submit:focus-visible { outline: 3px solid color-mix(in srgb, var(--gallery-accent) 40%, white); outline-offset: 3px; }

.guest-dialog__submit:disabled { cursor: wait; opacity: .62; }

@media (max-width: 520px) { .guest-dialog { --height: min(408px, calc(100dvh - 20px)); --width: calc(100% - 20px); }.guest-dialog__form { gap: 18px; padding: 18px; } }

@media (max-height: 440px) { .guest-dialog__form { gap: 14px; padding-block: 16px; }.guest-dialog__fields { gap: 10px; } }
</style>
