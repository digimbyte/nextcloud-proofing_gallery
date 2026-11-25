import { describe, expect, it } from 'vitest'
import { calculateMediaGridLayout, calculateMediaLayout } from './mediaGridLayout.ts'

describe('calculateMediaGridLayout', () => {
	it('uses one deterministic geometry for rows and total height', () => {
		const layout = calculateMediaGridLayout({ containerWidth: 1000, itemCount: 10, minItemWidth: 210, gap: 12, itemAspectRatio: 4 / 3 })
		expect(layout.columns).toBe(4)
		expect(layout.rows).toBe(3)
		expect(layout.totalHeight).toBeCloseTo(layout.rows * (layout.rowHeight + 12) - 12)
	})

	it('keeps every mobile item in a one-column document flow', () => {
		const layout = calculateMediaGridLayout({ containerWidth: 378, itemCount: 87, minItemWidth: 230, gap: 6, itemAspectRatio: 4 / 3 })

		expect(layout.columns).toBe(1)
		expect(layout.rows).toBe(87)
		expect(layout.totalHeight).toBeCloseTo(layout.rows * (layout.rowHeight + 6) - 6)
	})
})

describe('calculateMediaLayout', () => {
	it('builds filled justified rows without stretching the final row', () => {
		const layout = calculateMediaLayout({
			containerWidth: 1000,
			aspectRatios: [1.5, 1.5, 1.5, 1.5, 2 / 3],
			mode: 'grid',
			gap: 10,
			minItemWidth: 230,
			targetRowHeight: 210,
			listRowHeight: 172,
		})
		const firstRow = layout.positions.filter(position => position.y === 0)
		const firstRowWidth = firstRow.reduce((sum, position) => sum + position.width, 0) + (firstRow.length - 1) * 10
		expect(firstRowWidth).toBeCloseTo(1000)
		const last = layout.positions.at(-1)!
		expect(last.height).toBe(210)
		expect(last.width).toBeCloseTo(140)
		expect(last.width).toBeLessThan(1000)
	})

	it('preserves the target height for a portrait after a short landscape row on mobile', () => {
		const layout = calculateMediaLayout({
			containerWidth: 374,
			aspectRatios: [2.1, 2.5, 0.5],
			mode: 'grid',
			gap: 2,
			minItemWidth: 156,
			targetRowHeight: 174,
			listRowHeight: 132,
		})
		expect(layout.positions[0].height).toBeLessThan(90)
		expect(layout.positions.at(-1)).toMatchObject({ width: 87, height: 174 })
	})

	it.each([390, 1000, 1580])('keeps equal-ratio tiles the same size at width %i', containerWidth => {
		const layout = calculateMediaLayout({
			containerWidth,
			aspectRatios: Array.from({ length: 26 }, () => 1),
			mode: 'grid',
			gap: 5,
			minItemWidth: 230,
			targetRowHeight: 230,
			listRowHeight: 172,
		})
		const first = layout.positions[0]
		for (const tile of layout.positions) {
			expect(tile.width).toBeCloseTo(first.width)
			expect(tile.height).toBeCloseTo(first.height)
			expect(tile.x + tile.width).toBeLessThanOrEqual(containerWidth + 0.001)
		}
		expect(layout.positions.at(-1)!.y + first.height).toBeCloseTo(layout.totalHeight)
	})

	it('keeps a single incomplete row at the target height', () => {
		const layout = calculateMediaLayout({
			containerWidth: 1000,
			aspectRatios: [1, 1],
			mode: 'grid',
			gap: 5,
			minItemWidth: 230,
			targetRowHeight: 230,
			listRowHeight: 172,
		})
		expect(layout.positions.map(tile => [tile.x, tile.width, tile.height])).toEqual([[0, 230, 230], [235, 230, 230]])
		expect(layout.totalHeight).toBe(230)
	})

	it('still fills a complete final row with different image ratios', () => {
		const layout = calculateMediaLayout({
			containerWidth: 1000,
			aspectRatios: [2, 2, 2, 1, 1, 1, 1, 1],
			mode: 'grid',
			gap: 5,
			minItemWidth: 230,
			targetRowHeight: 230,
			listRowHeight: 172,
		})
		const last = layout.positions.at(-1)!
		expect(last.x + last.width).toBeCloseTo(1000)
		expect(last.height).toBeGreaterThan(layout.positions[0].height)
	})

	it('preserves portrait and landscape ratios in a mobile column', () => {
		const layout = calculateMediaLayout({
			containerWidth: 390,
			aspectRatios: [2 / 3, 3 / 2],
			mode: 'grid',
			gap: 6,
			minItemWidth: 230,
			targetRowHeight: 210,
			listRowHeight: 132,
			singleColumn: true,
		})
		expect(layout.positions[0].height).toBeCloseTo(585)
		expect(layout.positions[1].height).toBeCloseTo(260)
		expect(layout.totalHeight).toBeCloseTo(851)
	})
})
