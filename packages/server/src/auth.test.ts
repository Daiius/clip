import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isWithinSessionLifetime, SESSION_MAX_AGE_SEC, verifyCredentials } from './auth.ts'

const USERNAME = 'me'
const PASSWORD = 'a-32-chars-or-longer-random-string-x'

describe('verifyCredentials', () => {
  beforeEach(() => {
    process.env.AUTH_USERNAME = USERNAME
    process.env.AUTH_PASSWORD = PASSWORD
  })

  afterEach(() => {
    process.env.AUTH_USERNAME = undefined
    process.env.AUTH_PASSWORD = undefined
  })

  it('両方一致すれば true', () => {
    expect(verifyCredentials(USERNAME, PASSWORD)).toBe(true)
  })

  it('ユーザー名が違えば false', () => {
    expect(verifyCredentials('other', PASSWORD)).toBe(false)
  })

  it('パスワードが違えば false', () => {
    expect(verifyCredentials(USERNAME, 'wrong-but-same-length-padding-xxxxx')).toBe(false)
  })

  it('長さが違っても例外にならず false を返す（prd/04 §2）', () => {
    // timingSafeEqual に文字列をそのまま渡す実装だと、ここで例外が飛んで 500 になる。
    // 応答の違いから「長さが合っているか」を判別できてしまうため、必ず false で返す。
    expect(() => verifyCredentials(USERNAME, 'short')).not.toThrow()
    expect(verifyCredentials(USERNAME, 'short')).toBe(false)
    expect(verifyCredentials(USERNAME, `${PASSWORD}-and-more-and-more-and-more`)).toBe(false)
    expect(verifyCredentials('', '')).toBe(false)
  })

  it('マルチバイト文字を含んでも例外にならない', () => {
    expect(() => verifyCredentials('ユーザー', 'パスワード')).not.toThrow()
    expect(verifyCredentials('ユーザー', 'パスワード')).toBe(false)
  })

  it('資格情報が env に無ければ常に false（空文字で通さない）', () => {
    process.env.AUTH_USERNAME = undefined
    process.env.AUTH_PASSWORD = undefined
    expect(verifyCredentials('', '')).toBe(false)
    expect(verifyCredentials(USERNAME, PASSWORD)).toBe(false)
  })
})

describe('isWithinSessionLifetime', () => {
  const NOW = new Date('2026-07-26T00:00:00Z').getTime()
  const MAX_AGE_MS = SESSION_MAX_AGE_SEC * 1000

  it('発行直後は有効', () => {
    expect(isWithinSessionLifetime(NOW, NOW)).toBe(true)
  })

  it('30 日ちょうどで失効する（スライディングしない）', () => {
    expect(isWithinSessionLifetime(NOW - MAX_AGE_MS + 1, NOW)).toBe(true)
    expect(isWithinSessionLifetime(NOW - MAX_AGE_MS, NOW)).toBe(false)
    expect(isWithinSessionLifetime(NOW - MAX_AGE_MS * 2, NOW)).toBe(false)
  })

  it('未来に発行された cookie は受理しない', () => {
    // 上限だけを見ると経過時間が負になって素通りする。サーバー時計が進んだ状態で発行した後に
    // 時刻が戻ると、そのずれの分だけ期限が延びてしまう。
    expect(isWithinSessionLifetime(NOW + 10 * 60 * 1000, NOW)).toBe(false)
    expect(isWithinSessionLifetime(NOW + MAX_AGE_MS, NOW)).toBe(false)
  })

  it('わずかな時計の巻き戻り（60 秒以内）は許容する', () => {
    expect(isWithinSessionLifetime(NOW + 30 * 1000, NOW)).toBe(true)
    expect(isWithinSessionLifetime(NOW + 61 * 1000, NOW)).toBe(false)
  })
})
