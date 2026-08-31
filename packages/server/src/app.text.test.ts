import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * テキストの投入で**改行が書き換わらないこと**（prd/03 §1.1）。
 *
 * ルート越しに試す理由は、**壊していたのが multipart の直列化そのもの**だからである。
 * 文字列フィールドの改行は仕様で CRLF に正規化されるため、送信と解釈を通さないと再現しない
 * （純粋な関数に切り出すと、まさに壊れる工程が抜け落ちる）。
 *
 * DB は差し替える。実接続を要求すると、この分岐が試されないまま残る。
 */
const state = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[] }))

vi.mock('./db/index.ts', () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        state.inserted.push(row)
        return Promise.resolve()
      },
    }),
  },
}))

const { routes } = await import('./app.ts')

/** LF で書かれたシェルスクリプト。CR が 1 つでも混ざれば実行時に壊れる。 */
const SCRIPT = '#!/bin/bash\nset -eu\necho hi\n'

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

async function post(form: FormData): Promise<Response> {
  return routes.request('/clips', {
    method: 'POST',
    headers: { Cookie: await login() },
    body: form,
  })
}

beforeEach(() => {
  vi.stubEnv('AUTH_USERNAME', 'tester')
  vi.stubEnv('AUTH_PASSWORD', 'correct horse battery staple')
  vi.stubEnv('SESSION_SECRET', 'test-secret-that-is-long-enough')
  vi.stubEnv('COOKIE_SECURE', 'false')
  state.inserted = []
})

describe('POST /clips のテキスト', () => {
  it('Blob パートで送られた LF は LF のまま保存される', async () => {
    const form = new FormData()
    form.set('text', new Blob([SCRIPT], { type: 'text/plain' }), 'clip.txt')

    const response = await post(form)

    expect(response.status).toBe(201)
    expect(state.inserted[0]?.text).toBe(SCRIPT)
  })

  it('元から CRLF のものは CRLF のまま保存される（正規化しない）', async () => {
    const crlf = SCRIPT.replaceAll('\n', '\r\n')
    const form = new FormData()
    form.set('text', new Blob([crlf], { type: 'text/plain' }), 'clip.txt')

    const response = await post(form)

    expect(response.status).toBe(201)
    expect(state.inserted[0]?.text).toBe(crlf)
  })

  /**
   * ⚠ **この経路は改行が CRLF になる。** それでも受け続けるのは、web とサーバーが別々に
   * 置き換わるためで、**更新前のタブからの投入を 400 で落とさない**ことを優先する。
   */
  it('文字列フィールドでの投入も受け付ける（更新前のタブ）', async () => {
    const form = new FormData()
    form.set('text', SCRIPT)

    const response = await post(form)

    expect(response.status).toBe(201)
    expect(state.inserted[0]?.text).toBe(SCRIPT.replaceAll('\n', '\r\n'))
  })

  it('空のテキストは投入にならない', async () => {
    const form = new FormData()
    form.set('text', new Blob([''], { type: 'text/plain' }), 'clip.txt')

    const response = await post(form)

    expect(response.status).toBe(400)
    expect(state.inserted).toHaveLength(0)
  })
})
