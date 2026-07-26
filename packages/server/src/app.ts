import { zValidator } from '@hono/zod-validator'
import { desc, eq, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import { z } from 'zod'
import {
  hasValidSession,
  issueSession,
  revokeSession,
  sessionRequired,
  verifyCredentials,
} from './auth.ts'
import { type BlobStore, blobKeyFor, createS3BlobStore } from './blob-store.ts'
import {
  type ImageMimeType,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  toClip,
  toListedClip,
  truncateFileName,
} from './clip.ts'
import { attachmentDisposition } from './content-disposition.ts'
import { db } from './db/index.ts'
import { clips } from './db/schema.ts'
import { newClipId } from './id.ts'
import { detectImageMime } from './image.ts'

/**
 * ログイン要求の上限（prd/04 §2）。**未認証で叩ける口なので、単一リクエストの資源上限を持つ。**
 *
 * 試行**回数**の制限（レート制限）は MVP 外だが（issue #3）、それとは別に
 * **1本あたりが際限なく大きくなること**は防ぐ。巨大な JSON を送りつけられると、body の保持と
 * 解析、そして同期的な SHA-256 計算でメモリとイベントループを占有できてしまう。
 * 前段プロキシの設定だけに頼らず、アプリ側でも強制する（§1）。
 */
const LOGIN_BODY_LIMIT_BYTES = 4 * 1024

/**
 * 投入の上限。画像の上限（20MB・prd/02 §5）に multipart の枠分の余裕を足す。
 * **中身のバイト数は別途 `MAX_IMAGE_BYTES` で厳密に見る**（ここは枠の暴走を止めるためだけの値）。
 */
const UPLOAD_BODY_LIMIT_BYTES = MAX_IMAGE_BYTES + 1024 * 1024

/** 一覧の1ページあたりの件数（prd/03 §2）。 */
const PAGE_SIZE = 50

let blobStore: BlobStore | undefined
const getBlobStore = (): BlobStore => {
  if (!blobStore) blobStore = createS3BlobStore()
  return blobStore
}
/** テスト・将来の差し替え用。 */
export const setBlobStore = (store: BlobStore): void => {
  blobStore = store
}

const loginSchema = z.object({
  username: z.string().max(256),
  password: z.string().max(1024),
})

const EXTENSIONS: Record<ImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/**
 * API のルート定義。web はこの型を Hono RPC 経由で共有する（prd/01 §1）。
 *
 * 認証が要らないのは `/auth/*` と `/health` だけで、**それ以外は全て `sessionRequired` を通す**
 * （画像の取得も含む。prd/04 §3）。
 */
export const routes = new Hono()
  .get('/health', (c) => c.json({ ok: true } as const))
  .get('/auth/me', async (c) => {
    if (!(await hasValidSession(c))) return c.json({ error: 'unauthorized' } as const, 401)
    return c.json({ ok: true } as const)
  })
  .post(
    '/auth/login',
    bodyLimit({
      maxSize: LOGIN_BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'payload too large' } as const, 413),
    }),
    zValidator('json', loginSchema),
    async (c) => {
      const { username, password } = c.req.valid('json')

      // 失敗の理由（ユーザー名 / パスワード / 長さ）で応答を変えない（prd/04 §2）。
      if (!verifyCredentials(username, password)) {
        return c.json({ error: 'invalid credentials' } as const, 401)
      }
      await issueSession(c)
      return c.json({ ok: true } as const)
    },
  )
  .post('/auth/logout', (c) => {
    revokeSession(c)
    return c.json({ ok: true } as const)
  })

  /**
   * 投入（prd/03 §1）。テキストと画像を**同じ口**で受ける。
   * `file` があれば画像、無ければ `text` をテキストとして扱う（人間に選ばせない）。
   */
  .post(
    '/clips',
    sessionRequired,
    bodyLimit({
      maxSize: UPLOAD_BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'payload too large' } as const, 413),
    }),
    async (c) => {
      const form = await c.req.parseBody()
      const file = form.file
      const text = form.text

      if (file instanceof File) {
        const bytes = new Uint8Array(await file.arrayBuffer())

        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          return c.json({ error: 'image too large' } as const, 413)
        }

        // **クライアントが申告した MIME を信用しない**（prd/02 §4.1）。中身だけで判定する。
        const mimeType = detectImageMime(bytes)
        if (!mimeType) {
          return c.json({ error: 'unsupported image format' } as const, 415)
        }

        // ファイル名は DB 列（varchar(255)）に収まるよう丸める。長いという理由で投入を拒まない
        // （ダウンロード時の既定名でしかない。prd/02 §5）。**S3 に put する前に済ませる**。
        const fileName = file.name ? truncateFileName(file.name) : null

        const id = newClipId()
        const key = blobKeyFor(id)

        // 順序は **S3 put → DB insert**（prd/02 §3.1）。逆順にすると put 失敗時に
        // 実体を持たない行が一覧に出て、失敗したものが成功したかのように並ぶ。
        await getBlobStore().put(key, bytes, mimeType)
        try {
          await db.insert(clips).values({
            id,
            kind: 'image',
            blobKey: key,
            mimeType,
            byteSize: bytes.byteLength,
            // ペースト経由ではファイル名が取れない（prd/02 §2）。
            fileName,
            createdAt: new Date(),
          })
        } catch (error) {
          // insert 失敗時は同じリクエストの中で実体を best-effort で削除する。
          // それにも失敗したらキーをログに残す（後から掃除できる手掛かり）。
          await getBlobStore()
            .delete(key)
            .catch(() => {
              console.error(`orphan blob（掃除が必要）: ${key}`)
            })
          throw error
        }
        return c.json({ id } as const, 201)
      }

      if (typeof text === 'string' && text.length > 0) {
        // `mediumtext` の上限を超えた入力をそのまま insert すると DB エラー（500）になる。
        // 利用者の入力に起因する失敗は明示的な 4xx で返す（prd/02 §5 / prd/03 §1.4）。
        if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
          return c.json({ error: 'text too large' } as const, 413)
        }

        const id = newClipId()
        await db.insert(clips).values({ id, kind: 'text', text, createdAt: new Date() })
        return c.json({ id } as const, 201)
      }

      return c.json({ error: 'text か file のどちらかが必要です' } as const, 400)
    },
  )

  /**
   * 一覧（prd/03 §2）。**新しい順の時系列のみ**で、検索も絞り込みも持たない。
   *
   * 並び順とページングのカーソルは `id`（ULID）単独（prd/02 §2）。`createdAt` は `datetime` で
   * 同値になりうるため、ソートキーにすると**同じ行が2ページに出たり、どこにも出なかったりする**。
   */
  .get(
    '/clips',
    sessionRequired,
    zValidator('query', z.object({ cursor: z.string().length(26).optional() })),
    async (c) => {
      const { cursor } = c.req.valid('query')

      // 次ページの有無を知るために1件多く取る。
      const rows = await db
        .select()
        .from(clips)
        .where(cursor ? lt(clips.id, cursor) : undefined)
        .orderBy(desc(clips.id))
        .limit(PAGE_SIZE + 1)

      const hasMore = rows.length > PAGE_SIZE
      const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

      return c.json({
        clips: page.map(toListedClip),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      })
    },
  )

  /**
   * 削除（prd/03 §4）。**順序は S3 の実体 → DB 行**（prd/02 §3.2）。
   *
   * 逆順にすると、DB 行が消えた後に S3 の削除が失敗したときに**誰からも辿れない実体**が残る。
   * この順序なら、途中で失敗しても「実体を失った行」が一覧に出るので気づける。
   */
  .delete('/clips/:id', sessionRequired, async (c) => {
    const id = c.req.param('id')
    const rows = await db.select().from(clips).where(eq(clips.id, id)).limit(1)
    const row = rows[0]
    if (!row) return c.json({ error: 'not found' } as const, 404)

    // **行に入っているキーをそのまま消さない。** 一覧は壊れた行も表示して削除を促すので
    // （prd/02 §3.2）、ここには不整合な値が来うる。DB は「blobKey が自分の id に対応する」ことも
    // 「他の行と重複しない」ことも保証しないため、**その値を信じると別のエントリの実体を消す**。
    // id から導出した正規のキーと一致するときだけ消す。
    const canonicalKey = blobKeyFor(row.id)
    if (row.blobKey === canonicalKey) {
      await getBlobStore().delete(canonicalKey)
    } else if (row.blobKey) {
      console.error(
        `blobKey が id と対応しないため実体は消しません: id=${row.id} blobKey=${row.blobKey}`,
      )
    }

    await db.delete(clips).where(eq(clips.id, id))

    return c.json({ ok: true } as const)
  })

  /** 画像の配信（prd/02 §4.2）。**認証必須**（prd/04 §3）。 */
  .get('/clips/:id/blob', sessionRequired, async (c) => {
    return serveBlob(c.req.param('id'), false)
  })

  /** ダウンロード用の別経路（prd/03 §3）。中身は同じで `Content-Disposition` だけが違う。 */
  .get('/clips/:id/download', sessionRequired, async (c) => {
    return serveBlob(c.req.param('id'), true)
  })

async function serveBlob(id: string, asAttachment: boolean): Promise<Response> {
  const rows = await db.select().from(clips).where(eq(clips.id, id)).limit(1)
  const row = rows[0]
  if (!row) return new Response(null, { status: 404 })

  const clip = toClip(row)
  if (clip.kind !== 'image') return new Response(null, { status: 404 })

  const { body } = await getBlobStore().get(clip.blobKey)

  const headers = new Headers({
    // **保存時にサーバーが判定した MIME**を使う（クライアント申告ではない。prd/02 §4.2）。
    'Content-Type': clip.mimeType,
    'Content-Length': String(clip.byteSize),
    // allowlist を通っていても、ブラウザの MIME 推測で別形式として解釈される余地を残さない。
    'X-Content-Type-Options': 'nosniff',
  })

  if (asAttachment) {
    const name = clip.fileName ?? `clip-${clip.id}.${EXTENSIONS[clip.mimeType]}`
    // RFC 5987 の拡張値として符号化する。改行や `"` はもちろん、`'` `(` `)` `*` も
    // percent-encode されるのでヘッダを壊せない（content-disposition.ts）。
    headers.set('Content-Disposition', attachmentDisposition(name))
  }

  return new Response(body, { headers })
}

// 同一オリジン配信のため、API は origin 直下の `/api` に置く（prd/01 §5）。
// dev では web(Vite) の proxy が `/api` をパスを保持したまま転送してくる。
export const app = new Hono().basePath('/api')

app.use('*', logger())
app.route('/', routes)

export type AppType = typeof routes
