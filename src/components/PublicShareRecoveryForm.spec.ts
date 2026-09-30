import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PublicShareRecoveryForm from './PublicShareRecoveryForm.vue'

vi.mock('@nextcloud/vue/components/NcButton', () => ({ default: { name: 'NcButton', props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' } }))
vi.mock('@nextcloud/vue/components/NcCheckboxRadioSwitch', () => ({ default: { name: 'NcCheckboxRadioSwitch', props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<label><input type="checkbox" :disabled="disabled" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)"><slot /></label>' } }))

function form() {
	return mount(PublicShareRecoveryForm, {
		props: { busy: false },
		global: { stubs: {
			NcButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
			NcCheckboxRadioSwitch: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<label><input type="checkbox" :disabled="disabled" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)"><slot /></label>' },
		} },
	})
}

describe('guided public share recovery', () => {
	it('requires explicit password and expiry choices and submits them', async () => {
		const wrapper = form()
		const recover = wrapper.findAll('button')[0]
		expect(recover.attributes('disabled')).toBeDefined()
		await wrapper.get('input[type="password"]').setValue('new secret')
		expect(recover.attributes('disabled')).toBeDefined()
		await wrapper.get('input[type="date"]').setValue('2027-01-01')
		await recover.trigger('click')
		expect(wrapper.emitted('confirm')).toEqual([[{ password: 'new secret', expiresAt: '2027-01-01', recoverMissingShare: true }]])
	})

	it('sends empty strings only when no protection is explicitly selected', async () => {
		const wrapper = form()
		for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(true)
		await wrapper.findAll('button')[0].trigger('click')
		expect(wrapper.emitted('confirm')).toEqual([[{ password: '', expiresAt: '', recoverMissingShare: true }]])
	})

	it('cancellation does not confirm recovery', async () => {
		const wrapper = form()
		await wrapper.findAll('button')[1].trigger('click')
		expect(wrapper.emitted('cancel')).toHaveLength(1)
		expect(wrapper.emitted('confirm')).toBeUndefined()
	})
})
