/** PDF 텍스트 추출 (pdfjs-dist 기반 서버사이드 파싱) */

import type { ParseResult } from "../types.js"

export async function parsePdfDocument(buffer: ArrayBuffer): Promise<ParseResult> {
  // pdfjs-dist 동적 import (선택적 의존성)
  let getDocument: any, GlobalWorkerOptions: any
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    getDocument = pdfjs.getDocument
    GlobalWorkerOptions = pdfjs.GlobalWorkerOptions
  } catch {
    return {
      success: false,
      fileType: "pdf",
      pageCount: 0,
      error: "pdfjs-dist가 설치되지 않았습니다. npm install pdfjs-dist",
    }
  }

  GlobalWorkerOptions.workerSrc = ""

  try {
    const data = new Uint8Array(buffer)
    const doc = await getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise

    const pageCount = doc.numPages
    if (pageCount === 0) {
      return { success: false, fileType: "pdf", pageCount: 0, error: "PDF에 페이지가 없습니다." }
    }

    const pageTexts: string[] = []
    let totalChars = 0

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()
      const lines = groupTextItemsByLine(textContent.items)
      const pageText = lines.join("\n")
      totalChars += pageText.replace(/\s/g, "").length
      pageTexts.push(pageText)
    }

    const avgCharsPerPage = totalChars / pageCount
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

    return { success: true, fileType: "pdf", markdown, pageCount, isImageBased: false }
  } catch (err) {
    return {
      success: false,
      fileType: "pdf",
      pageCount: 0,
      error: err instanceof Error ? err.message : "PDF 파싱 실패",
    }
  }
}

// ─── 텍스트 아이템 → 행 그룹핑 ──────────────────────

interface TextItem { str: string; transform: number[]; width: number; height: number }

function groupTextItemsByLine(items: any[]): string[] {
  if (items.length === 0) return []

  const textItems = items.filter((item): item is TextItem =>
    typeof item.str === "string" && item.str.trim() !== ""
  )
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

function cleanPdfText(text: string): string {
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
  const normalized = rows.map(r => { while (r.length < maxCols) r.push(""); return r })

  const lines: string[] = []
  lines.push("| " + normalized[0].join(" | ") + " |")
  lines.push("| " + normalized[0].map(() => "---").join(" | ") + " |")
  for (let i = 1; i < normalized.length; i++) {
    lines.push("| " + normalized[i].join(" | ") + " |")
  }
  return lines.join("\n")
}
