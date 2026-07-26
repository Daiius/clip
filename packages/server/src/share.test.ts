import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Clip } from './clip.ts'
import { MAX_SHARE_CLIPS } from './limits.ts'
import {
  buildManifest,
  createShareSchema,
  hashShareToken,
  memberFileName,
  newShareToken,
  parseMemberId,
  shareRowSchema,
} from './share.ts'

const ID = '01KYDF5KC3G0KCAQAPHWBNKVKD'
const OTHER_ID = '01KYDEFVAHVFNYP3JHTKYXHMYV'

const textClip = (id = ID): Clip => ({
  id,
  kind: 'text',
  text: 'hello',
  createdAt: new Date('2026-07-26T00:00:00Z'),
})

const imageClip = (mimeType: 'image/png' | 'image/jpeg' = 'image/png', id = ID): Clip => ({
  id,
  kind: 'image',
  blobKey: `clips/${id}`,
  mimeType,
  byteSize: 70,
  fileName: null,
  createdAt: new Date('2026-07-26T00:00:00Z'),
})

describe('newShareToken', () => {
  it('base64url で 256 ビット分の長さになる', () => {
    // ここだけが /s/* の防壁なので、短くなっていないことを固定する（prd/04 §3.1）。
    const token = newShareToken()
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('毎回異なる', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newShareToken()))
    expect(tokens.size).toBe(100)
  })
})

describe('hashShareToken', () => {
  it('SHA-256 の hex を返す（列の char(64) と一致する）', () => {
    const token = 'test-token'
    expect(hashShareToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hashShareToken(token)).toHaveLength(64)
  })

  it('トークンそのものを含まない', () => {
    // DB が漏れても生きた共有 URL を組み立てられないことが要件（prd/02 §6）。
    const token = newShareToken()
    expect(hashShareToken(token)).not.toContain(token)
  })
})

describe('createShareSchema', () => {
  it('1 件以上・上限まで受け付ける', () => {
    expect(createShareSchema.safeParse({ clipIds: [ID] }).success).toBe(true)

    const ids = Array.from({ length: MAX_SHARE_CLIPS }, (_, i) => String(i).padStart(26, '0'))
    expect(createShareSchema.safeParse({ clipIds: ids }).success).toBe(true)
  })

  it('空と上限超過を拒む', () => {
    expect(createShareSchema.safeParse({ clipIds: [] }).success).toBe(false)

    const tooMany = Array.from({ length: MAX_SHARE_CLIPS + 1 }, (_, i) =>
      String(i).padStart(26, '0'),
    )
    expect(createShareSchema.safeParse({ clipIds: tooMany }).success).toBe(false)
  })

  it('重複を拒む', () => {
    // 同じ clip が 2 行出ても受け手に得が無く、上限の意味も薄れる。
    expect(createShareSchema.safeParse({ clipIds: [ID, ID] }).success).toBe(false)
  })

  it('ULID の長さでないものを拒む', () => {
    expect(createShareSchema.safeParse({ clipIds: ['short'] }).success).toBe(false)
  })
})

describe('shareRowSchema', () => {
  it('正しい行を通す', () => {
    expect(shareRowSchema.safeParse({ id: ID, clipIds: [ID, OTHER_ID] }).success).toBe(true)
    // 対象が全部消えた共有は空配列になりうる（マニフェストが空になるだけで、壊れてはいない）。
    expect(shareRowSchema.safeParse({ id: ID, clipIds: [] }).success).toBe(true)
  })

  it('JSON 列が配列でない行を弾く', () => {
    // DB は構造を保証しない。信じると includes などで例外になり、
    // **無認証の経路が 500 を返す**（理由を区別しない 404 という境界が崩れる）。
    for (const clipIds of [null, 'not-an-array', 42, { 0: ID }]) {
      expect(shareRowSchema.safeParse({ id: ID, clipIds }).success, String(clipIds)).toBe(false)
    }
  })

  it('要素が ULID の形でない行を弾く', () => {
    expect(shareRowSchema.safeParse({ id: ID, clipIds: ['short'] }).success).toBe(false)
    expect(shareRowSchema.safeParse({ id: ID, clipIds: [null] }).success).toBe(false)
  })

  it('上限を超えた行を弾く', () => {
    const ids = Array.from({ length: MAX_SHARE_CLIPS + 1 }, (_, i) => String(i).padStart(26, '0'))
    expect(shareRowSchema.safeParse({ id: ID, clipIds: ids }).success).toBe(false)
  })
})

describe('memberFileName', () => {
  it('種別に応じた拡張子を付ける', () => {
    expect(memberFileName(textClip())).toBe(`${ID}.txt`)
    expect(memberFileName(imageClip('image/png'))).toBe(`${ID}.png`)
    expect(memberFileName(imageClip('image/jpeg'))).toBe(`${ID}.jpg`)
  })
})

describe('parseMemberId', () => {
  it('正しい形から id を取り出す', () => {
    expect(parseMemberId(`${ID}.png`)).toBe(ID)
    expect(parseMemberId(`${ID}.txt`)).toBe(ID)
  })

  it('形が違えば null', () => {
    expect(parseMemberId(ID)).toBeNull() // 拡張子なし
    expect(parseMemberId('short.png')).toBeNull()
    expect(parseMemberId(`${ID}x.png`)).toBeNull()
  })

  it('ULID に使わない文字を弾く', () => {
    // Crockford base32 は I / L / O / U を使わない。DB へ問い合わせる前に落とす。
    expect(parseMemberId(`${'I'.repeat(26)}.png`)).toBeNull()
    expect(parseMemberId(`${'l'.repeat(26)}.png`)).toBeNull()
    expect(parseMemberId(`${'U'.repeat(26)}.png`)).toBeNull()
  })

  it('パスを含む名前を弾く', () => {
    expect(parseMemberId('../../etc/passwd')).toBeNull()
    expect(parseMemberId(`${ID}/../other.png`)).toBeNull()
  })
})

describe('buildManifest', () => {
  it('改行区切りの絶対 URL を返す', () => {
    const manifest = buildManifest('https://example.test', 'TOKEN', [
      imageClip('image/png', ID),
      textClip(OTHER_ID),
    ])

    expect(manifest).toBe(
      `https://example.test/s/TOKEN/${ID}.png\nhttps://example.test/s/TOKEN/${OTHER_ID}.txt`,
    )
  })

  it('空なら空文字（改行だけの行を作らない）', () => {
    expect(buildManifest('https://example.test', 'TOKEN', [])).toBe('')
  })

  it('末尾に改行を付けない', () => {
    // `xargs -n1 curl -O` に流したときに空の URL を作らせない。
    const manifest = buildManifest('https://example.test', 'TOKEN', [imageClip()])
    expect(manifest.endsWith('\n')).toBe(false)
  })
})
