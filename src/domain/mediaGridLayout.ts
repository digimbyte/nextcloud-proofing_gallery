export interface MediaGridLayoutInput {
	containerWidth: number
	itemCount: number
	minItemWidth: number
	gap: number
	itemAspectRatio: number
	itemExtraHeight?: number
	maxItemWidth?: number
	maxColumns?: number
	list?: boolean
}

export type MediaLayoutMode = 'grid' | 'masonry' | 'list'

export interface MediaLayoutPosition {
	index: number
	x: number
	y: number
	width: number
	height: number
}

export interface MediaLayoutInput {
	containerWidth: number
	aspectRatios: number[]
	mode: MediaLayoutMode
	gap: number
	minItemWidth: number
	targetRowHeight: number
	listRowHeight: number
	singleColumn?: boolean
}

export function calculateMediaGridLayout(input: MediaGridLayoutInput) {
	const width = Math.max(1, input.containerWidth)
	const fitting = Math.max(1, Math.floor((width + input.gap) / (input.minItemWidth + input.gap)))
	const columns = input.list ? 1 : Math.min(fitting, Math.max(1, input.maxColumns ?? fitting))
	const rows = Math.ceil(input.itemCount / columns)
	const available = (width - input.gap * (columns - 1)) / columns
	const itemWidth = input.maxItemWidth === undefined ? available : Math.min(available, input.maxItemWidth)
	const rowHeight = input.list ? 94 : Math.max(120, itemWidth / input.itemAspectRatio + (input.itemExtraHeight ?? 0))
	return { columns, rows, itemWidth, rowHeight, totalHeight: Math.max(0, rows * (rowHeight + input.gap) - input.gap) }
}

function safeRatio(value: number): number {
	return Number.isFinite(value) ? Math.min(2.5, Math.max(0.5, value)) : 4 / 3
}

/**
 * Produces stable absolute positions for the virtual public gallery. Grid mode
 * uses justified photographic rows, masonry keeps intrinsic heights, and list
 * mode reserves a useful contact-sheet row instead of a cropped strip.
 *
 * @param input Layout constraints and intrinsic media ratios.
 */
export function calculateMediaLayout(input: MediaLayoutInput): { positions: MediaLayoutPosition[]; totalHeight: number } {
	const containerWidth = Math.max(1, input.containerWidth)
	const ratios = input.aspectRatios.map(safeRatio)
	if (ratios.length === 0) return { positions: [], totalHeight: 0 }

	if (input.mode === 'list') {
		const positions = ratios.map((_, index) => ({
			index,
			x: 0,
			y: index * (input.listRowHeight + input.gap),
			width: containerWidth,
			height: input.listRowHeight,
		}))
		return { positions, totalHeight: positions.at(-1)!.y + input.listRowHeight }
	}

	if (input.mode === 'masonry') {
		const columns = input.singleColumn
			? 1
			: Math.max(1, Math.floor((containerWidth + input.gap) / (input.minItemWidth + input.gap)))
		const itemWidth = (containerWidth - input.gap * (columns - 1)) / columns
		const lanes = Array.from({ length: columns }, () => 0)
		const positions = ratios.map((ratio, index) => {
			const lane = lanes.indexOf(Math.min(...lanes))
			const height = itemWidth / ratio
			const position = { index, x: lane * (itemWidth + input.gap), y: lanes[lane], width: itemWidth, height }
			lanes[lane] += height + input.gap
			return position
		})
		return { positions, totalHeight: Math.max(0, ...lanes) - input.gap }
	}

	if (input.singleColumn) {
		let y = 0
		const positions = ratios.map((ratio, index) => {
			const height = containerWidth / ratio
			const position = { index, x: 0, y, width: containerWidth, height }
			y += height + input.gap
			return position
		})
		return { positions, totalHeight: y - input.gap }
	}

	const positions: MediaLayoutPosition[] = []
	let rowStart = 0
	let previousRowStart = 0
	let rowRatio = 0
	let y = 0
	let previousRowHeight = input.targetRowHeight
	for (let index = 0; index < ratios.length; index++) {
		rowRatio += ratios[index]
		const count = index - rowStart + 1
		const fillHeight = (containerWidth - input.gap * (count - 1)) / rowRatio
		const finalRow = index === ratios.length - 1
		if (fillHeight > input.targetRowHeight && !finalRow) continue

		let height = fillHeight
		if (finalRow && fillHeight > input.targetRowHeight) {
			const sameFormat = ratios.slice(previousRowStart).every(ratio => ratio === ratios[rowStart])
			height = sameFormat ? previousRowHeight : input.targetRowHeight
		}
		let x = 0
		for (let itemIndex = rowStart; itemIndex <= index; itemIndex++) {
			const isFilledRowEnd = !finalRow && itemIndex === index
			const width = isFilledRowEnd
				? containerWidth - x
				: ratios[itemIndex] * height
			positions.push({ index: itemIndex, x, y, width, height })
			x += width + input.gap
		}
		y += height + input.gap
		previousRowStart = rowStart
		rowStart = index + 1
		rowRatio = 0
		previousRowHeight = height
	}

	return { positions, totalHeight: Math.max(0, y - input.gap) }
}
