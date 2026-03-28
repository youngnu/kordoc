/** 매직 바이트 기반 파일 포맷 감지 */

import type { FileType } from "./types.js"

/** HWPX (ZIP 기반 한컴 문서): PK\x03\x04 */
export function isHwpxFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** HWP 5.x (OLE2 바이너리 한컴 문서): \xD0\xCF\x11\xE0 */
export function isOldHwpFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

/** PDF 문서: %PDF */
export function isPdfFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** 버퍼로부터 파일 포맷 감지 */
export function detectFormat(buffer: ArrayBuffer): FileType {
  if (isHwpxFile(buffer)) return "hwpx"
  if (isOldHwpFile(buffer)) return "hwp"
  if (isPdfFile(buffer)) return "pdf"
  return "unknown"
}
