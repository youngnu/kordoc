# kordoc

**모두 파싱해버리겠다** — Parse any Korean document to Markdown.

[![npm version](https://img.shields.io/npm/v/kordoc.svg)](https://www.npmjs.com/package/kordoc)
[![license](https://img.shields.io/npm/l/kordoc.svg)](https://github.com/chrisryugj/kordoc/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/kordoc.svg)](https://nodejs.org)

> *HWP, HWPX, PDF — 대한민국 문서라면 남김없이 파싱해버립니다.*

[한국어](./README-KR.md)

![kordoc demo](./demo.gif)

---

## Why kordoc?

South Korea's government runs on **HWP** — a proprietary word processor the rest of the world has never heard of. Every day, 243 local governments and thousands of public institutions produce mountains of `.hwp` files. Extracting text from them has always been a nightmare: COM automation that only works on Windows, proprietary binary formats with zero documentation, and tables that break every existing parser.

**kordoc** was born from that document hell. Built by a Korean civil servant who spent **7 years** buried under HWP files at a district office. One day he snapped — and decided to parse them all. Its parsers have been battle-tested across 5 real government projects, processing school curriculum plans, facility inspection reports, legal annexes, and municipal newsletters. If a Korean public servant wrote it, kordoc can parse it.

---

## Features

- **HWP 5.x Binary Parsing** — OLE2 container + record stream + UTF-16LE. No Hancom Office needed.
- **HWPX ZIP Parsing** — OPF manifest resolution, multi-section, nested tables.
- **PDF Text Extraction** — Y-coordinate line grouping, table reconstruction, image PDF detection.
- **2-Pass Table Builder** — Correct `colSpan`/`rowSpan` via grid algorithm. No broken tables.
- **Broken ZIP Recovery** — Corrupted HWPX? Scans raw Local File Headers.
- **3 Interfaces** — npm library, CLI tool, and MCP server (Claude/Cursor).
- **Cross-Platform** — Pure JavaScript. Runs on Linux, macOS, Windows.

## Supported Formats

| Format | Engine | Features |
|--------|--------|----------|
| **HWPX** (한컴 2020+) | ZIP + XML DOM | Manifest, nested tables, merged cells, broken ZIP recovery |
| **HWP 5.x** (한컴 레거시) | OLE2 + CFB | 21 control chars, zlib decompression, DRM detection |
| **PDF** | pdfjs-dist | Line grouping, table detection, image PDF warning |

## Installation

```bash
npm install kordoc

# PDF support requires pdfjs-dist (optional peer dependency)
npm install pdfjs-dist
```

> **Since v0.2.1**, `pdfjs-dist` is an optional peer dependency. Not needed for HWP/HWPX parsing.

## Usage

### As a Library

```typescript
import { parse } from "kordoc"
import { readFileSync } from "fs"

const buffer = readFileSync("document.hwpx")
const result = await parse(buffer.buffer)

if (result.success) {
  console.log(result.markdown)
}
```

#### Format-Specific

```typescript
import { parseHwpx, parseHwp, parsePdf } from "kordoc"

const hwpxResult = await parseHwpx(buffer)   // HWPX
const hwpResult  = await parseHwp(buffer)    // HWP 5.x
const pdfResult  = await parsePdf(buffer)    // PDF
```

#### Format Detection

```typescript
import { detectFormat } from "kordoc"

detectFormat(buffer) // → "hwpx" | "hwp" | "pdf" | "unknown"
```

### As a CLI

```bash
npx kordoc document.hwpx                    # stdout
npx kordoc document.hwp -o output.md        # save to file
npx kordoc *.pdf -d ./converted/            # batch convert
npx kordoc report.hwpx --format json        # JSON with metadata
```

### As an MCP Server

Works with **Claude Desktop**, **Cursor**, **Windsurf**, and any MCP-compatible client.

```json
{
  "mcpServers": {
    "kordoc": {
      "command": "npx",
      "args": ["-y", "kordoc-mcp"]
    }
  }
}
```

**Tools exposed:**

| Tool | Description |
|------|-------------|
| `parse_document` | Parse HWP/HWPX/PDF file → Markdown |
| `detect_format` | Detect file format via magic bytes |

## API Reference

### `parse(buffer: ArrayBuffer): Promise<ParseResult>`

Auto-detects format and converts to Markdown.

```typescript
interface ParseResult {
  success: boolean
  markdown?: string
  fileType: "hwpx" | "hwp" | "pdf" | "unknown"
  isImageBased?: boolean     // scanned PDF detection
  pageCount?: number         // PDF only
  error?: string
}
```

### Low-Level Exports

```typescript
import { buildTable, blocksToMarkdown, convertTableToText } from "kordoc"
import type { IRBlock, IRTable, IRCell, CellContext } from "kordoc"
```

## Requirements

- **Node.js** >= 18
- **pdfjs-dist** >= 4.0.0 — Optional. Only needed for PDF. HWP/HWPX work without it.

## Security

v0.2.1 includes the following security hardening:

- **ZIP bomb protection** — 100MB decompression limit, 500 entry cap
- **XXE prevention** — DOCTYPE declarations stripped from HWPX XML
- **Decompression bomb guard** — `maxOutputLength` on HWP5 zlib streams
- **MCP path restriction** — Only `.hwp`, `.hwpx`, `.pdf` extensions allowed
- **Table memory guard** — 10,000 row cap on table builder

## How It Works

```
┌─────────────┐     Magic Bytes      ┌──────────────────┐
│  File Input  │ ──── Detection ────→ │  Format Router   │
└─────────────┘                       └────────┬─────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
              ┌─────▼─────┐            ┌───────▼───────┐          ┌──────▼──────┐
              │   HWPX    │            │    HWP 5.x    │          │     PDF     │
              │  ZIP+XML  │            │  OLE2+Record  │          │  pdfjs-dist │
              └─────┬─────┘            └───────┬───────┘          └──────┬──────┘
                    │                          │                          │
                    │       ┌──────────────────┤                          │
                    │       │                  ��                          │
              ┌─────▼───────▼─────┐            │                          │
              │  2-Pass Table     │            │                          │
              │  Builder (Grid)   │            │                          │
              └─────────┬─────────┘            │                          │
                        │                      │                          │
                  ┌─────▼──────────────────────▼──────────────────────────▼─────┐
                  │                      IRBlock[]                              │
                  │              (Intermediate Representation)                  │
                  └────────────────────────┬───────────────────────────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │  Markdown   │
                                    │   Output    │
                                    └─────────────┘
```

## Credits

Production-tested across 5 Korean government technology projects:
- School curriculum plans (학교교육과정)
- Facility inspection reports (사전기획 보고서)
- Legal document annexes (법률 별표)
- Municipal newsletters (소식지)
- Public data extraction tools (공공데이터)

Thousands of real government documents parsed without breaking a sweat.

## License

[MIT](./LICENSE)
