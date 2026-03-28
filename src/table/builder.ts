/** 2-pass colSpan/rowSpan 테이블 빌더 및 Markdown 변환 */

import type { CellContext, IRBlock, IRCell, IRTable } from "../types.js"

/** 테이블 열 수 상한 — 한국 공공문서 기준 충분한 값 */
const MAX_COLS = 200
/** 테이블 행 수 상한 — 메모리 폭주 방지 */
const MAX_ROWS = 10000

export function buildTable(rows: CellContext[][]): IRTable {
  if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS)
  const numRows = rows.length

  // Pass 1: maxCols 계산
  const tempOccupied: boolean[][] = Array.from({ length: numRows }, () => Array(MAX_COLS).fill(false))
  let maxCols = 0

  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    let colIdx = 0
    for (const cell of rows[rowIdx]) {
      while (colIdx < MAX_COLS && tempOccupied[rowIdx][colIdx]) colIdx++
      if (colIdx >= MAX_COLS) break

      for (let r = rowIdx; r < Math.min(rowIdx + cell.rowSpan, numRows); r++) {
        for (let c = colIdx; c < Math.min(colIdx + cell.colSpan, MAX_COLS); c++) {
          tempOccupied[r][c] = true
        }
      }
      colIdx += cell.colSpan
      if (colIdx > maxCols) maxCols = colIdx
    }
  }

  if (maxCols === 0) return { rows: 0, cols: 0, cells: [], hasHeader: false }

  // Pass 2: 실제 배치
  const grid: IRCell[][] = Array.from({ length: numRows }, () =>
    Array.from({ length: maxCols }, () => ({ text: "", colSpan: 1, rowSpan: 1 }))
  )
  const occupied: boolean[][] = Array.from({ length: numRows }, () => Array(maxCols).fill(false))

  for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
    let colIdx = 0
    let cellIdx = 0

    while (colIdx < maxCols && cellIdx < rows[rowIdx].length) {
      while (colIdx < maxCols && occupied[rowIdx][colIdx]) colIdx++
      if (colIdx >= maxCols) break

      const cell = rows[rowIdx][cellIdx]
      grid[rowIdx][colIdx] = {
        text: cell.text.trim(),
        colSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
      }

      for (let r = rowIdx; r < Math.min(rowIdx + cell.rowSpan, numRows); r++) {
        for (let c = colIdx; c < Math.min(colIdx + cell.colSpan, maxCols); c++) {
          occupied[r][c] = true
        }
      }

      colIdx += cell.colSpan
      cellIdx++
    }
  }

  return { rows: numRows, cols: maxCols, cells: grid, hasHeader: numRows > 1 }
}

export function convertTableToText(rows: CellContext[][]): string {
  return rows
    .map(row =>
      row
        .map(c => c.text.trim().replace(/\n/g, " "))
        .filter(Boolean)
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n")
}

export function blocksToMarkdown(blocks: IRBlock[]): string {
  const lines: string[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === "paragraph" && block.text) {
      const text = block.text

      if (/^\[별표\s*\d+/.test(text)) {
        const nextBlock = blocks[i + 1]
        if (nextBlock?.type === "paragraph" && nextBlock.text && /관련\)?$/.test(nextBlock.text)) {
          lines.push("", `## ${text} ${nextBlock.text}`, "")
          i++
        } else {
          lines.push("", `## ${text}`, "")
        }
        continue
      }

      if (/^\([^)]*조[^)]*관련\)$/.test(text)) {
        lines.push(`*${text}*`, "")
        continue
      }

      lines.push(text)
    } else if (block.type === "table" && block.table) {
      lines.push(tableToMarkdown(block.table))
    }
  }

  return lines.join("\n").trim()
}

function tableToMarkdown(table: IRTable): string {
  if (table.rows === 0 || table.cols === 0) return ""

  const { cells, rows: numRows, cols: numCols } = table

  // 1행 1열 → 구조화된 텍스트
  if (numRows === 1 && numCols === 1) {
    const content = cells[0][0].text
    return content
      .split(/\n/)
      .map(line => {
        const trimmed = line.trim()
        if (!trimmed) return ""
        if (/^\d+\.\s/.test(trimmed)) return `**${trimmed}**`
        if (/^[가-힣]\.\s/.test(trimmed)) return `  ${trimmed}`
        return trimmed
      })
      .filter(Boolean)
      .join("\n")
  }

  // 병합 셀: 행/열 병합된 셀은 빈 칸으로
  const display: string[][] = Array.from({ length: numRows }, () => Array(numCols).fill(""))
  const skip = new Set<string>()

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (skip.has(`${r},${c}`)) continue
      const cell = cells[r][c]
      display[r][c] = cell.text.replace(/\n/g, "<br>")

      for (let dr = 0; dr < cell.rowSpan; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          if (dr === 0 && dc === 0) continue
          if (r + dr < numRows && c + dc < numCols) {
            skip.add(`${r + dr},${c + dc}`)
          }
        }
      }
    }
  }

  // rowSpan에 의해 생긴 빈 placeholder 행만 제거 (내용이 동일한 실제 데이터 행은 유지)
  const uniqueRows: string[][] = []
  for (const row of display) {
    const isEmptyPlaceholder = row.every(cell => cell === "")
    if (!isEmptyPlaceholder) uniqueRows.push(row)
  }

  if (uniqueRows.length === 0) return ""

  const md: string[] = []
  md.push("| " + uniqueRows[0].join(" | ") + " |")
  md.push("| " + uniqueRows[0].map(() => "---").join(" | ") + " |")
  for (let i = 1; i < uniqueRows.length; i++) {
    md.push("| " + uniqueRows[i].join(" | ") + " |")
  }
  return md.join("\n")
}
