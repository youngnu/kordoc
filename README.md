# kordoc

### 모두 파싱해버리겠다.

> *"HWP든 HWPX든 PDF든, 한국 문서라면 다 조려버립니다."*

Korean document formats — parsed, converted, delivered as clean Markdown. No COM automation, no Windows dependency, no tears.

---

## Why kordoc?

Korean offices run on HWP. The rest of the world has never heard of it. If you've ever tried to extract text from a `.hwp` file on Linux, you know the pain. **kordoc** parses them all — natively, cross-platform, no Hancom Office required.

| Format | Engine | Status |
|--------|--------|--------|
| **HWPX** (한컴 2020+) | ZIP + XML DOM walk | Stable |
| **HWP 5.x** (한컴 레거시) | OLE2 binary + record parsing | Stable |
| **PDF** | pdfjs-dist text extraction | Stable |

### What makes it different

- **2-pass table builder** — Correct `colSpan`/`rowSpan` handling via grid algorithm. No more broken table layouts.
- **Broken ZIP recovery** — Corrupted HWPX? We scan raw Local File Headers and still extract text.
- **OPF manifest resolution** — Multi-section HWPX documents parsed in correct spine order.
- **21 HWP5 control characters** — Full UTF-16LE decoding with extended/inline object skip.
- **Image-based PDF detection** — Warns you when a scanned PDF can't be text-extracted.

---

## Quick Start

### As a library

```bash
npm install kordoc
```

```typescript
import { parse } from "kordoc"
import { readFileSync } from "fs"

const buffer = readFileSync("document.hwpx")
const result = await parse(buffer.buffer)

if (result.success) {
  console.log(result.markdown)
  // → Clean markdown with tables, headings, and structure preserved
}
```

### Format-specific parsing

```typescript
import { parseHwpx, parseHwp, parsePdf } from "kordoc"

// HWPX (modern Hancom format)
const hwpxResult = await parseHwpx(buffer)

// HWP 5.x (legacy binary format)
const hwpResult = await parseHwp(buffer)

// PDF (text-based)
const pdfResult = await parsePdf(buffer)
```

### Format detection

```typescript
import { detectFormat, isHwpxFile, isOldHwpFile, isPdfFile } from "kordoc"

const format = detectFormat(buffer) // → "hwpx" | "hwp" | "pdf" | "unknown"
```

### As a CLI

```bash
npx kordoc document.hwpx                    # stdout
npx kordoc document.hwp -o output.md        # save to file
npx kordoc *.pdf -d ./converted/            # batch convert
npx kordoc report.hwpx --format json        # JSON with metadata
```

---

## API Reference

### `parse(buffer: ArrayBuffer): Promise<ParseResult>`

Auto-detects format via magic bytes and parses to Markdown.

### `ParseResult`

```typescript
interface ParseResult {
  success: boolean
  markdown?: string          // Extracted markdown text
  fileType: "hwpx" | "hwp" | "pdf" | "unknown"
  isImageBased?: boolean     // true if scanned PDF (no text extractable)
  pageCount?: number         // PDF page count
  error?: string             // Error message on failure
}
```

### Low-level exports

```typescript
// Table builder (2-pass colSpan/rowSpan algorithm)
import { buildTable, blocksToMarkdown } from "kordoc"

// Type definitions
import type { IRBlock, IRTable, IRCell, CellContext } from "kordoc"
```

---

## Supported Formats

### HWPX (한컴오피스 2020+)

ZIP-based XML format. kordoc reads the OPF manifest (`content.hpf`) for correct section ordering, walks the XML DOM for paragraphs and tables, and handles:
- Multi-section documents
- Nested tables (table inside a table cell)
- `colSpan` / `rowSpan` merged cells
- Corrupted ZIP archives (Local File Header fallback)

### HWP 5.x (한컴오피스 레거시)

OLE2 Compound Binary format. kordoc parses the CFB container, decompresses section streams (zlib), reads HWP record structures, and extracts UTF-16LE text with full control character handling:
- 21 control character types (line breaks, tabs, hyphens, NBSP, extended objects)
- Encrypted/DRM file detection (fails fast with clear error)
- Table extraction with grid-based cell arrangement

### PDF

Server-side text extraction via pdfjs-dist:
- Y-coordinate based line grouping
- Gap-based cell/table detection
- Image-based PDF detection (< 10 chars/page average)
- Korean text line joining (조사/접속사 awareness)

---

## Requirements

- **Node.js** >= 18
- **pdfjs-dist** — Required only for PDF parsing. HWP/HWPX work without it.

---

## Credits

Built from production-tested parsers across 5 Korean government technology projects. The table builder's 2-pass grid algorithm, HWP5 binary parser, and HWPX manifest resolver have been battle-tested against thousands of real Korean government documents.

---

## License

MIT

---

<br>

# kordoc (한국어)

### 모두 파싱해버리겠다.

> *최강록 셰프가 모든 재료를 조려버리듯, kordoc은 한국 문서를 몽땅 파싱해버립니다.*

HWP, HWPX, PDF — 한국에서 쓰이는 모든 문서 포맷을 마크다운으로 변환하는 Node.js 라이브러리입니다.

### 특징

- **한컴오피스 불필요** — COM 자동화 없이 순수 파싱. Linux, Mac에서도 동작
- **손상 파일 복구** — ZIP Central Directory가 깨진 HWPX도 Local File Header 스캔으로 복구
- **병합 셀 완벽 처리** — 2-pass 그리드 알고리즘으로 colSpan/rowSpan 정확히 렌더링
- **HWP5 바이너리 직접 파싱** — OLE2 컨테이너 → 레코드 스트림 → UTF-16LE 텍스트 추출
- **이미지 PDF 감지** — 스캔된 PDF는 텍스트 추출 불가를 사전에 알려줌

### 설치

```bash
npm install kordoc
```

### 사용법

```typescript
import { parse } from "kordoc"
import { readFileSync } from "fs"

const buffer = readFileSync("사업계획서.hwpx")
const result = await parse(buffer.buffer)

if (result.success) {
  console.log(result.markdown)
}
```

### CLI

```bash
npx kordoc 사업계획서.hwpx                     # 터미널 출력
npx kordoc 보고서.hwp -o 보고서.md              # 파일 저장
npx kordoc *.pdf -d ./변환결과/                 # 일괄 변환
```
