import { hc } from 'hono/client'
import type { AppType } from 'server/app'

/**
 * API クライアント。**型は Hono RPC で server と共有する**（prd/01 §1）。
 *
 * ブラウザは常に**自オリジンの `/api`** を叩く。dev では Vite の proxy が、本番では前段が、
 * パスを保持したまま server へ転送する（prd/01 §5）。
 */
export const api = hc<AppType>('/api')
