/** kordoc 공통 타입 정의 */

// ─── 중간 표현 (Intermediate Representation) ─────────

export interface CellContext {
  text: string
  colSpan: number
  rowSpan: number
}

export interface IRBlock {
  type: "paragraph" | "table"
  text?: string
  table?: IRTable
}

export interface IRTable {
  rows: number
  cols: number
  cells: IRCell[][]
  hasHeader: boolean
}

export interface IRCell {
  text: string
  colSpan: number
  rowSpan: number
}

// ─── 파싱 결과 ──────────────────────────────────────

export type FileType = "hwpx" | "hwp" | "pdf" | "unknown"

export interface ParseResult {
  success: boolean
  /** 추출된 마크다운 텍스트 */
  markdown?: string
  /** 감지된 파일 포맷 */
  fileType: FileType
  /** 이미지 기반 PDF 여부 (텍스트 추출 불가) */
  isImageBased?: boolean
  /** PDF 페이지 수 */
  pageCount?: number
  /** 오류 메시지 */
  error?: string
}
