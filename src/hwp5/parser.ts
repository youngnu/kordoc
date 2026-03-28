/** HWP 5.x 바이너리 파서 — OLE2 컨테이너 → 섹션 → Markdown */

import {
  readRecords, decompressStream, parseFileHeader, extractText,
  TAG_PARA_HEADER, TAG_PARA_TEXT, TAG_CTRL_HEADER, TAG_LIST_HEADER, TAG_TABLE,
  FLAG_COMPRESSED, FLAG_ENCRYPTED, FLAG_DRM,
  type HwpRecord,
} from "./record.js"
import { buildTable, blocksToMarkdown, MAX_COLS, MAX_ROWS } from "../table/builder.js"
import type { CellContext, IRBlock } from "../types.js"

import { createRequire } from "module"
const require = createRequire(import.meta.url)
const CFB: CfbModule = require("cfb")

interface CfbEntry { name?: string; content?: Buffer | Uint8Array }
interface CfbContainer { FileIndex?: CfbEntry[] }
interface CfbModule {
  parse(data: Buffer): CfbContainer
  find(cfb: CfbContainer, path: string): CfbEntry | null
}

/** 최대 섹션 수 — 비정상 파일에 의한 무한 루프 방지 */
const MAX_SECTIONS = 100
/** 누적 압축 해제 최대 크기 (100MB) */
const MAX_TOTAL_DECOMPRESS = 100 * 1024 * 1024

export function parseHwp5Document(buffer: Buffer): string {
  const cfb = CFB.parse(buffer)

  const headerEntry = CFB.find(cfb, "/FileHeader")
  if (!headerEntry?.content) throw new Error("FileHeader 스트림 없음")
  const header = parseFileHeader(Buffer.from(headerEntry.content))
  if (header.signature !== "HWP Document File") throw new Error("HWP 시그니처 불일치")
  if (header.flags & FLAG_ENCRYPTED) throw new Error("암호화된 HWP는 지원하지 않습니다")
  if (header.flags & FLAG_DRM) throw new Error("DRM 보호된 HWP는 지원하지 않습니다")
  const compressed = (header.flags & FLAG_COMPRESSED) !== 0

  const sections = findSections(cfb)
  if (sections.length === 0) throw new Error("섹션 스트림을 찾을 수 없습니다")

  const blocks: IRBlock[] = []
  let totalDecompressed = 0
  for (const sectionData of sections) {
    const data = compressed ? decompressStream(Buffer.from(sectionData)) : Buffer.from(sectionData)
    totalDecompressed += data.length
    if (totalDecompressed > MAX_TOTAL_DECOMPRESS) throw new Error("총 압축 해제 크기 초과 (decompression bomb 의심)")
    const records = readRecords(data)
    blocks.push(...parseSection(records))
  }

  return blocksToMarkdown(blocks)
}

function findSections(cfb: CfbContainer): Buffer[] {
  const sections: Array<{ idx: number; content: Buffer }> = []

  for (let i = 0; i < MAX_SECTIONS; i++) {
    const entry = CFB.find(cfb, `/BodyText/Section${i}`)
    if (!entry?.content) break
    sections.push({ idx: i, content: Buffer.from(entry.content) })
  }

  if (sections.length === 0 && cfb.FileIndex) {
    for (const entry of cfb.FileIndex) {
      if (sections.length >= MAX_SECTIONS) break
      if (entry.name?.startsWith("Section") && entry.content) {
        const idx = parseInt(entry.name.replace("Section", ""), 10) || 0
        sections.push({ idx, content: Buffer.from(entry.content) })
      }
    }
  }

  return sections.sort((a, b) => a.idx - b.idx).map(s => s.content)
}

function parseSection(records: HwpRecord[]): IRBlock[] {
  const blocks: IRBlock[] = []
  let i = 0

  while (i < records.length) {
    const rec = records[i]

    if (rec.tagId === TAG_PARA_HEADER && rec.level === 0) {
      const { paragraph, tables, nextIdx } = parseParagraphWithTables(records, i)
      if (paragraph) blocks.push({ type: "paragraph", text: paragraph })
      for (const t of tables) blocks.push({ type: "table", table: t })
      i = nextIdx
      continue
    }

    if (rec.tagId === TAG_CTRL_HEADER && rec.level <= 1 && rec.data.length >= 4) {
      const ctrlId = rec.data.subarray(0, 4).toString("ascii")
      if (ctrlId === " lbt" || ctrlId === "tbl ") {
        const { table, nextIdx } = parseTableBlock(records, i)
        if (table) blocks.push({ type: "table", table })
        i = nextIdx
        continue
      }
    }

    i++
  }

  return blocks
}

function parseParagraphWithTables(records: HwpRecord[], startIdx: number) {
  const startLevel = records[startIdx].level
  let text = ""
  const tables: ReturnType<typeof buildTable>[] = []
  let i = startIdx + 1

  while (i < records.length) {
    const rec = records[i]
    if (rec.tagId === TAG_PARA_HEADER && rec.level <= startLevel) break

    if (rec.tagId === TAG_PARA_TEXT) {
      text = extractText(rec.data)
    }

    if (rec.tagId === TAG_CTRL_HEADER && rec.data.length >= 4) {
      const ctrlId = rec.data.subarray(0, 4).toString("ascii")
      if (ctrlId === " lbt" || ctrlId === "tbl ") {
        const { table, nextIdx } = parseTableBlock(records, i)
        if (table) tables.push(table)
        i = nextIdx
        continue
      }
    }
    i++
  }

  const trimmed = text.trim()
  return { paragraph: trimmed || null, tables, nextIdx: i }
}

function parseTableBlock(records: HwpRecord[], startIdx: number) {
  const tableLevel = records[startIdx].level
  let i = startIdx + 1
  let rows = 0, cols = 0
  const cells: CellContext[] = []

  while (i < records.length) {
    const rec = records[i]
    if (rec.tagId === TAG_PARA_HEADER && rec.level <= tableLevel) break
    if (rec.tagId === TAG_CTRL_HEADER && rec.level <= tableLevel) break

    if (rec.tagId === TAG_TABLE && rec.data.length >= 8) {
      rows = Math.min(rec.data.readUInt16LE(4), MAX_ROWS)
      cols = Math.min(rec.data.readUInt16LE(6), MAX_COLS)
    }

    if (rec.tagId === TAG_LIST_HEADER) {
      const { cell, nextIdx } = parseCellBlock(records, i, tableLevel)
      if (cell) cells.push(cell)
      i = nextIdx
      continue
    }
    i++
  }

  if (rows === 0 || cols === 0 || cells.length === 0) return { table: null, nextIdx: i }

  const cellRows = arrangeCells(rows, cols, cells)
  return { table: buildTable(cellRows), nextIdx: i }
}

function parseCellBlock(records: HwpRecord[], startIdx: number, tableLevel: number) {
  const rec = records[startIdx]
  const cellLevel = rec.level
  const texts: string[] = []

  // LIST_HEADER에서 셀 병합 정보 추출
  // HWP5 셀 LIST_HEADER 구조: paraCount(u16) + flags(u32) + colAddr(u16) + rowAddr(u16) + colSpan(u16) + rowSpan(u16)
  let colSpan = 1
  let rowSpan = 1
  if (rec.data.length >= 14) {
    const cs = rec.data.readUInt16LE(10)
    const rs = rec.data.readUInt16LE(12)
    if (cs > 0) colSpan = Math.min(cs, MAX_COLS)
    if (rs > 0) rowSpan = Math.min(rs, MAX_ROWS)
  }

  let i = startIdx + 1

  while (i < records.length) {
    const r = records[i]
    if (r.tagId === TAG_LIST_HEADER && r.level <= cellLevel) break
    if (r.level <= tableLevel && (r.tagId === TAG_PARA_HEADER || r.tagId === TAG_CTRL_HEADER)) break

    if (r.tagId === TAG_PARA_TEXT) {
      const t = extractText(r.data).trim()
      if (t) texts.push(t)
    }
    i++
  }

  return { cell: { text: texts.join("\n"), colSpan, rowSpan } as CellContext, nextIdx: i }
}

function arrangeCells(rows: number, cols: number, cells: CellContext[]): CellContext[][] {
  const grid: (CellContext | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))
  let cellIdx = 0

  for (let r = 0; r < rows && cellIdx < cells.length; r++) {
    for (let c = 0; c < cols && cellIdx < cells.length; c++) {
      if (grid[r][c] !== null) continue
      const cell = cells[cellIdx++]
      grid[r][c] = cell

      for (let dr = 0; dr < cell.rowSpan; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          if (dr === 0 && dc === 0) continue
          if (r + dr < rows && c + dc < cols)
            grid[r + dr][c + dc] = { text: "", colSpan: 1, rowSpan: 1 }
        }
      }
    }
  }

  return grid.map(row => row.map(c => c || { text: "", colSpan: 1, rowSpan: 1 }))
}
