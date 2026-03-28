/**
 * HWPX 파서 — manifest 멀티섹션, colSpan/rowSpan, 중첩테이블
 *
 * lexdiff 기반 + edu-facility-ai 손상ZIP 복구
 */

import JSZip from "jszip"
import { DOMParser } from "@xmldom/xmldom"
import { buildTable, convertTableToText, blocksToMarkdown } from "../table/builder.js"
import type { CellContext, IRBlock } from "../types.js"

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TableState { rows: CellContext[][]; currentRow: CellContext[]; cell: CellContext | null }

export async function parseHwpxDocument(buffer: ArrayBuffer): Promise<string> {
  let zip: JSZip

  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    // ZIP Central Directory 손상 — Local File Header 스캔으로 폴백
    return extractFromBrokenZip(buffer)
  }

  const sectionPaths = await resolveSectionPaths(zip)
  if (sectionPaths.length === 0) throw new Error("HWPX에서 섹션 파일을 찾을 수 없습니다")

  const blocks: IRBlock[] = []
  for (const path of sectionPaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async("text")
    blocks.push(...parseSectionXml(xml))
  }
  return blocksToMarkdown(blocks)
}

// ─── 손상 ZIP 복구 (edu-facility-ai에서 포팅) ──────────

function extractFromBrokenZip(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let pos = 0
  const texts: string[] = []

  while (pos < data.length - 30) {
    // PK\x03\x04 시그니처 확인
    if (data[pos] !== 0x50 || data[pos + 1] !== 0x4b || data[pos + 2] !== 0x03 || data[pos + 3] !== 0x04) break

    const method = view.getUint16(pos + 8, true)
    const compSize = view.getUint32(pos + 18, true)
    const nameLen = view.getUint16(pos + 26, true)
    const extraLen = view.getUint16(pos + 28, true)

    const nameBytes = data.slice(pos + 30, pos + 30 + nameLen)
    const name = new TextDecoder().decode(nameBytes)
    const fileStart = pos + 30 + nameLen + extraLen
    const fileData = data.slice(fileStart, fileStart + compSize)
    pos = fileStart + compSize

    if (!name.toLowerCase().includes("section") || !name.endsWith(".xml")) continue

    try {
      let content: string
      if (method === 0) {
        content = new TextDecoder().decode(fileData)
      } else if (method === 8) {
        // raw deflate
        const { inflateRawSync } = require("zlib")
        content = new TextDecoder().decode(inflateRawSync(Buffer.from(fileData)))
      } else {
        continue
      }
      const sectionText = blocksToMarkdown(parseSectionXml(content))
      if (sectionText) texts.push(sectionText)
    } catch {
      continue
    }
  }

  if (texts.length === 0) throw new Error("손상된 HWPX에서 섹션 데이터를 복구할 수 없습니다")
  return texts.join("\n\n")
}

// ─── Manifest 해석 ───────────────────────────────────

async function resolveSectionPaths(zip: JSZip): Promise<string[]> {
  const manifestPaths = ["Contents/content.hpf", "content.hpf"]
  for (const mp of manifestPaths) {
    const file = zip.file(new RegExp(`^${mp.replace(/\./g, "\\.")}$`, "i"))[0]
    if (!file) continue
    const xml = await file.async("text")
    const paths = parseSectionPathsFromManifest(xml)
    if (paths.length > 0) return paths
  }

  // fallback: section*.xml 직접 검색
  const sectionFiles = zip.file(/[Ss]ection\d+\.xml$/)
  return sectionFiles.map(f => f.name).sort()
}

function parseSectionPathsFromManifest(xml: string): string[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, "text/xml")
  const items = doc.getElementsByTagName("opf:item")
  const spine = doc.getElementsByTagName("opf:itemref")

  const isSectionId = (id: string) => /^s/i.test(id) || id.toLowerCase().includes("section")
  const idToHref = new Map<string, string>()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const id = item.getAttribute("id") || ""
    let href = item.getAttribute("href") || ""
    const mediaType = item.getAttribute("media-type") || ""
    if (!isSectionId(id) && !mediaType.includes("xml")) continue
    if (!href.startsWith("/") && !href.startsWith("Contents/") && isSectionId(id))
      href = "Contents/" + href
    idToHref.set(id, href)
  }

  if (spine.length > 0) {
    const ordered: string[] = []
    for (let i = 0; i < spine.length; i++) {
      const href = idToHref.get(spine[i].getAttribute("idref") || "")
      if (href) ordered.push(href)
    }
    if (ordered.length > 0) return ordered
  }
  return Array.from(idToHref.entries())
    .filter(([id]) => isSectionId(id))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, href]) => href)
}

// ─── 섹션 XML 파싱 ──────────────────────────────────

function parseSectionXml(xml: string): IRBlock[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, "text/xml")
  if (!doc.documentElement) return []

  const blocks: IRBlock[] = []
  walkSection(doc.documentElement, blocks, null, [])
  return blocks
}

function walkSection(
  node: any, blocks: IRBlock[],
  tableCtx: TableState | null, tableStack: TableState[]
): void {
  const children = node.childNodes
  if (!children) return

  for (let i = 0; i < children.length; i++) {
    const el = children[i]
    if (el.nodeType !== 1) continue

    const tag = el.tagName || el.localName || ""
    const localTag = tag.replace(/^[^:]+:/, "")

    switch (localTag) {
      case "tbl": {
        if (tableCtx) tableStack.push(tableCtx)
        const newTable: TableState = { rows: [], currentRow: [], cell: null }
        walkSection(el, blocks, newTable, tableStack)

        if (newTable.rows.length > 0) {
          if (tableStack.length > 0) {
            const parentTable = tableStack.pop()!
            const nestedText = convertTableToText(newTable.rows)
            if (parentTable.cell) {
              parentTable.cell.text += (parentTable.cell.text ? "\n" : "") + nestedText
            }
            tableCtx = parentTable
          } else {
            blocks.push({ type: "table", table: buildTable(newTable.rows) })
            tableCtx = null
          }
        } else {
          tableCtx = tableStack.length > 0 ? tableStack.pop()! : null
        }
        break
      }

      case "tr":
        if (tableCtx) {
          tableCtx.currentRow = []
          walkSection(el, blocks, tableCtx, tableStack)
          if (tableCtx.currentRow.length > 0) tableCtx.rows.push(tableCtx.currentRow)
          tableCtx.currentRow = []
        }
        break

      case "tc":
        if (tableCtx) {
          tableCtx.cell = { text: "", colSpan: 1, rowSpan: 1 }
          walkSection(el, blocks, tableCtx, tableStack)
          if (tableCtx.cell) {
            tableCtx.currentRow.push(tableCtx.cell)
            tableCtx.cell = null
          }
        }
        break

      case "cellSpan":
        if (tableCtx?.cell) {
          const cs = parseInt(el.getAttribute("colSpan") || "1", 10)
          const rs = parseInt(el.getAttribute("rowSpan") || "1", 10)
          if (cs > 0) tableCtx.cell.colSpan = cs
          if (rs > 0) tableCtx.cell.rowSpan = rs
        }
        break

      case "p": {
        const text = extractParagraphText(el)
        if (text) {
          if (tableCtx?.cell) {
            tableCtx.cell.text += (tableCtx.cell.text ? "\n" : "") + text
          } else if (!tableCtx) {
            blocks.push({ type: "paragraph", text })
          }
        }
        walkSection(el, blocks, tableCtx, tableStack)
        break
      }

      default:
        walkSection(el, blocks, tableCtx, tableStack)
        break
    }
  }
}

function extractParagraphText(para: any): string {
  let text = ""
  const walk = (node: any) => {
    const children = node.childNodes
    if (!children) return
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.nodeType === 3) { text += child.textContent || ""; continue }
      if (child.nodeType !== 1) continue

      const tag = (child.tagName || child.localName || "").replace(/^[^:]+:/, "")
      switch (tag) {
        case "t": text += child.textContent || ""; break
        case "tab": text += "\t"; break
        case "br":
          if ((child.getAttribute("type") || "line") === "line") text += "\n"
          break
        case "fwSpace": case "hwSpace": text += " "; break
        case "tbl": break // 테이블은 walkSection에서 처리
        default: walk(child); break
      }
    }
  }
  walk(para)
  return text.replace(/[ \t]+/g, " ").trim()
}
