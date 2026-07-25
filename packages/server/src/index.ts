import { serve } from '@hono/node-server'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? 4000)

// ホストにポートを出さず、compose 網内でだけ待ち受ける（prd/01 §3）。
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`server listening on :${info.port}`)
})
