import type { ImageMimeType } from './clip.ts'

/**
 * 実体の先頭バイト（ファイルシグネチャ）から形式を判定する（prd/02 §4.1）。
 *
 * **クライアントが申告した MIME を信用しない。** 申告をそのまま `Content-Type` にして
 * 同一オリジンから配信すると、`image/png` と偽った SVG や HTML が**アプリのオリジンで実行される**
 * （stored XSS）。判定に使うのは中身だけで、`Content-Type` ヘッダにもファイル名にも依存しない。
 *
 * allowlist 外（SVG・PDF・zip など）は `null` を返す。**呼び出し側は保存してはいけない。**
 */
const SIGNATURES: ReadonlyArray<{
  mime: ImageMimeType
  matches: (bytes: Uint8Array) => boolean
}> = [
  {
    mime: 'image/png',
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mime: 'image/jpeg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  // GIF87a / GIF89a のどちらも `GIF8` で始まる。
  { mime: 'image/gif', matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  // RIFF....WEBP（4〜7 バイト目はファイルサイズなので見ない）。
  {
    mime: 'image/webp',
    matches: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) && matchesAt(b, 8, [0x57, 0x45, 0x42, 0x50]),
  },
]

function matchesAt(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return matchesAt(bytes, 0, signature)
}

export function detectImageMime(bytes: Uint8Array): ImageMimeType | null {
  return SIGNATURES.find((signature) => signature.matches(bytes))?.mime ?? null
}
