import { describe, expect, it } from 'vitest'
import { missingPublicShare, shareRecoveryMessage } from './publicShareRecovery.ts'

describe('share recovery responses', () => {
	it('offers recovery only for a missing native share', () => {
		expect(missingPublicShare({ response: { status: 409, data: { code: 'public_share_missing' } } })).toBe(true)
		for (const code of ['revision_conflict', 'public_publishing_disabled', 'gallery_not_ready']) {
			expect(missingPublicShare({ response: { status: 409, data: { code } } })).toBe(false)
		}
		expect(missingPublicShare(new Error('network'))).toBe(false)
	})
	it('clearly distinguishes a restored URL from a new URL', () => {
		expect(shareRecoveryMessage('restored')).toContain('Your gallery URL has been restored.')
		expect(shareRecoveryMessage('replaced')).toContain('A new gallery URL was created.')
		expect(shareRecoveryMessage(null)).toBeNull()
	})
})
