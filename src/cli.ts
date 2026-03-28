/** kordoc CLI — 모두 파싱해버리겠다 */

import { readFileSync, writeFileSync } from "fs"
import { basename, resolve } from "path"
import { Command } from "commander"
import { parse, detectFormat } from "./index.js"

const program = new Command()

program
  .name("kordoc")
  .description("모두 파싱해버리겠다 — HWP, HWPX, PDF → Markdown")
  .version("0.1.0")
  .argument("<files...>", "변환할 파일 경로 (HWP, HWPX, PDF)")
  .option("-o, --output <path>", "출력 파일 경로 (단일 파일 시)")
  .option("-d, --out-dir <dir>", "출력 디렉토리 (다중 파일 시)")
  .option("--format <type>", "출력 형식: markdown (기본) 또는 json", "markdown")
  .option("--silent", "진행 메시지 숨기기")
  .action(async (files: string[], opts) => {
    for (const filePath of files) {
      const absPath = resolve(filePath)
      const fileName = basename(absPath)

      try {
        const buffer = readFileSync(absPath)
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        const format = detectFormat(arrayBuffer)

        if (!opts.silent) {
          process.stderr.write(`[kordoc] ${fileName} (${format}) ...`)
        }

        const result = await parse(arrayBuffer)

        if (!result.success) {
          process.stderr.write(` FAIL\n`)
          process.stderr.write(`  → ${result.error}\n`)
          process.exitCode = 1
          continue
        }

        if (!opts.silent) process.stderr.write(` OK\n`)

        const output = opts.format === "json"
          ? JSON.stringify(result, null, 2)
          : result.markdown || ""

        if (opts.output && files.length === 1) {
          writeFileSync(opts.output, output, "utf-8")
          if (!opts.silent) process.stderr.write(`  → ${opts.output}\n`)
        } else if (opts.outDir) {
          const outPath = resolve(opts.outDir, fileName.replace(/\.[^.]+$/, ".md"))
          writeFileSync(outPath, output, "utf-8")
          if (!opts.silent) process.stderr.write(`  → ${outPath}\n`)
        } else {
          process.stdout.write(output + "\n")
        }
      } catch (err) {
        process.stderr.write(`\n[kordoc] ERROR: ${fileName} — ${err instanceof Error ? err.message : err}\n`)
        process.exitCode = 1
      }
    }
  })

program.parse()
