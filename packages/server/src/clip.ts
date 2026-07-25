import { z } from 'zod'
import type { ClipRow } from './db/schema.ts'

/**
 * 受け入れる画像形式（prd/02 §4.1）。
 *
 * **`image/svg+xml` は入れない。** SVG は能動コンテンツで、private データと同一オリジンから
 * inline 配信すると stored XSS になる。貼るのが常に自分とは限らない（他人からもらった画像を
 * 中継するのがこの道具の用途）ため、形式で弾く。
 *
 * ここを広げる前に prd/02 §4.1 を読むこと（ラスタライズするか、cookie を共有しない別オリジンから
 * 配信するかを設計してからでないと足せない）。
 */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number]

/** 1エントリあたりの画像の上限（prd/02 §5）。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * エントリのドメイン表現。**テキストか画像のどちらか一方**で、同居しない（prd/02 §1）。
 *
 * DB のテーブルは NULL 可能列を並べた1枚だが、**アプリ層ではこの discriminated union を正とする**。
 * `kind='image'` なのに `blobKey` が無い、のような状態を型で表現できなくするため。
 */
const clipBase = {
  id: z.string().length(26),
  createdAt: z.date(),
}

export const textClipSchema = z.object({
  ...clipBase,
  kind: z.literal('text'),
  text: z.string(),
})

export const imageClipSchema = z.object({
  ...clipBase,
  kind: z.literal('image'),
  blobKey: z.string().min(1),
  mimeType: z.enum(IMAGE_MIME_TYPES),
  byteSize: z.number().int().nonnegative().max(MAX_IMAGE_BYTES),
  /** ペースト経由では取れないので null を許す（prd/02 §2）。 */
  fileName: z.string().nullable(),
})

export const clipSchema = z.discriminatedUnion('kind', [textClipSchema, imageClipSchema])

export type Clip = z.infer<typeof clipSchema>
export type TextClip = z.infer<typeof textClipSchema>
export type ImageClip = z.infer<typeof imageClipSchema>

/**
 * DB の行をドメイン表現に変換する。
 *
 * **不整合な行は例外にする。** `kind='image'` なのに `blobKey` が NULL のような行は、
 * 作成の途中失敗で実体を失った残骸である（prd/02 §3.2 は「気づける異常」としてこれを選んでいる）。
 * 黙って握り潰すと一覧が壊れた行を無言で欠落させ、**気づける異常を選んだ意味が無くなる**。
 */
export function toClip(row: ClipRow): Clip {
  const parsed = clipSchema.safeParse({
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt,
    ...(row.kind === 'text'
      ? { text: row.text }
      : {
          blobKey: row.blobKey,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
          fileName: row.fileName,
        }),
  })

  if (!parsed.success) {
    throw new Error(`clips の行が壊れています (id=${row.id}): ${parsed.error.message}`)
  }
  return parsed.data
}
