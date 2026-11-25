<script setup lang="ts">
/* eslint-disable vue/no-deprecated-slot-attribute -- Ionic Vue maps Web Component slots through the slot attribute. */
import { IonButton, IonButtons, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/vue'
import { t } from '@nextcloud/l10n'
import {
	addOutline,
	chatbubbleEllipsesOutline,
	closeOutline,
	downloadOutline,
	ellipsisHorizontal,
	heart,
	heartOutline,
	informationCircleOutline,
	removeOutline,
} from 'ionicons/icons'

defineProps<{
	name: string
	position: number
	count: number
	isImage: boolean
	liked: boolean
	commentCount: number
	canLike: boolean
	canFeedback: boolean
	canDownload: boolean
	hasMetadata: boolean
	downloadUrl: string
}>()

const emit = defineEmits<{
	close: []
	zoom: [direction: number]
	like: []
	feedback: []
	info: []
	more: []
}>()
</script>

<template>
	<IonHeader class="lightbox-bar" role="presentation">
		<IonToolbar>
			<IonButtons slot="start">
				<IonButton :aria-label="t('proofing_gallery', 'Close')" @click="emit('close')">
					<IonIcon slot="icon-only" :icon="closeOutline" aria-hidden="true" />
				</IonButton>
			</IonButtons>
			<IonTitle>
				<span v-if="name" class="lightbox-bar__title">{{ name }}</span>
				<small>{{ position }} / {{ count }}</small>
			</IonTitle>
			<IonButtons slot="end">
				<IonButton v-if="isImage"
					class="lightbox-bar__desktop-action"
					:aria-label="t('proofing_gallery', 'Zoom out')"
					@click="emit('zoom', -1)">
					<IonIcon slot="icon-only" :icon="removeOutline" aria-hidden="true" />
				</IonButton>
				<IonButton v-if="isImage"
					class="lightbox-bar__desktop-action"
					:aria-label="t('proofing_gallery', 'Zoom in')"
					@click="emit('zoom', 1)">
					<IonIcon slot="icon-only" :icon="addOutline" aria-hidden="true" />
				</IonButton>
				<IonButton v-if="canLike" :aria-label="t('proofing_gallery', 'Like')" @click="emit('like')">
					<IonIcon slot="icon-only" :icon="liked ? heart : heartOutline" aria-hidden="true" />
				</IonButton>
				<IonButton v-if="canFeedback"
					:aria-label="commentCount ? t('proofing_gallery', 'Feedback, {count}', { count: commentCount }) : t('proofing_gallery', 'Feedback')"
					@click="emit('feedback')">
					<IonIcon slot="icon-only" :icon="chatbubbleEllipsesOutline" aria-hidden="true" />
					<span v-if="commentCount" class="lightbox-bar__count">{{ commentCount }}</span>
				</IonButton>
				<IonButton v-if="hasMetadata" :aria-label="t('proofing_gallery', 'Info')" @click="emit('info')">
					<IonIcon slot="icon-only" :icon="informationCircleOutline" aria-hidden="true" />
				</IonButton>
				<IonButton v-if="canDownload"
					class="lightbox-bar__desktop-action"
					:href="downloadUrl"
					:aria-label="t('proofing_gallery', 'Download')">
					<IonIcon slot="icon-only" :icon="downloadOutline" aria-hidden="true" />
				</IonButton>
				<IonButton :aria-label="t('proofing_gallery', 'More options')" @click="emit('more')">
					<IonIcon slot="icon-only" :icon="ellipsisHorizontal" aria-hidden="true" />
				</IonButton>
			</IonButtons>
		</IonToolbar>
	</IonHeader>
</template>

<style scoped>
.lightbox-bar {
	position: absolute;
	z-index: 8;
	inset: 0 0 auto;
	pointer-events: auto;
	--ion-toolbar-background: rgb(20 20 22 / 94%);
	--ion-toolbar-color: #fff;
	--ion-text-color: #fff;
	--border-color: rgb(255 255 255 / 10%);
}

ion-toolbar { --min-height: 58px; --padding-start: max(4px, env(safe-area-inset-left)); --padding-end: max(4px, env(safe-area-inset-right)); }

ion-button { --color: #fff; --border-radius: 999px; width: 44px; height: 44px; margin: 0 1px; }

ion-title { padding-inline: 8px; text-align: start; }

ion-title small { display: block; margin-top: 1px; color: rgb(255 255 255 / 56%); font-size: 11px; font-weight: 500; line-height: 1.2; }

.lightbox-bar__title { display: block; overflow: hidden; font-size: 14px; font-weight: 620; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }

.lightbox-bar__count { position: absolute; inset: 1px 0 auto auto; display: grid; min-width: 17px; height: 17px; place-items: center; padding-inline: 4px; border: 2px solid #141416; border-radius: 9px; background: var(--gallery-accent); color: var(--proofing-public-accent-contrast, #000); font-size: 9px; font-weight: 700; }

@media (max-width: 760px) {
	ion-toolbar { --min-height: calc(54px + env(safe-area-inset-top)); --padding-top: env(safe-area-inset-top); }
	.lightbox-bar__desktop-action { display: none; }
	ion-title { max-width: none; }
}

@media (max-width: 430px) {
	ion-title { padding-inline: 2px; }
	.lightbox-bar__title { max-width: 24vw; }
}
</style>
