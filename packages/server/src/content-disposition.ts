/**
 * RFC 5987 の拡張値（`filename*=UTF-8''...`）としてファイル名を符号化する。
 *
 * **`encodeURIComponent` だけでは足りない。** RFC 5987 が許す文字（attr-char）は
 * `ALPHA / DIGIT / ! # $ & + - . ^ _ \` | ~` に限られるが、`encodeURIComponent` は
 * **`'` `(` `)` `*` を素通しする**。たとえば `O'Brien.png` は
 * `filename*=UTF-8''O'Brien.png` となり拡張値の構文として不正で、クライアントによっては
 * ダウンロード名が無視されたり壊れて復元される。
 */
export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** `attachment` としてのヘッダ値を組み立てる。 */
export function attachmentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeRfc5987(fileName)}`
}
