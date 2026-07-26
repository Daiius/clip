import {
  char,
  datetime,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

/**
 * エントリの種別（prd/02 §2）。**1エントリはテキストか画像のどちらか一方**で、同居させない。
 */
export const CLIP_KINDS = ['text', 'image'] as const
export type ClipKind = (typeof CLIP_KINDS)[number]

/**
 * 貼られたもの1件。ログイン試行の記録用テーブルは持たない
 * （レート制限は MVP 外。prd/04 §2 / issue #3）。
 *
 * `kind` と NULL 可能列の対応（`kind='image'` なら `blobKey`・`mimeType`・`byteSize` が揃う）は
 * **アプリ層の zod 検証を正とする**（`../clip.ts`）。DB の CHECK 制約でも表現できるが、
 * スキーマ定義とマイグレーションの素直さを優先した（prd/02 §2）。
 */
export const clips = mysqlTable('clips', {
  /**
   * ULID。**辞書順が生成時刻順**なので、一覧の並びとページングを `id` 単独で成立させられる。
   * 認可トークンではないので、共有の防壁として使わないこと（prd/02 §2）。
   */
  id: char('id', { length: 26 }).primaryKey(),
  kind: mysqlEnum('kind', CLIP_KINDS).notNull(),
  /** `kind='text'` のとき本文。`kind='image'` では NULL。 */
  text: mediumtext('text'),
  /** `kind='image'` のとき S3 のオブジェクトキー（`clips/<id>`）。 */
  blobKey: varchar('blobKey', { length: 255 }),
  /** `kind='image'` のとき **サーバーがシグネチャから判定した** MIME（allowlist 内。prd/02 §4.1）。 */
  mimeType: varchar('mimeType', { length: 255 }),
  /** `kind='image'` のとき実体のバイト数。 */
  byteSize: int('byteSize', { unsigned: true }),
  /** 元のファイル名。**ペースト経由では取れないので NULL を許す**（prd/02 §2）。 */
  fileName: varchar('fileName', { length: 255 }),
  /**
   * 作成時刻。**ソートキーには使わない**（`datetime` は同値になりうるため、単独ではページ境界が
   * 一意にならない。並び順は `id` の降順単独。prd/02 §2）。表示用に持つ。
   */
  createdAt: datetime('createdAt').notNull(),
})

export type ClipRow = typeof clips.$inferSelect
export type NewClipRow = typeof clips.$inferInsert

/**
 * 共有トークン1件（prd/02 §6）。**ログインできない受け手へ、選んだものだけを渡すための行。**
 *
 * `clipIds` の構造は**アプリ層の zod 検証を正とする**（`clips` の `kind` と NULL 可能列と同じ分担）。
 */
export const shares = mysqlTable(
  'shares',
  {
    /** ULID。主キー。**失効の宛先はこれ**で、生のトークンを再送させない（prd/04 §3.1）。 */
    id: char('id', { length: 26 }).primaryKey(),
    /**
     * 共有トークンの **SHA-256（hex）**。
     *
     * ⚠ **トークンそのものを保存しない。** 平文は発行時に一度返すだけにする。
     * ここに平文を置くと、**DB が漏れた時点で生きた共有 URL がそのまま取り出せる**
     * （セッション cookie と同じ扱い。prd/02 §6）。
     */
    tokenHash: char('tokenHash', { length: 64 }).notNull(),
    /**
     * 対象 clip の `id` の配列。
     *
     * **外部キーは張らない**（JSON 列なので張れない）。これは妥協ではなく、望む挙動と噛み合う:
     * clip を消しても ID は残り、参照時に**現存する clip だけを引けば**、消えたものは
     * 自然にマニフェストから落ちて 404 になる。**共有中を理由に削除を止めない**（prd/02 §6）。
     */
    clipIds: json('clipIds').$type<string[]>().notNull(),
    /** 失効時刻（発行の `SHARE_TTL_MS` 後）。 */
    expiresAt: datetime('expiresAt').notNull(),
    createdAt: datetime('createdAt').notNull(),
  },
  // トークンからの参照は毎リクエスト走るので索引を張る。**一意でもある**
  // （同じハッシュの行が2つあると、どちらが有効かが決まらない）。
  (table) => [uniqueIndex('shares_tokenHash_unique').on(table.tokenHash)],
)

export type ShareRow = typeof shares.$inferSelect
