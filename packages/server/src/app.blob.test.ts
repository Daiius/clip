import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipRow } from './db/schema.ts'

/**
 * 画像配信（`/clips/:id/blob`）の条件付き GET（prd/02 §4.2）。
 *
 * **ここだけルート越しに試す。** 見たいのは「DB の行」「S3 の実体」「`If-None-Match`」という
 * **3つの状態の組み合わせ**で決まる応答であり、純粋な関数に切り出せない
 * （切り出せる部分は `blob-cache.test.ts` にある）。
 *
 * DB は差し替える。実接続を要求すると、**最も壊れやすい分岐がテストされないまま残る**。
 */
const state = vi.hoisted(() => ({ rows: [] as ClipRow[] }))

vi.mock('./db/index.ts', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(state.rows) }),
      }),
    }),
  },
}))

const { BlobNotFoundError } = await import('./blob-store.ts')
const { routes, setBlobStore } = await import('./app.ts')

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const BYTE_SIZE = 1234
const ETAG = `"${ID}-${BYTE_SIZE}"`

const imageRow: ClipRow = {
  id: ID,
  kind: 'image',
  createdAt: new Date('2026-07-29T00:00:00Z'),
  text: null,
  blobKey: `clips/${ID}`,
  mimeType: 'image/png',
  byteSize: BYTE_SIZE,
  fileName: null,
}

/** 実体の有無を切り替えられる差し替え用のストア。 */
function fakeStore(present: boolean) {
  return {
    put: async () => {},
    get: async (key: string) => {
      if (!present) throw new BlobNotFoundError(key)
      return { body: new Blob([new Uint8Array(BYTE_SIZE)]).stream() }
    },
    exists: async () => present,
    delete: async () => {},
  }
}

/** 署名済みのセッション cookie を、実際にログインして手に入れる。 */
async function login(): Promise<string> {
  const response = await routes.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'correct horse battery staple' }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('Set-Cookie')?.split(';')[0]
  if (!cookie) throw new Error('セッション cookie が発行されませんでした')
  return cookie
}

async function getBlob(cookie: string, ifNoneMatch?: string): Promise<Response> {
  return routes.request(`/clips/${ID}/blob`, {
    headers: {
      Cookie: cookie,
      ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}),
    },
  })
}

beforeEach(() => {
  vi.stubEnv('AUTH_USERNAME', 'tester')
  vi.stubEnv('AUTH_PASSWORD', 'correct horse battery staple')
  vi.stubEnv('SESSION_SECRET', 'test-secret-that-is-long-enough')
  vi.stubEnv('COOKIE_SECURE', 'false')
  state.rows = [imageRow]
  setBlobStore(fakeStore(true))
})

describe('GET /clips/:id/blob の条件付き GET', () => {
  it('初回は 200 で、ETag と Cache-Control が付く', async () => {
    const response = await getBlob(await login())

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe(ETAG)
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(response.headers.get('Content-Type')).toBe('image/png')
  })

  it('ETag が一致したら 304 を本文なしで返す', async () => {
    const response = await getBlob(await login(), ETAG)

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    // 次回の検証に要るヘッダは 304 にも載せる。
    expect(response.headers.get('ETag')).toBe(ETAG)
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    // 本文が無いので付けない（RFC 9110 §15.4.5）。
    expect(response.headers.get('Content-Length')).toBeNull()
    expect(response.headers.get('Content-Type')).toBeNull()
  })

  it('ETag が古ければ 200 で本文を返す', async () => {
    const response = await getBlob(await login(), '"stale"')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe(String(BYTE_SIZE))
  })

  /**
   * **キャッシュが「壊れた項目」を覆い隠さないこと**（prd/02 §3.2）。
   *
   * 削除は「S3 の実体 → DB 行」の順なので、S3 の削除に成功して DB 行の削除に失敗すると
   * **実体を失った行**が残る。行だけを見て 304 を返すと、ブラウザは手元の古い画像を
   * 正常なものとして使い続け、**気づける異常を選んだ意味が無くなる**。
   */
  it('行が残っていても実体が消えていれば、ETag 一致でも 304 にせず 404 を返す', async () => {
    setBlobStore(fakeStore(false))

    const response = await getBlob(await login(), ETAG)

    expect(response.status).toBe(404)
  })

  it('実体が消えていれば、条件付きでない取得も 500 ではなく 404 を返す', async () => {
    setBlobStore(fakeStore(false))

    const response = await getBlob(await login())

    expect(response.status).toBe(404)
  })

  /** ⚠ **在庫確認の失敗を「無い」に畳まない。** 障害は異常として出す（500）。 */
  it('ストレージ障害は 404 に畳まず、そのまま失敗させる', async () => {
    setBlobStore({
      ...fakeStore(true),
      exists: async () => {
        throw new Error('storage is down')
      },
    })

    const response = await getBlob(await login(), ETAG)

    expect(response.status).toBe(500)
  })

  it('行そのものが消えていれば、ETag が一致しても 404（削除は即座に反映される）', async () => {
    state.rows = []

    const response = await getBlob(await login(), ETAG)

    expect(response.status).toBe(404)
  })

  it('未認証では 304 の抜け道を作らない', async () => {
    const response = await routes.request(`/clips/${ID}/blob`, {
      headers: { 'If-None-Match': ETAG },
    })

    expect(response.status).toBe(401)
  })
})
