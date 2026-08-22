/**
 * Gateway-level type definitions for the chart/visual/style/rich-run edits.
 *
 * These types were previously imported from apps/sheets/src/shared/desktop-api.ts
 * (Zod-inferred types). They are now defined here as structural interfaces so
 * the gateway package has NO dependency on the application layer.
 *
 * Structural compatibility: the Zod schemas in apps/sheets/src/shared/desktop-api.ts
 * produce types that are structurally identical to these interfaces. The renderer's
 * Zod validation at the IPC boundary guarantees the runtime shape matches.
 */

// ── Color ────────────────────────────────────────────────────────────

/** Hex color string (#RRGGBB). */
export type HexColor = string

// ── Border ────────────────────────────────────────────────────────────

export type EditableBorderStyle =
  | 'thin'
  | 'medium'
  | 'thick'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'hair'
  | 'dashDot'
  | 'dashDotDot'
  | 'mediumDashed'
  | 'mediumDashDot'
  | 'mediumDashDotDot'
  | 'slantDashDot'

/** One border edge delta: an object sets the edge, null removes it. */
export type StyleEditBorder = {
  readonly style: EditableBorderStyle
  readonly color?: HexColor | undefined
} | null

// ── WorkbookStyleEdit ────────────────────────────────────────────────

export interface WorkbookStyleEdit {
  readonly bold?: boolean | undefined
  readonly italic?: boolean | undefined
  readonly underline?: boolean | undefined
  readonly underlineStyle?: 'single' | 'double' | undefined
  readonly strikethrough?: boolean | undefined
  readonly fontFamily?: string | undefined
  readonly fontSize?: number | undefined
  readonly fontColor?: HexColor | null | undefined
  readonly fillColor?: HexColor | null | undefined
  readonly horizontalAlignment?: 'left' | 'center' | 'right' | 'justify' | 'distributed' | undefined
  readonly verticalAlignment?: 'top' | 'center' | 'bottom' | undefined
  readonly wrapText?: boolean | undefined
  readonly textRotation?: number | 255 | undefined
  readonly indent?: number | undefined
  readonly protectionLocked?: boolean | undefined
  readonly protectionHidden?: boolean | undefined
  readonly numberFormat?: string | undefined
  readonly borderTop?: StyleEditBorder | undefined
  readonly borderBottom?: StyleEditBorder | undefined
  readonly borderLeft?: StyleEditBorder | undefined
  readonly borderRight?: StyleEditBorder | undefined
}

// ── WorkbookRichRun ──────────────────────────────────────────────────

export interface WorkbookRichRun {
  readonly text: string
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strikethrough: boolean
  readonly color?: string | undefined
  readonly size?: number | undefined
  readonly family?: string | undefined
}

// ── Drawing anchor ──────────────────────────────────────────────────

export interface DrawingAnchor {
  readonly fromRow: number
  readonly fromColumn: number
  readonly fromRowOffset: number
  readonly fromColumnOffset: number
  readonly toRow: number
  readonly toColumn: number
  readonly toRowOffset: number
  readonly toColumnOffset: number
}

// ── WorkbookChartEdit ────────────────────────────────────────────────

export interface ChartSeriesSetEntry {
  readonly name: string
  readonly values: readonly number[]
  readonly valuesRef?: string | undefined
  readonly categories?: readonly string[] | undefined
  readonly categoriesRef?: string | undefined
  readonly color?: HexColor | undefined
}

export interface ChartSeriesEdit {
  readonly index: number
  readonly name?: string | undefined
  readonly valuesRef?: string | undefined
  readonly values?: readonly number[] | undefined
  readonly categoriesRef?: string | undefined
  readonly categories?: readonly string[] | undefined
}

export interface ChartAxisTitles {
  readonly category?: string | null | undefined
  readonly value?: string | null | undefined
}

export interface ChartValueAxis {
  readonly min?: number | null | undefined
  readonly max?: number | null | undefined
}

export interface WorkbookChartEdit {
  readonly chartPath: string
  readonly title?: string | undefined
  readonly chartType?: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | undefined
  readonly seriesColors?: Readonly<Record<string, HexColor>> | undefined
  readonly legend?: 'none' | 'right' | 'bottom' | 'top' | 'left' | undefined
  readonly dataLabels?: 'none' | 'value' | 'percent' | 'category-percent' | undefined
  readonly dataLabelPosition?: 'center' | 'inside-end' | 'outside-end' | undefined
  readonly dataLabelFormat?: string | undefined
  readonly axisTitles?: ChartAxisTitles | undefined
  readonly pointColors?: Readonly<Record<string, Readonly<Record<string, HexColor>>>> | undefined
  readonly grouping?: 'clustered' | 'stacked' | 'percentStacked' | undefined
  readonly gridlines?: boolean | undefined
  readonly valueAxis?: ChartValueAxis | undefined
  readonly gapWidthPct?: number | undefined
  readonly holeSizePct?: number | undefined
  readonly explosionPct?: number | undefined
  readonly pointExplosions?: Readonly<Record<string, number>> | undefined
  readonly seriesSet?: readonly ChartSeriesSetEntry[] | undefined
  readonly series?: readonly ChartSeriesEdit[] | undefined
}

// ── WorkbookVisualEdit ───────────────────────────────────────────────

export interface WorkbookVisualEdit {
  readonly drawingPath: string
  readonly drawingIndex: number
  readonly remove?: true | undefined
  readonly anchor?: DrawingAnchor | undefined
}
