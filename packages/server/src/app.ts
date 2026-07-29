import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import type { MiddlewareHandler } from 'hono/types'
import { z } from 'zod'
import {
  hasValidSession,
  issueSession,
  revokeSession,
  sessionRequired,
  verifyCredentials,
} from './auth.ts'
import { BLOB_CACHE_CONTROL, blobETag, matchesETag } from './blob-cache.ts'
import { BlobNotFoundError, type BlobStore, blobKeyFor, createS3BlobStore } from './blob-store.ts'
import {
  type Clip,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  toClip,
  toListedClip,
  truncateFileName,
} from './clip.ts'
import { attachmentDisposition } from './content-disposition.ts'
import { db } from './db/index.ts'
import { clips, shares } from './db/schema.ts'
import { newClipId, newShareId } from './id.ts'
import { detectImageMime } from './image.ts'
import { SHARE_TTL_MS } from './limits.ts'
import { publicOrigin } from './origin.ts'
import {
  buildManifest,
  createShareSchema,
  hashShareToken,
  memberFileName,
  newShareToken,
  parseMemberId,
  shareRowSchema,
  type ValidShare,
} from './share.ts'

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

/** 現存する clip だけを、渡された順で引く。**共有の参照は毎回ここを通る**（prd/02 §6）。 */
async function findClipsInOrder(ids: string[]): Promise<Clip[]> {
  if (ids.length === 0) return []
  const rows = await db.select().from(clips).where(inArray(clips.id, ids))

  // **壊れた行は落とす。** 共有の受け手には削除を促す導線が無いので、
  // 一覧（prd/02 §3.2）のように「壊れています」と見せる相手がいない。
  const byId = new Map<string, Clip>()
  for (const row of rows) {
    try {
      byId.set(row.id, toClip(row))
    } catch {
      console.error(`共有: 壊れた行を除外しました id=${row.id}`)
    }
  }

  // 消えた clip は自然に落ちる（JSON 列に外部キーは張れないが、それが望む挙動。prd/02 §6）。
  return ids.flatMap((id) => {
    const clip = byId.get(id)
    return clip ? [clip] : []
  })
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
    return serveBlob(c.req.header('If-None-Match'), c.req.param('id'), false)
  })

  /** ダウンロード用の別経路（prd/03 §3）。中身は同じで `Content-Disposition` だけが違う。 */
  .get('/clips/:id/download', sessionRequired, async (c) => {
    return serveBlob(c.req.header('If-None-Match'), c.req.param('id'), true)
  })

  /**
   * 共有の発行（prd/04 §3.1）。**選んだ clip だけを指す capability URL を作る。**
   *
   * 平文のトークンは**ここで一度だけ返す**。DB にはハッシュしか置かないので、
   * 後から同じ URL を組み立て直すことはできない（prd/02 §6）。
   */
  .post('/shares', sessionRequired, zValidator('json', createShareSchema), async (c) => {
    const { clipIds } = c.req.valid('json')

    // **存在しない ID を含んだまま発行しない。** 発行直後から欠けたマニフェストになり、
    // 「選んだのに渡っていない」が起きる。選択画面と DB がずれているので、やり直させる。
    const found = await findClipsInOrder(clipIds)
    if (found.length !== clipIds.length) {
      return c.json({ error: 'clip not found' } as const, 409)
    }

    // 期限切れの掃除はここで行う（cron を持ち込む規模ではない。prd/02 §6）。
    const now = new Date()
    await db.delete(shares).where(lt(shares.expiresAt, now))

    const token = newShareToken()
    const id = newShareId()
    const expiresAt = new Date(now.getTime() + SHARE_TTL_MS)

    await db.insert(shares).values({
      id,
      tokenHash: hashShareToken(token),
      clipIds,
      expiresAt,
      createdAt: now,
    })

    return c.json(
      { id, url: `${publicOrigin()}/s/${token}`, expiresAt: expiresAt.toISOString() } as const,
      201,
    )
  })

  /**
   * 失効（prd/04 §3.1）。**宛先は `id`** で、生のトークンを再送させない。
   *
   * `revokedAt` は持たず行を消す。10 分で消える行に履歴を残す意味がない（prd/02 §6）。
   */
  .delete('/shares/:id', sessionRequired, async (c) => {
    await db.delete(shares).where(eq(shares.id, c.req.param('id')))
    // 消えていれば目的は達している。**存在しなかった場合も 404 にしない**
    // （失効させたいだけなので、既に無いことは失敗ではない）。
    return c.json({ ok: true } as const)
  })

async function serveBlob(
  ifNoneMatch: string | undefined,
  id: string,
  asAttachment: boolean,
): Promise<Response> {
  const rows = await db.select().from(clips).where(eq(clips.id, id)).limit(1)
  const row = rows[0]
  if (!row) return new Response(null, { status: 404 })

  const clip = toClip(row)
  if (clip.kind !== 'image') return new Response(null, { status: 404 })

  const etag = blobETag(clip)

  /**
   * **手元にあるものがまだ有効なら、バイト列を送らない**（prd/02 §4.2）。
   *
   * ⚠ **この判定を DB を引いた後に置くことに意味がある。** 消えた clip はここへ来る前に
   * 404 で落ちるので、**削除は今までどおり即座に反映される**。`no-cache` は
   * 「使う前に必ず訊きに来い」であって、「キャッシュを持つな」ではない（blob-cache.ts）。
   *
   * 304 では本文を返さないので `Content-Type` / `Content-Length` も付けない。
   * 送るのはキャッシュを次も使わせるための ETag と `Cache-Control` だけ（RFC 9110 §15.4.5）。
   */
  if (matchesETag(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: cacheHeaders(etag) })
  }

  // **実体が無いのは起こりうる正常系**（削除の途中失敗。prd/02 §3.2）。共有経路（`/s/*`）と
  // 同じく 404 に畳む。畳まないと 500 になり、UI 側は `img` の失敗としてしか観測できないため
  // **「実体が失われた」と「サーバーが壊れた」を同じ見た目で出す**ことになる（prd/03 §2）。
  // ⚠ ストレージ障害はここで畳まない。500 のままにして、異常を異常として出す。
  const blob = await getBlobStore()
    .get(clip.blobKey)
    .catch((error: unknown) => {
      if (error instanceof BlobNotFoundError) return null
      throw error
    })
  if (!blob) return new Response(null, { status: 404 })

  const headers = cacheHeaders(etag)
  // **保存時にサーバーが判定した MIME**を使う（クライアント申告ではない。prd/02 §4.2）。
  headers.set('Content-Type', clip.mimeType)
  headers.set('Content-Length', String(clip.byteSize))
  // allowlist を通っていても、ブラウザの MIME 推測で別形式として解釈される余地を残さない。
  headers.set('X-Content-Type-Options', 'nosniff')

  if (asAttachment) {
    const name = clip.fileName ?? `clip-${clip.id}.${IMAGE_EXTENSIONS[clip.mimeType]}`
    // RFC 5987 の拡張値として符号化する。改行や `"` はもちろん、`'` `(` `)` `*` も
    // percent-encode されるのでヘッダを壊せない（content-disposition.ts）。
    headers.set('Content-Disposition', attachmentDisposition(name))
  }

  return new Response(blob.body, { headers })
}

/** 200 と 304 の**両方**に載せるヘッダ。片方に欠けると次回の検証が成立しない。 */
function cacheHeaders(etag: string): Headers {
  return new Headers({ ETag: etag, 'Cache-Control': BLOB_CACHE_CONTROL })
}

/**
 * 共有経路（prd/04 §3.1）。**ルート保護の唯一の例外**で、セッションを要求しない。
 *
 * ⚠ **`/api` の外に分けてある。** `/api/clips/:id/blob` に共有トークンも受け付ける形にすると、
 * 認証必須のはずのパスに無認証の抜け道が生え、**パスを見ただけでは保護の有無が判断できなくなる**。
 * 前段プロキシを使う配置でも、素通しにするのはこの1本だけで済む。
 */
export const shareRoutes = new Hono()
  /** マニフェスト。**改行区切りのメンバー URL だけ**を返す（prd/03 §6）。 */
  .get('/:token', async (c) => {
    const found = await findShare(c.req.param('token'))
    if (!found) return notFound()

    const clips = await findClipsInOrder(found.clipIds)
    return new Response(buildManifest(publicOrigin(), c.req.param('token'), clips), {
      // **マニフェストにも `attachment` を付ける**（prd/04 §3.1）。無認証・同一オリジンで
      // inline 表示させないという条件は、実体だけでなくこの経路にも掛かる。
      headers: sharedHeaders('text/plain; charset=utf-8', 'clip-share.txt'),
    })
  })

  /** 実体。テキストも画像も同じ口から返す。 */
  .get('/:token/:file', async (c) => {
    const found = await findShare(c.req.param('token'))
    if (!found) return notFound()

    const file = c.req.param('file')
    const id = parseMemberId(file)
    // **このトークンが指していない clip には届かない**（prd/04 §3.1）。
    if (!id || !found.clipIds.includes(id)) return notFound()

    const [clip] = await findClipsInOrder([id])
    if (!clip) return notFound()

    // **正規の名前と完全に一致しない要求は受け付けない。** 拡張子違いでも同じ実体が取れると、
    // 同じものを指す URL が何通りにもなる。capability URL 自体が鍵なので指し方は1通りに保つ。
    if (file !== memberFileName(clip)) return notFound()

    if (clip.kind === 'text') {
      // **`text/plain` に固定する。** 無認証かつ同一オリジンなので、HTML を貼った clip を
      // HTML として返すと stored XSS になる（prd/02 §4.1 が SVG を外したのと同じ理由）。
      return new Response(clip.text, {
        headers: sharedHeaders('text/plain; charset=utf-8', memberFileName(clip)),
      })
    }

    // **実体が無いのは起こりうる正常系**（削除の途中失敗。prd/02 §3.2）。
    // 一覧は「壊れています」と見せて削除を促せるが、共有の受け手にその導線は無い。
    // **他の 404 と同じ応答に畳む**（理由を区別しないという境界を保つ。prd/04 §3.1）。
    // ⚠ ストレージ障害はここで畳まない。500 のままにして、異常を異常として出す。
    const blob = await getBlobStore()
      .get(clip.blobKey)
      .catch((error: unknown) => {
        if (error instanceof BlobNotFoundError) return null
        throw error
      })
    if (!blob) return notFound()

    const headers = sharedHeaders(clip.mimeType, memberFileName(clip))
    headers.set('Content-Length', String(clip.byteSize))
    return new Response(blob.body, { headers })
  })

/** 有効な共有だけを返す。**期限切れは存在しないものとして扱う**（prd/04 §3.1）。 */
async function findShare(token: string): Promise<ValidShare | undefined> {
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.tokenHash, hashShareToken(token)), gt(shares.expiresAt, new Date())))
    .limit(1)

  const row = rows[0]
  if (!row) return undefined

  // **JSON 列の中身を実行時に確かめる**（prd/02 §6）。Drizzle の `$type<string[]>()` は
  // 静的な注釈にすぎず、壊れた行を素通しする。信じると `includes` などで例外になり、
  // **無認証の経路が 500 を返して**「理由を区別しない 404」という境界が崩れる。
  const parsed = shareRowSchema.safeParse(row)
  if (!parsed.success) {
    // **トークンは書かない**（prd/04 §3.1）。id だけで行は特定できる。
    console.error(`shares の行が壊れています (id=${row.id})`)
    return undefined
  }
  return parsed.data
}

/**
 * 見つからない場合の応答。**理由を区別しない。**
 *
 * 「トークンが無い」「期限切れ」「そのセットに含まれていない」を撃ち分けると、
 * **当たりのトークンかどうかを応答から判別できてしまう**。
 */
function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

function sharedHeaders(contentType: string, fileName?: string): Headers {
  const headers = new Headers({
    'Content-Type': contentType,
    // ブラウザの MIME 推測で別形式として解釈される余地を残さない（prd/02 §4.2）。
    'X-Content-Type-Options': 'nosniff',
    /**
     * **`no-store` は失効の一部である**（prd/04 §3.1）。
     *
     * 一度成功した応答がキャッシュに残ると、サーバーに問い合わせずに返される。その状態では
     * **期限を過ぎても行を消しても、同じ URL から中身が取り出せてしまう**。
     * `/api/*` と違い、この経路には cookie という再検証の機会が無い。
     * ⚠ `no-cache` では足りない（保存自体は許すため）。
     */
    'Cache-Control': 'no-store',
  })
  // ブラウザでの inline 描画を消す。**受け手（curl）の挙動は変わらない**（prd/04 §3.1）。
  if (fileName) headers.set('Content-Disposition', attachmentDisposition(fileName))
  return headers
}

/**
 * `/s/*` 用のロガー。**トークンを伏せる**（prd/04 §3.1）。
 *
 * トークンは URL のパスに載るので、素の `logger()` を当てると**標準出力に平文で残る**。
 * それは **DB にハッシュしか置かない防御を、ログ側から迂回できる**ということである。
 * 残す価値があるのは経路・成否・所要時間であって、トークンそのものではない。
 */
const shareLogger: MiddlewareHandler = async (c, next) => {
  const started = Date.now()
  await next()
  const shape = c.req.path.split('/').length > 3 ? '/s/<token>/<file>' : '/s/<token>'
  console.log(`  <-- ${c.req.method} ${shape}`)
  console.log(`  --> ${c.req.method} ${shape} ${c.res.status} ${Date.now() - started}ms`)
}

// 同一オリジン配信（prd/01 §5）。API は origin 直下の `/api`、共有は `/s` に置く。
// dev では web(Vite) の proxy が**どちらもパスを保持したまま**転送してくる（prd/01 §3）。
export const app = new Hono()

app.use('/api/*', logger())
// **`/s/*` に素の logger を当てない。** パスにトークンが載っている。
app.use('/s/*', shareLogger)

app.route('/api', routes)
app.route('/s', shareRoutes)

export type AppType = typeof routes
