/** PDF 텍스트 추출 (pdfjs-dist 기반 서버사이드 파싱) */

import type { ParseResult } from "../types.js"

/** 최대 처리 페이지 수 — OOM 방지 */
const MAX_PAGES = 5000
/** 누적 텍스트 최대 크기 (100MB) — 메모리 폭주 방지 */
const MAX_TOTAL_TEXT = 100 * 1024 * 1024

import { createRequire } from "module"
import { pathToFileURL } from "url"

// pdfjs-dist는 external로 빌드됨 — 설치 안 되어 있으면 런타임에 잡힘
interface PdfjsModule {
  getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfjsDocument> }
  GlobalWorkerOptions: { workerSrc: string }
}
interface PdfjsDocument {
  numPages: number
  getPage: (n: number) => Promise<PdfjsPage>
  destroy: () => Promise<void>
}
interface PdfjsPage {
  getTextContent: () => Promise<{ items: PdfjsTextItem[] }>
}
interface PdfjsTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

let pdfjsModule: PdfjsModule | null = null

async function loadPdfjs(): Promise<PdfjsModule | null> {
  if (pdfjsModule) return pdfjsModule
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as PdfjsModule
    // 워커 경로를 file:// URL로 설정 (Node.js ESM 환경 필수)
    const req = createRequire(import.meta.url)
    const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
    pdfjsModule = mod
    return mod
  } catch (err) {
    // import 실패 원인을 구분하여 반환
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Cannot find") || msg.includes("MODULE_NOT_FOUND")) {
      return null // 미설치
    }
    throw new Error(`pdfjs-dist 로딩 실패: ${msg}`)
  }
}

export async function parsePdfDocument(buffer: ArrayBuffer): Promise<ParseResult> {
  const pdfjs = await loadPdfjs()
  if (!pdfjs) {
    return {
      success: false,
      fileType: "pdf",
      pageCount: 0,
      error: "pdfjs-dist가 설치되지 않았습니다. npm install pdfjs-dist",
    }
  }

  const data = new Uint8Array(buffer)
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise

  try {
    const pageCount = doc.numPages
    if (pageCount === 0) {
      return { success: false, fileType: "pdf", pageCount: 0, error: "PDF에 페이지가 없습니다." }
    }

    const pageTexts: string[] = []
    let totalChars = 0
    let totalTextBytes = 0
    const effectivePageCount = Math.min(pageCount, MAX_PAGES)

    for (let i = 1; i <= effectivePageCount; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()
      const lines = groupTextItemsByLine(textContent.items)
      const pageText = lines.join("\n")
      totalChars += pageText.replace(/\s/g, "").length
      totalTextBytes += pageText.length * 2
      if (totalTextBytes > MAX_TOTAL_TEXT) throw new Error(`텍스트 추출 크기 초과 (${MAX_TOTAL_TEXT / 1024 / 1024}MB 제한)`)
      pageTexts.push(pageText)
    }

    const avgCharsPerPage = totalChars / effectivePageCount
    if (avgCharsPerPage < 10) {
      return {
        success: false,
        fileType: "pdf",
        pageCount,
        isImageBased: true,
        error: `이미지 기반 PDF로 추정됩니다 (${pageCount}페이지, 추출 텍스트 ${totalChars}자).`,
      }
    }

    let markdown = ""
    for (let i = 0; i < pageTexts.length; i++) {
      const cleaned = cleanPdfText(pageTexts[i])
      if (cleaned.trim()) {
        if (i > 0 && markdown) markdown += "\n\n"
        markdown += cleaned
      }
    }

    markdown = reconstructTables(markdown)

    const truncated = pageCount > MAX_PAGES
    return { success: true, fileType: "pdf", markdown, pageCount: effectivePageCount, isImageBased: false, ...(truncated && { warning: `PDF가 ${pageCount}페이지이지만 ${MAX_PAGES}페이지까지만 처리했습니다` }) }
  } finally {
    await doc.destroy().catch(() => {})
  }
}

// ─── 텍스트 아이템 → 행 그룹핑 ──────────────────────

function groupTextItemsByLine(items: PdfjsTextItem[]): string[] {
  if (items.length === 0) return []

  const textItems = items.filter(item => typeof item.str === "string" && item.str.trim() !== "")
  if (textItems.length === 0) return []

  textItems.sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5]
    if (Math.abs(yDiff) < 2) return a.transform[4] - b.transform[4]
    return yDiff
  })

  const lines: string[] = []
  let currentY = textItems[0].transform[5]
  let currentLine: { text: string; x: number; width: number }[] = []

  for (const item of textItems) {
    const y = item.transform[5]

    if (Math.abs(currentY - y) > Math.max(item.height * 0.5, 2)) {
      if (currentLine.length > 0) lines.push(mergeLineItems(currentLine))
      currentLine = []
      currentY = y
    }

    currentLine.push({ text: item.str, x: item.transform[4], width: item.width })
  }

  if (currentLine.length > 0) lines.push(mergeLineItems(currentLine))
  return lines
}

function mergeLineItems(items: { text: string; x: number; width: number }[]): string {
  if (items.length <= 1) return items[0]?.text || ""
  items.sort((a, b) => a.x - b.x)

  let result = items[0].text
  for (let i = 1; i < items.length; i++) {
    const gap = items[i].x - (items[i - 1].x + items[i - 1].width)
    if (gap > 15) result += "\t"
    else if (gap > 3) result += " "
    result += items[i].text
  }
  return result
}

export function cleanPdfText(text: string): string {
  return text
    .replace(/^[\s]*[-–—]\s*\d+\s*[-–—][\s]*$/gm, "")
    .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "")
    .replace(/([가-힣·,\-])\n([가-힣(])/g, "$1 $2")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function reconstructTables(text: string): string {
  const lines = text.split("\n")
  const result: string[] = []
  let tableBuffer: string[][] = []

  for (const line of lines) {
    if (line.includes("\t")) {
      tableBuffer.push(line.split("\t").map(c => c.trim()))
    } else {
      if (tableBuffer.length >= 2) result.push(formatAsMarkdownTable(tableBuffer))
      else if (tableBuffer.length === 1) result.push(tableBuffer[0].join(" | "))
      tableBuffer = []
      result.push(line)
    }
  }

  if (tableBuffer.length >= 2) result.push(formatAsMarkdownTable(tableBuffer))
  else if (tableBuffer.length === 1) result.push(tableBuffer[0].join(" | "))

  return result.join("\n")
}

function formatAsMarkdownTable(rows: string[][]): string {
  const maxCols = Math.max(...rows.map(r => r.length))
  // defensive copy — 원본 배열 변경 방지
  const normalized = rows.map(r => {
    const copy = [...r]
    while (copy.length < maxCols) copy.push("")
    return copy
  })

  const lines: string[] = []
  lines.push("| " + normalized[0].join(" | ") + " |")
  lines.push("| " + normalized[0].map(() => "---").join(" | ") + " |")
  for (let i = 1; i < normalized.length; i++) {
    lines.push("| " + normalized[i].join(" | ") + " |")
  }
  return lines.join("\n")
}
