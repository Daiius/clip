import type { ImageClip } from './clip.ts'

/**
 * 画像の実体のキャッシュ制御（prd/02 §4.2）。
 *
 * **`no-store` ではなく `no-cache` を使う。** ここは共有経路（`/s/*`）とは要件が違う。
 *
 * | | 意味 | 使う場所 |
 * |---|---|---|
 * | `no-store` | 保存すること自体を禁じる | `/s/*`（prd/04 §3.1。**失効の一部**なので緩めない） |
 * | `no-cache` | 保存はしてよいが、**使う前に必ずサーバーへ検証させる** | `/api/clips/:id/blob` |
 *
 * `no-cache` なら**検証のリクエストは毎回サーバーまで届く**ので、削除の反映は今までと変わらない
 * （消えていれば 304 ではなく 404 が返る）。消えるのは**転送されるバイト列だけ**である。
 *
 * ⚠ **`public` にしない。** private データなので、共有キャッシュに載せてよいものではない。
 */
export const BLOB_CACHE_CONTROL = 'private, no-cache'

/**
 * 実体の ETag。**id と byteSize から導く。**
 *
 * 実体は id に対して**不変**である: 投入は毎回新しい ULID を作り（prd/02 §2）、
 * 更新の経路が無く、削除は行と実体の両方を消す。**同じ id が別のバイト列を指すことはない。**
 * だから中身のハッシュを取る必要がなく、**DB の行だけで ETag を決められる**。
 *
 * ⚠ **ETag が行だけで決まることと、304 を行だけで決めてよいことは別である。** 実体を失った行は
 * 起こりうる（prd/02 §3.2）ので、304 を返す前に**在ることだけは確かめる**（`BlobStore.exists`）。
 * 省けるのは**バイト列の転送**であって、ストレージへの往復そのものではない。
 *
 * それでも `byteSize` を混ぜるのは、ETag を「名前」ではなく**表現そのものの関数**にするためである。
 * 万一 DB 側で列が変わったときに、古い ETag が一致してしまうのを防ぐ。
 */
export function blobETag(clip: Pick<ImageClip, 'id' | 'byteSize'>): string {
  return `"${clip.id}-${clip.byteSize}"`
}

/**
 * `If-None-Match` が現在の ETag に一致するか（RFC 9110 §13.1.2）。
 *
 * - **比較は弱い比較で行う。** `W/` 接頭辞は落として突き合わせる。条件付き GET では
 *   強い比較を要求されないので、`W/"x"` を送ってくるキャッシュを取りこぼさない。
 * - **`*` は「その表現が存在すれば一致」**を意味する。ここへ来る時点で行は引けているので真になる。
 * - ヘッダには**複数の ETag が並びうる**（`"a", W/"b"`）。1つでも一致すれば真。
 */
export function matchesETag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false

  const wanted = stripWeak(etag)
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || stripWeak(candidate) === wanted)
}

function stripWeak(etag: string): string {
  return etag.startsWith('W/') ? etag.slice(2) : etag
}
