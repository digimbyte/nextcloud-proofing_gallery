<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { computed, nextTick, ref, watch } from 'vue'

import { ANNOTATION_COORDINATE_SCALE } from '../domain/collaboration.ts'
import type { NormalizedAnnotation } from '../domain/collaboration.ts'
import { annotationThreadKey } from '../domain/lightboxReview.ts'
import type { ScreenPoint } from '../domain/lightboxReview.ts'
import type { CollaborationState } from '../publicTypes.ts'

const props = defineProps<{
	host: HTMLElement | null
	comments: CollaborationState['comments']
	draft: NormalizedAnnotation | null
	body: string
	anchor: ScreenPoint | null
	composerOpen: boolean
	focusBlocked?: boolean
	keyboardPositioning: boolean
	submitting: boolean
	error: string
	selectedCommentId: number | null
	viewportWidth: number
	viewportHeight: number
}>()
const emit = defineEmits<{
	'update:body': [value: string]
	submit: []
	cancel: []
	select: [commentId: number]
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const composer = ref<HTMLFormElement | null>(null)
const composerSize = ref({ width: 340, height: 260 })
const markers = computed(() => {
	const result: Array<{
		comment: CollaborationState['comments'][number]
		annotation: NormalizedAnnotation
		number: number
		threadKey: string
	}> = []
	const seen = new Set<string>()
	for (const comment of [...props.comments].sort((left, right) => left.createdAt - right.createdAt || left.id - right.id)) {
		for (const annotation of comment.annotations) {
			const threadKey = annotationThreadKey(comment)
			if (seen.has(threadKey)) continue
			seen.add(threadKey)
			result.push({ comment, annotation, number: result.length + 1, threadKey })
		}
	}
	return result
})
const selectedThreadKey = computed(() => {
	const comment = props.comments.find(candidate => candidate.id === props.selectedCommentId)
	return comment?.annotations[0] ? annotationThreadKey(comment) : null
})
function markerStyle(annotation: NormalizedAnnotation) {
	const percent = (value: number) => `${(value / ANNOTATION_COORDINATE_SCALE * 100).toFixed(2)}%`
	return { left: percent(annotation.x), top: percent(annotation.y) }
}
const composerStyle = computed(() => {
	if (!props.anchor || props.viewportWidth <= 520) return undefined
	const margin = 16
	const gap = 18
	const width = Math.min(340, props.viewportWidth - margin * 2)
	const topEdge = 72
	const bottomReserve = props.viewportWidth <= 760 ? 100 : margin
	const rightReserve = props.viewportWidth > 760 ? 108 : margin
	const rightEdge = Math.max(margin + width, props.viewportWidth - rightReserve)
	const availableHeight = Math.max(160, props.viewportHeight - topEdge - bottomReserve)
	const height = Math.min(composerSize.value.height, availableHeight)
	const rightRoom = rightEdge - props.anchor.x - gap
	const leftRoom = props.anchor.x - margin - gap
	const opensRight = rightRoom >= width || (rightRoom >= leftRoom && rightRoom > 0)
	const desiredLeft = opensRight ? props.anchor.x + gap : props.anchor.x - gap - width
	const left = Math.max(margin, Math.min(rightEdge - width, desiredLeft))
	const maxTop = Math.max(topEdge, props.viewportHeight - bottomReserve - height)
	const top = Math.max(topEdge, Math.min(maxTop, props.anchor.y - height / 2))
	return {
		left: `${Math.round(left)}px`,
		top: `${Math.round(top)}px`,
		width: `${Math.round(width)}px`,
		maxHeight: `${Math.round(availableHeight)}px`,
	}
})

watch([
	() => props.composerOpen,
	() => props.anchor,
	() => props.viewportWidth,
	() => props.viewportHeight,
	() => props.error,
], ([value]) => {
	if (value) {
		nextTick(() => {
			requestAnimationFrame(() => {
				if (composer.value) composerSize.value = { width: composer.value.offsetWidth, height: composer.value.offsetHeight }
			})
		})
	}
})

watch([() => props.composerOpen, () => !props.focusBlocked], async ([open, ready]) => {
	if (!open || !ready) return
	await nextTick()
	if (props.composerOpen && !props.focusBlocked) textarea.value?.focus()
}, { flush: 'post', immediate: true })

function onComposerKeydown(event: KeyboardEvent) {
	event.stopPropagation()
	if (event.key !== 'Escape') return
	event.preventDefault()
	emit('cancel')
}

</script>

<template>
	<Teleport v-if="host" :to="host">
		<button v-for="marker in markers"
			:key="marker.threadKey"
			type="button"
			class="annotation-marker"
			:class="{ 'annotation-marker--selected': selectedThreadKey === marker.threadKey }"
			:style="markerStyle(marker.annotation)"
			:aria-label="t('proofing_gallery', 'Open point comment {number}', { number: marker.number })"
			@pointerdown.stop
			@click.stop="emit('select', marker.comment.id)">
			{{ marker.number }}
		</button>
		<i v-if="draft"
			class="annotation-marker annotation-marker--draft"
			:style="markerStyle(draft)"
			aria-hidden="true">
			{{ markers.length + 1 }}
		</i>
	</Teleport>

	<p v-if="draft && keyboardPositioning && !composerOpen" class="annotation-positioning" role="status">
		{{ t('proofing_gallery', 'Move the point with the arrow keys, then press Enter to comment.') }}
	</p>
	<form v-if="draft && composerOpen"
		ref="composer"
		class="annotation-composer"
		:style="composerStyle"
		@submit.prevent="emit('submit')"
		@keydown="onComposerKeydown">
		<header class="annotation-composer__header">
			<b>{{ markers.length + 1 }}</b>
			<strong>{{ t('proofing_gallery', 'Point comment {number}', { number: markers.length + 1 }) }}</strong>
		</header>
		<textarea ref="textarea"
			:value="body"
			required
			maxlength="5000"
			:placeholder="t('proofing_gallery', 'Describe what should change here…')"
			:aria-label="t('proofing_gallery', 'Point comment')"
			@input="emit('update:body', ($event.target as HTMLTextAreaElement).value)" />
		<p v-if="error" class="annotation-composer__error" role="alert">
			{{ error }}
		</p>
		<div>
			<button type="submit" :disabled="submitting || !body.trim()">
				{{ submitting ? t('proofing_gallery', 'Saving…') : t('proofing_gallery', 'Comment') }}
			</button>
			<button type="button" :disabled="submitting" @click="emit('cancel')">
				{{ t('proofing_gallery', 'Cancel') }}
			</button>
		</div>
	</form>
</template>

<style scoped>
.annotation-marker { position: absolute; z-index: 2; display: grid; box-sizing: border-box; width: 28px; min-width: 28px; max-width: 28px; height: 28px; min-height: 28px; max-height: 28px; aspect-ratio: 1; margin: 0 !important; padding: 0; border: 2px dashed #fff; border-radius: 50%; background: #18212b; box-shadow: 0 2px 6px rgb(0 0 0 / 42%); color: #fff; font-size: 11px; font-style: normal; font-weight: 750; line-height: 1; place-items: center; pointer-events: auto; transform: scale(var(--annotation-marker-scale, 1)) translate(-50%, -50%); transform-origin: 0 0; transition: background-color 120ms ease, box-shadow 120ms ease, filter 120ms ease; }

.annotation-marker:hover { filter: brightness(1.08); }

.annotation-marker:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }

.annotation-marker--selected, .annotation-marker--draft { border-style: solid; background: var(--gallery-accent); box-shadow: 0 0 0 2px #0b0b0c, 0 2px 6px rgb(0 0 0 / 42%); color: var(--proofing-public-accent-contrast, #000); }

.annotation-marker--draft { pointer-events: none; }

.annotation-positioning { position: fixed; z-index: 100120; inset: auto 50% 24px auto; margin: 0; padding: 10px 16px; border-radius: 999px; background: rgb(24 24 27 / 96%); box-shadow: 0 8px 28px rgb(0 0 0 / 35%); color: #fff; font-size: 13px; pointer-events: none; transform: translateX(50%); }

.annotation-composer { position: fixed; z-index: 100120; display: grid; box-sizing: border-box; width: min(340px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; gap: 14px; padding: 18px; border: 1px solid rgb(255 255 255 / 18%); border-radius: 16px; background: rgb(22 22 25 / 94%); box-shadow: 0 24px 64px rgb(0 0 0 / 58%), 0 1px 0 rgb(255 255 255 / 8%) inset; color: #fff; backdrop-filter: blur(18px); overscroll-behavior: contain; pointer-events: auto; }

.annotation-composer__header { display: flex; align-items: center; gap: 10px; }

.annotation-composer__header b { display: grid; width: 32px; height: 32px; flex: 0 0 32px; border: 2px solid rgb(255 255 255 / 90%); border-radius: 50%; background: var(--gallery-accent); box-shadow: 0 0 0 2px rgb(255 255 255 / 12%); color: var(--proofing-public-accent-contrast, #000); font-size: 12px; place-items: center; }

.annotation-composer__header strong { font-size: 14px; letter-spacing: .01em; }

.annotation-composer textarea { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; min-height: 96px; padding: 13px 14px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 12px; outline: none; background: rgb(255 255 255 / 98%); box-shadow: 0 1px 0 rgb(255 255 255 / 12%) inset; color: #111; font: inherit; line-height: 1.45; resize: none; }

.annotation-composer textarea:focus { border-color: color-mix(in srgb, var(--gallery-accent) 70%, white); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gallery-accent) 32%, transparent); }

.annotation-composer > div { display: flex; justify-content: flex-end; gap: 10px; }

.annotation-composer button { min-height: 42px; padding: 0 17px; border: 1px solid transparent; border-radius: 10px; background: var(--gallery-accent); color: var(--proofing-public-accent-contrast, #000); font: inherit; font-size: 13px; font-weight: 700; }

.annotation-composer button:last-child { border-color: rgb(255 255 255 / 18%); background: rgb(255 255 255 / 8%); color: #fff; }

.annotation-composer button:disabled { cursor: not-allowed; opacity: .55; }

.annotation-composer__error { margin: 0; color: #ffb4ab; font-size: 13px; }

@media (max-width: 520px) { .annotation-composer { inset: auto 12px calc(98px + env(safe-area-inset-bottom)); width: auto; padding: 16px; transform: none; }.annotation-composer > div { display: grid; grid-template-columns: 1fr 1fr; }.annotation-composer button { width: 100%; } }
</style>
