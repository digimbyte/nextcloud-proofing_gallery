import { t } from '@nextcloud/l10n'

export type PublicShareRecovery = 'restored' | 'replaced' | null
export interface ShareRecoveryChoices { password: string; expiresAt: string; recoverMissingShare: true }

export function missingPublicShare(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('response' in error)) return false
	const response = (error as { response?: { status?: number; data?: { code?: string } } }).response
	return response?.status === 409 && response.data?.code === 'public_share_missing'
}

export function shareRecoveryMessage(recovery: PublicShareRecovery | undefined): string | null {
	if (recovery === 'restored') return t('proofing_gallery', 'The previous share was removed. Your gallery URL has been restored.')
	if (recovery === 'replaced') return t('proofing_gallery', 'The previous share was removed. A new gallery URL was created.')
	return null
}

export function publicShareError(error: unknown, fallback: string): string {
	if (typeof error !== 'object' || error === null || !('response' in error)) return fallback
	return (error as { response?: { data?: { message?: string } } }).response?.data?.message || fallback
}
