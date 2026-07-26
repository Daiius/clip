import { z } from 'zod'
import type { ClipRow } from './db/schema.ts'
import { MAX_FILE_NAME_LENGTH, MAX_IMAGE_BYTES } from './limits.ts'

// 上限は `./limits.ts` を正とする（**web からも import されるため**、zod を持ち込めない）。
// これまでの import 元を変えずに済むよう、ここから再輸出する。
export { MAX_FILE_NAME_LENGTH, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from './limits.ts'

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

/**
 * ファイル名を DB 列（`varchar(255)`）に収まる長さへ丸める。
 *
 * **`String.prototype.slice` を使わない。** slice は UTF-16 コード単位で数えるため、
 * 絵文字など BMP 外の文字を含む名前では **255 文字まで入れられず、境界でサロゲートペアを
 * 分断して末尾が化ける**。MySQL の `varchar(255)` は**コードポイント単位**で数えるので、
 * `Array.from`（＝コードポイント単位）で切るとちょうど列の制約と一致する。
 *
 * 書記素クラスタ単位（`Intl.Segmenter`）にはしない。1書記素が複数コードポイントになりうるので、
 * **列の制約を超えてしまう**（丸める目的を果たせない）。
 */
export function truncateFileName(name: string): string {
  return Array.from(name).slice(0, MAX_FILE_NAME_LENGTH).join('')
}

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
 * DB 行の検証スキーマ。**行の全列を見る。**
 *
 * `kind` 側に必要な列だけを拾うと、**反対側の列に値が入った行を見逃す**
 * （`kind='text'` なのに `blobKey` がある、`kind='image'` なのに `text` がある）。
 * それは「1エントリはテキストか画像のどちらか一方」という前提（prd/02 §1）が崩れた行であり、
 * アプリ層で保証すると決めた対応そのものなので、**必ず反対側が NULL であることまで検証する**。
 */
const textRowSchema = z.object({
  ...clipBase,
  kind: z.literal('text'),
  text: z.string(),
  blobKey: z.null(),
  mimeType: z.null(),
  byteSize: z.null(),
  fileName: z.null(),
})

const imageRowSchema = z.object({
  ...clipBase,
  kind: z.literal('image'),
  text: z.null(),
  blobKey: z.string().min(1),
  mimeType: z.enum(IMAGE_MIME_TYPES),
  byteSize: z.number().int().nonnegative().max(MAX_IMAGE_BYTES),
  fileName: z.string().nullable(),
})

export const clipRowSchema = z.discriminatedUnion('kind', [textRowSchema, imageRowSchema])

/**
 * DB の行をドメイン表現に変換する。
 *
 * **不整合な行は例外にする。** `kind='image'` なのに `blobKey` が NULL のような行は、
 * 作成の途中失敗で実体を失った残骸である（prd/02 §3.2 は「気づける異常」としてこれを選んでいる）。
 * 黙って握り潰すと一覧が壊れた行を無言で欠落させ、**気づける異常を選んだ意味が無くなる**。
 */
/**
 * 一覧に載せる形。壊れた行は**落とさずに `broken` として出す**（prd/02 §3.2）。
 *
 * 削除は「S3 の実体 → DB 行」の順なので、途中で失敗すると**実体を失った行**が残る。
 * それを選んだ理由は「気づける」ことなので、**一覧から黙って除くとその選択が無意味になる**。
 * かといって一覧全体を 500 にすると、他の無事なエントリまで見えなくなって受け渡しに使えない。
 */
export type ListedClip = Clip | { id: string; kind: 'broken'; createdAt: Date }

export function toListedClip(row: ClipRow): ListedClip {
  try {
    return toClip(row)
  } catch {
    return { id: row.id, kind: 'broken', createdAt: row.createdAt }
  }
}

export function toClip(row: ClipRow): Clip {
  const parsed = clipRowSchema.safeParse(row)

  if (!parsed.success) {
    throw new Error(`clips の行が壊れています (id=${row.id}): ${parsed.error.message}`)
  }

  const valid = parsed.data
  return valid.kind === 'text'
    ? { id: valid.id, createdAt: valid.createdAt, kind: 'text', text: valid.text }
    : {
        id: valid.id,
        createdAt: valid.createdAt,
        kind: 'image',
        blobKey: valid.blobKey,
        mimeType: valid.mimeType,
        byteSize: valid.byteSize,
        fileName: valid.fileName,
      }
}
