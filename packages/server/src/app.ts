import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { z } from 'zod'
import { hasValidSession, issueSession, revokeSession, verifyCredentials } from './auth.ts'

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
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
  .post('/auth/login', zValidator('json', loginSchema), async (c) => {
    const { username, password } = c.req.valid('json')

    // 失敗の理由（ユーザー名 / パスワード / 長さ）で応答を変えない（prd/04 §2）。
    if (!verifyCredentials(username, password)) {
      return c.json({ error: 'invalid credentials' } as const, 401)
    }
    await issueSession(c)
    return c.json({ ok: true } as const)
  })
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
