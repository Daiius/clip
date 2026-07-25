import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'

/** セッション cookie（prd/04 §2）。 */
export const SESSION_COOKIE_NAME = 'clip_session'
/** 30 日固定（スライディングなし。prd/04 §2）。 */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30

/**
 * 定数時間比較（prd/04 §2「照合の方法」）。
 *
 * **`timingSafeEqual` に文字列を Buffer 化してそのまま渡さない。** この API は長さの異なる
 * Buffer で `false` ではなく**例外を投げる**ため、素直に実装すると長さ違いの誤入力
 * （最も普通の打ち間違い）が 401 ではなく 500 になり、応答の違いから「長さが合っているか」が
 * 判別できてしまう。SHA-256 で固定長にしてから渡し、例外の経路そのものを無くす。
 */
function safeEqual(input: string, expected: string): boolean {
  const inputHash = createHash('sha256').update(input, 'utf8').digest()
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(inputHash, expectedHash)
}

/**
 * ユーザー名とパスワードを env の資格情報と照合する。
 *
 * **両方を必ず評価してから AND する。** 片方が違った時点で return すると、
 * ユーザー名が合っているかどうかが応答時間に出る（prd/04 §2）。
 */
export function verifyCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.AUTH_USERNAME
  const expectedPassword = process.env.AUTH_PASSWORD
  if (!expectedUsername || !expectedPassword) return false

  const usernameMatches = safeEqual(username, expectedUsername)
  const passwordMatches = safeEqual(password, expectedPassword)
  return usernameMatches && passwordMatches
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required')
  return secret
}

/** 前段プロキシが TLS を終端する配置では true（prd/01 §4）。 */
function isSecureCookie(): boolean {
  return process.env.COOKIE_SECURE === 'true'
}

/**
 * セッション cookie を発行する。値は発行時刻（ms）で、**HMAC 署名 + 発行時刻埋め込みで stateless**。
 * サーバ側にセッションを持たないので、失効は有効期限のみで表現する（prd/04 §2）。
 */
export async function issueSession(c: Context): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE_NAME, Date.now().toString(), getSessionSecret(), {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'Lax',
    // web は origin 直下、API は origin 直下の /api に配信する（prd/01 §5）。
    // `/` 以外にすると web か /api の一方に cookie が届かず、ログイン直後から 401 になる。
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  })
}

export function revokeSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', secure: isSecureCookie() })
}

/** 署名が正しく、発行から 30 日以内なら true。 */
export async function hasValidSession(c: Context): Promise<boolean> {
  const value = await getSignedCookie(c, getSessionSecret(), SESSION_COOKIE_NAME)
  if (!value) return false

  const issuedAt = Number(value)
  if (!Number.isFinite(issuedAt)) return false
  return Date.now() - issuedAt < SESSION_MAX_AGE_SEC * 1000
}

/**
 * ログイン必須のミドルウェア。
 *
 * **`/api/auth/*` を除く全ての API に掛ける**（画像の取得も含む。prd/04 §3）。
 * ここを「画像くらいは素通しでいい」と緩めると、前段プロキシに依存しないという前提が崩れる。
 */
export const sessionRequired: MiddlewareHandler = async (c, next) => {
  if (!(await hasValidSession(c))) return c.body(null, 401)
  await next()
}
