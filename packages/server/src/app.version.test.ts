import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/version`（prd/06 §3「ビルドの版」）: **認証なし・DB に触れずに**、イメージの ENV の版を返す。
 *
 * app.ts は読み込んだ時点の env で版を読むので、env を差し替えてからモジュールを読み直す。
 *
 * DB は「触れたら記録する」ものに差し替える。実接続を要求すると、**DB が落ちているときにも
 * 版が読める**という性質（デプロイの確認に使う理由そのもの）が試されないまま残る。
 */
const state = vi.hoisted(() => ({ dbTouched: [] as string[] }))

vi.mock('./db/index.ts', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, property) => {
        state.dbTouched.push(String(property))
        throw new Error(`DB に触れました: ${String(property)}`)
      },
    },
  ),
}))

const SHA = 'aa0922b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7'

async function loadApp(env: Record<string, string>) {
  // 手元やCI の env に同名の値があっても持ち込まない。
  for (const name of ['GIT_COMMIT', 'BUILD_TIME', 'GIT_DIRTY']) vi.stubEnv(name, undefined)
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  vi.resetModules()
  state.dbTouched = []
  const { app } = await import('./app.ts')
  return app
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/version', () => {
  it('ビルド引数の値を返す', async () => {
    const app = await loadApp({
      GIT_COMMIT: SHA,
      BUILD_TIME: '2026-10-30T01:02:03Z',
      GIT_DIRTY: 'true',
    })

    const response = await app.request('/api/version')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      commit: SHA,
      builtAt: '2026-10-30T01:02:03.000Z',
      dirty: true,
    })
  })

  it('ビルド引数が無ければ unknown', async () => {
    const app = await loadApp({})

    const response = await app.request('/api/version')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ commit: 'unknown', builtAt: 'unknown', dirty: false })
  })

  /**
   * **`SESSION_SECRET` を与えない**のが要点である。セッションを確かめる経路は鍵が無いと
   * 例外になる（auth.ts）ので、200 が返ること自体が「cookie を読みに行っていない」証拠になる。
   */
  it('cookie が付いていても、セッションにも DB にも触れない', async () => {
    vi.stubEnv('SESSION_SECRET', undefined)
    const app = await loadApp({})

    const response = await app.request('/api/version', {
      headers: { Cookie: 'clip_session=whatever' },
    })

    expect(response.status).toBe(200)
    expect(state.dbTouched).toEqual([])
  })

  it('対照: 認証が要る経路は、同じ条件で 200 を返さない', async () => {
    const app = await loadApp({ SESSION_SECRET: 'test-secret-that-is-long-enough' })

    const response = await app.request('/api/clips')

    expect(response.status).toBe(401)
  })
})
