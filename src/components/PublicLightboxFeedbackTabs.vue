<script setup lang="ts">
import { t } from '@nextcloud/l10n'

import type { CollaborationState } from '../publicTypes.ts'
import PublicLightboxPinThreads from './PublicLightboxPinThreads.vue'

type Comment = CollaborationState['comments'][number]

defineProps<{
	canAnnotate: boolean
	comments: CollaborationState['comments']
	annotationNumbers: Map<number, number[]>
	editingCommentId: number | null
	editingCommentBody: string
}>()
const emit = defineEmits<{
	'update:editing-comment-body': [value: string]
	'start-annotation': []
	'open-thread': [commentId: number]
	edit: [comment: Comment]
	save: [commentId: number]
	'cancel-edit': []
	delete: [commentId: number]
}>()
const selectedTab = defineModel<'comments' | 'pins'>({ required: true })
</script>

<template>
	<nav class="feedback-tabs" role="tablist" :aria-label="t('proofing_gallery', 'Feedback')">
		<button type="button"
			role="tab"
			:aria-selected="selectedTab === 'comments'"
			:class="{ 'feedback-tabs__tab--active': selectedTab === 'comments' }"
			@click="selectedTab = 'comments'">
			{{ t('proofing_gallery', 'General comments') }}
		</button>
		<button v-if="canAnnotate"
			type="button"
			role="tab"
			:aria-selected="selectedTab === 'pins'"
			:class="{ 'feedback-tabs__tab--active': selectedTab === 'pins' }"
			@click="selectedTab = 'pins'">
			{{ t('proofing_gallery', 'Pins') }}
		</button>
	</nav>
	<slot v-if="selectedTab === 'comments'" name="comments" />
	<div v-else-if="canAnnotate" class="pin-feedback">
		<button type="button" class="pin-feedback__add" @click="emit('start-annotation')">
			{{ t('proofing_gallery', 'Add point comment') }}
		</button>
		<small>{{ t('proofing_gallery', 'Click the image anywhere to add a point comment.') }}</small>
		<PublicLightboxPinThreads
			:comments="comments"
			:annotation-numbers="annotationNumbers"
			:editing-comment-id="editingCommentId"
			:editing-comment-body="editingCommentBody"
			@open="emit('open-thread', $event)"
			@edit="emit('edit', $event)"
			@save="emit('save', $event)"
			@update:editing-comment-body="emit('update:editing-comment-body', $event)"
			@cancel-edit="emit('cancel-edit')"
			@delete="emit('delete', $event)" />
	</div>
</template>

<style scoped>
.feedback-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 0 0 12px; padding: 3px; border-radius: 10px; background: var(--ion-color-light); }

.feedback-tabs button { min-height: 34px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--ion-color-medium); font: inherit; font-size: 12px; font-weight: 700; }

.feedback-tabs button:hover { color: var(--ion-text-color); }

.feedback-tabs button:focus-visible { outline: 2px solid var(--gallery-accent); outline-offset: -2px; }

.feedback-tabs button.feedback-tabs__tab--active { background: var(--ion-background-color); box-shadow: 0 1px 4px rgb(0 0 0 / 18%); color: var(--ion-text-color); }

.pin-feedback { display: grid; gap: 10px; }

.pin-feedback .pin-feedback__add { min-height: 42px; border: 0; border-radius: 10px; background: var(--gallery-accent); color: var(--proofing-public-accent-contrast, #000); font: inherit; font-weight: 700; }

.pin-feedback > small { margin-bottom: 4px; color: var(--ion-color-medium); line-height: 1.4; }
</style>
