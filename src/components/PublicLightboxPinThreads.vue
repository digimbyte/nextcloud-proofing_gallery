<script setup lang="ts">
import { n, t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import ChevronDownIcon from 'vue-material-design-icons/ChevronDown.vue'
import ChevronRightIcon from 'vue-material-design-icons/ChevronRight.vue'

import { annotationThreadKey } from '../domain/lightboxReview.ts'
import type { CollaborationState } from '../publicTypes.ts'
import PublicLightboxComments from './PublicLightboxComments.vue'

type Comment = CollaborationState['comments'][number]

const props = defineProps<{
	comments: CollaborationState['comments']
	annotationNumbers: Map<number, number[]>
	editingCommentId: number | null
	editingCommentBody: string
}>()
const emit = defineEmits<{
	'update:editing-comment-body': [value: string]
	open: [commentId: number]
	edit: [comment: Comment]
	save: [commentId: number]
	'cancel-edit': []
	delete: [commentId: number]
}>()

const expandedKeys = ref<string[]>([])
const threads = computed(() => {
	const grouped = new Map<string, { key: string; number: number; root: Comment; comments: Comment[] }>()
	for (const comment of [...props.comments].sort((left, right) => left.createdAt - right.createdAt || left.id - right.id)) {
		const annotation = comment.annotations[0]
		if (!annotation) continue
		const key = annotationThreadKey(comment)
		const existing = grouped.get(key)
		if (existing) {
			existing.comments.push(comment)
			continue
		}
		grouped.set(key, {
			key,
			number: props.annotationNumbers.get(comment.id)?.[0] ?? grouped.size + 1,
			root: comment,
			comments: [comment],
		})
	}
	return [...grouped.values()]
})

function isExpanded(key: string): boolean {
	return expandedKeys.value.includes(key)
}

function toggle(key: string): void {
	expandedKeys.value = isExpanded(key)
		? expandedKeys.value.filter(candidate => candidate !== key)
		: [...expandedKeys.value, key]
}
</script>

<template>
	<div v-if="threads.length" class="pin-thread-list">
		<section v-for="thread in threads" :key="thread.key" class="pin-thread">
			<header>
				<button type="button"
					class="pin-thread__toggle"
					:aria-expanded="isExpanded(thread.key)"
					:aria-controls="`pin-thread-${thread.root.id}`"
					@click="toggle(thread.key)">
					<ChevronDownIcon v-if="isExpanded(thread.key)" :size="18" aria-hidden="true" />
					<ChevronRightIcon v-else :size="18" aria-hidden="true" />
					<span class="pin-thread__number">{{ thread.number }}</span>
					<strong>{{ t('proofing_gallery', 'Point comment {number}', { number: thread.number }) }}</strong>
					<small>{{ n('proofing_gallery', '%n comment', '%n comments', thread.comments.length) }}</small>
				</button>
				<button type="button"
					class="pin-thread__open"
					:aria-label="t('proofing_gallery', 'Open point comment {number}', { number: thread.number })"
					:title="t('proofing_gallery', 'Open point comment {number}', { number: thread.number })"
					@click="emit('open', thread.root.id)">
					<ChevronRightIcon :size="20" aria-hidden="true" />
				</button>
			</header>
			<div v-if="isExpanded(thread.key)" :id="`pin-thread-${thread.root.id}`" class="pin-thread__comments">
				<PublicLightboxComments
					:comments="thread.comments"
					:annotation-numbers="annotationNumbers"
					:selected-comment-id="thread.root.id"
					:editing-comment-id="editingCommentId"
					:editing-comment-body="editingCommentBody"
					@edit="emit('edit', $event)"
					@save="emit('save', $event)"
					@update:editing-comment-body="emit('update:editing-comment-body', $event)"
					@cancel-edit="emit('cancel-edit')"
					@delete="emit('delete', $event)" />
			</div>
		</section>
	</div>
	<p v-else class="pin-thread-list__empty">
		{{ t('proofing_gallery', 'No point comments yet.') }}
	</p>
</template>

<style scoped>
.pin-thread-list { display: grid; gap: 9px; }

.pin-thread { overflow: hidden; border: 1px solid var(--ion-border-color); border-radius: 12px; background: var(--ion-color-light); }

.pin-thread > header { display: flex; min-width: 0; align-items: stretch; }

.pin-thread button { border: 0; background: transparent; color: var(--ion-text-color); font: inherit; }

.pin-thread__toggle { display: grid; min-width: 0; min-height: 52px; flex: 1 1 auto; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 10px; text-align: start; }

.pin-thread__toggle strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }

.pin-thread__toggle small { color: var(--ion-color-medium); font-size: 11px; white-space: nowrap; }

.pin-thread__number { display: grid; width: 26px; height: 26px; border: 2px solid #fff; border-radius: 50%; background: var(--gallery-accent); box-shadow: 0 0 0 1px #0b0b0c; color: var(--proofing-public-accent-contrast, #000); font-size: 11px; font-weight: 800; place-items: center; }

.pin-thread > header > .pin-thread__open { display: grid; width: 46px; flex: 0 0 46px; border-inline-start: 1px solid var(--ion-border-color); place-items: center; }

.pin-thread__toggle:hover, .pin-thread__open:hover { background: color-mix(in srgb, var(--gallery-accent) 8%, transparent); }

.pin-thread button:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--gallery-accent); outline-offset: -3px; }

.pin-thread__comments { padding: 0 10px 10px; border-block-start: 1px solid var(--ion-border-color); }

.pin-thread-list__empty { margin: 12px 0 0; color: var(--ion-color-medium); font-size: 13px; text-align: center; }

@media (max-width: 520px) {
	.pin-thread__toggle { grid-template-columns: auto auto minmax(0, 1fr); }
	.pin-thread__toggle small { display: none; }
}
</style>
