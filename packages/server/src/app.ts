import { Hono } from 'hono'
import { logger } from 'hono/logger'

// 同一オリジン配信のため、API は origin 直下の `/api` に置く（prd/01 §5）。
// dev では web(Vite) の proxy が `/api` をパスを保持したまま転送してくる。
export const app = new Hono().basePath('/api')

app.use('*', logger())

// 起動確認用。compose の各サービスが立ち上がったかをブラウザから見るためだけのもの。
app.get('/health', (c) => c.json({ ok: true } as const))

export type AppType = typeof app
