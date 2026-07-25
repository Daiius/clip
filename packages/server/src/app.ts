import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import { z } from 'zod'
import { hasValidSession, issueSession, revokeSession, verifyCredentials } from './auth.ts'

/**
 * ログイン要求の上限（prd/04 §2）。**未認証で叩ける口なので、単一リクエストの資源上限を持つ。**
 *
 * 試行**回数**の制限（レート制限）は MVP 外だが（issue #3）、それとは別に
 * **1本あたりが際限なく大きくなること**は防ぐ。巨大な JSON を送りつけられると、body の保持と
 * 解析、そして同期的な SHA-256 計算でメモリとイベントループを占有できてしまう。
 * 前段プロキシの設定だけに頼らず、アプリ側でも強制する（§1）。
 */
const LOGIN_BODY_LIMIT_BYTES = 4 * 1024

const loginSchema = z.object({
  username: z.string().max(256),
  password: z.string().max(1024),
})

/**
 * API のルート定義。web はこの型を Hono RPC 経由で共有する（prd/01 §1）。
 *
 * 認証が要らないのは `/auth/*` だけで、**それ以外は全て `sessionRequired` を通す**
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

// 同一オリジン配信のため、API は origin 直下の `/api` に置く（prd/01 §5）。
// dev では web(Vite) の proxy が `/api` をパスを保持したまま転送してくる。
export const app = new Hono().basePath('/api')

app.use('*', logger())
app.route('/', routes)

export type AppType = typeof routes
