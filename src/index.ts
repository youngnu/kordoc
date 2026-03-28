/**
 * kordoc — 모두 파싱해버리겠다
 *
 * HWP, HWPX, PDF → Markdown 변환 통합 라이브러리
 */

import { detectFormat, isHwpxFile, isOldHwpFile, isPdfFile } from "./detect.js"
import { parseHwpxDocument } from "./hwpx/parser.js"
import { parseHwp5Document } from "./hwp5/parser.js"
import { parsePdfDocument } from "./pdf/parser.js"
import type { ParseResult } from "./types.js"

// ─── 메인 API ────────────────────────────────────────

/**
 * 파일 버퍼를 자동 감지하여 Markdown으로 변환
 *
 * @example
 * ```ts
 * import { parse } from "kordoc"
 * const result = await parse(buffer)
 * if (result.success) console.log(result.markdown)
 * ```
 */
export async function parse(buffer: ArrayBuffer): Promise<ParseResult> {
  const format = detectFormat(buffer)

  switch (format) {
    case "hwpx":
      return parseHwpx(buffer)
    case "hwp":
      return parseHwp(buffer)
    case "pdf":
      return parsePdf(buffer)
    default:
      return { success: false, fileType: "unknown", error: "지원하지 않는 파일 형식입니다." }
  }
}

// ─── 포맷별 API ──────────────────────────────────────

/** HWPX 파일을 Markdown으로 변환 */
export async function parseHwpx(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const markdown = await parseHwpxDocument(buffer)
    return { success: true, fileType: "hwpx", markdown }
  } catch (err) {
    return { success: false, fileType: "hwpx", error: err instanceof Error ? err.message : "HWPX 파싱 실패" }
  }
}

/** HWP 5.x 바이너리 파일을 Markdown으로 변환 */
export async function parseHwp(buffer: ArrayBuffer): Promise<ParseResult> {
  try {
    const markdown = parseHwp5Document(Buffer.from(buffer))
    return { success: true, fileType: "hwp", markdown }
  } catch (err) {
    return { success: false, fileType: "hwp", error: err instanceof Error ? err.message : "HWP 파싱 실패" }
  }
}

/** PDF 파일에서 텍스트를 추출하여 Markdown으로 변환 */
export async function parsePdf(buffer: ArrayBuffer): Promise<ParseResult> {
  return parsePdfDocument(buffer)
}

// ─── Re-exports ──────────────────────────────────────

export { detectFormat, isHwpxFile, isOldHwpFile, isPdfFile } from "./detect.js"
export type { ParseResult, FileType, IRBlock, IRTable, IRCell, CellContext } from "./types.js"
export { buildTable, blocksToMarkdown, convertTableToText } from "./table/builder.js"
