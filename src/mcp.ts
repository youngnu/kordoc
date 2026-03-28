/** kordoc MCP 서버 — Claude/Cursor에서 문서 파싱 도구로 사용 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { readFileSync, realpathSync, openSync, readSync, closeSync, statSync } from "fs"
import { resolve, isAbsolute, extname } from "path"
import { parse, detectFormat } from "./index.js"
import { VERSION, toArrayBuffer } from "./utils.js"

/** 허용 파일 확장자 */
const ALLOWED_EXTENSIONS = new Set([".hwp", ".hwpx", ".pdf"])
/** 최대 파일 크기 (500MB) */
const MAX_FILE_SIZE = 500 * 1024 * 1024

/** 경로 정규화 및 보안 검증 */
function safePath(filePath: string): string {
  if (!filePath) throw new Error("파일 경로가 비어있습니다")
  const resolved = resolve(filePath)
  const real = realpathSync(resolved)
  if (!isAbsolute(real)) throw new Error("절대 경로만 허용됩니다")
  const ext = extname(real).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(`지원하지 않는 확장자입니다: ${ext} (허용: ${[...ALLOWED_EXTENSIONS].join(", ")})`)
  return real
}

const server = new McpServer({
  name: "kordoc",
  version: VERSION,
})

// ─── 도구: parse_document ────────────────────────────

server.tool(
  "parse_document",
  "한국 문서 파일(HWP, HWPX, PDF)을 마크다운으로 변환합니다. 파일 경로를 입력하면 포맷을 자동 감지하여 텍스트를 추출합니다.",
  {
    file_path: z.string().min(1).describe("파싱할 문서 파일의 절대 경로 (HWP, HWPX, PDF)"),
  },
  async ({ file_path }) => {
    try {
      const resolved = safePath(file_path)
      const fileSize = statSync(resolved).size
      if (fileSize > MAX_FILE_SIZE) {
        return {
          content: [{ type: "text", text: `파일이 너무 큽니다: ${(fileSize / 1024 / 1024).toFixed(1)}MB (최대 ${MAX_FILE_SIZE / 1024 / 1024}MB)` }],
          isError: true,
        }
      }
      const buffer = readFileSync(resolved)
      const arrayBuffer = toArrayBuffer(buffer)
      const format = detectFormat(arrayBuffer)

      if (format === "unknown") {
        return {
          content: [{ type: "text", text: `지원하지 않는 파일 형식입니다: ${file_path}` }],
          isError: true,
        }
      }

      const result = await parse(arrayBuffer)

      if (!result.success) {
        return {
          content: [{ type: "text", text: `파싱 실패 (${result.fileType}): ${result.error}` }],
          isError: true,
        }
      }

      const meta = [
        `포맷: ${result.fileType.toUpperCase()}`,
        result.pageCount ? `페이지: ${result.pageCount}` : null,
        result.isImageBased ? "이미지 기반 PDF (텍스트 추출 불가)" : null,
      ].filter(Boolean).join(" | ")

      return {
        content: [{ type: "text", text: `[${meta}]\n\n${result.markdown}` }],
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: `오류: ${sanitizeError(err)}` }],
        isError: true,
      }
    }
  }
)

// ─── 도구: detect_format ─────────────────────────────

server.tool(
  "detect_format",
  "파일의 포맷을 매직 바이트로 감지합니다 (hwpx, hwp, pdf, unknown).",
  {
    file_path: z.string().min(1).describe("감지할 파일의 절대 경로"),
  },
  async ({ file_path }) => {
    try {
      const resolved = safePath(file_path)
      // 전체 파일 대신 첫 16바이트만 읽기 — 대용량 파일 OOM 방지
      const fd = openSync(resolved, "r")
      let headerBuf: Buffer
      try {
        headerBuf = Buffer.alloc(16)
        readSync(fd, headerBuf, 0, 16, 0)
      } finally {
        closeSync(fd)
      }
      const header = toArrayBuffer(headerBuf)
      const format = detectFormat(header)
      return {
        content: [{ type: "text", text: `${file_path}: ${format}` }],
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: `오류: ${sanitizeError(err)}` }],
        isError: true,
      }
    }
  }
)

// ─── 에러 메시지 정제 — 파일시스템 경로 노출 방지 ─────

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/[A-Za-z]:\\[^\s:]+/g, "[path]").replace(/\/(?:home|usr|tmp|var|etc)\/[^\s:]+/g, "[path]")
}

// ─── 서버 시작 ───────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => { console.error(err); process.exit(1) })
