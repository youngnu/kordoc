/** 매직 바이트 기반 파일 포맷 감지 */

import type { FileType } from "./types.js"

/** 매직 바이트 뷰 생성 (복사 없이 view) */
function magicBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
}

/** HWPX (ZIP 기반 한컴 문서): PK\x03\x04 */
export function isHwpxFile(buffer: ArrayBuffer): boolean {
  const b = magicBytes(buffer)
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/** HWP 5.x (OLE2 바이너리 한컴 문서): \xD0\xCF\x11\xE0 */
export function isOldHwpFile(buffer: ArrayBuffer): boolean {
  const b = magicBytes(buffer)
  return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
}

/** PDF 문서: %PDF */
export function isPdfFile(buffer: ArrayBuffer): boolean {
  const b = magicBytes(buffer)
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
}

/** 버퍼로부터 파일 포맷 감지 */
export function detectFormat(buffer: ArrayBuffer): FileType {
  if (buffer.byteLength < 4) return "unknown"
  if (isHwpxFile(buffer)) return "hwpx"
  if (isOldHwpFile(buffer)) return "hwp"
  if (isPdfFile(buffer)) return "pdf"
  return "unknown"
}
