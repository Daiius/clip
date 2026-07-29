import { describe, expect, it } from 'vitest'
import { BLOB_CACHE_CONTROL, blobETag, matchesETag } from './blob-cache.ts'

const clip = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', byteSize: 1234 }

describe('BLOB_CACHE_CONTROL', () => {
  it('no-store ではなく no-cache（削除は反映しつつ再転送だけを消す・prd/02 §4.2）', () => {
    expect(BLOB_CACHE_CONTROL).toContain('no-cache')
    expect(BLOB_CACHE_CONTROL).not.toContain('no-store')
  })

  it('private である（private データを共有キャッシュに載せない）', () => {
    expect(BLOB_CACHE_CONTROL).toContain('private')
    expect(BLOB_CACHE_CONTROL).not.toContain('public')
  })
})

describe('blobETag', () => {
  it('引用符で囲む（裸の値は ETag として不正）', () => {
    expect(blobETag(clip)).toBe('"01ARZ3NDEKTSV4RRFFQ69G5FAV-1234"')
  })

  it('id が同じでも byteSize が違えば別の ETag になる', () => {
    expect(blobETag({ ...clip, byteSize: 1235 })).not.toBe(blobETag(clip))
  })

  it('別の clip とは一致しない', () => {
    expect(blobETag({ ...clip, id: '01ARZ3NDEKTSV4RRFFQ69G5FAW' })).not.toBe(blobETag(clip))
  })
})

describe('matchesETag', () => {
  const etag = blobETag(clip)

  it('ヘッダが無ければ一致しない（初回の取得）', () => {
    expect(matchesETag(undefined, etag)).toBe(false)
  })

  it('同じ ETag なら一致する', () => {
    expect(matchesETag(etag, etag)).toBe(true)
  })

  it('別の ETag なら一致しない', () => {
    expect(matchesETag('"other"', etag)).toBe(false)
  })

  it('W/ 付き（弱い比較）でも一致する', () => {
    expect(matchesETag(`W/${etag}`, etag)).toBe(true)
  })

  it('複数並んでいて1つでも一致すれば真', () => {
    expect(matchesETag(`"a", W/"b", ${etag}`, etag)).toBe(true)
  })

  it('複数並んでいてどれも一致しなければ偽', () => {
    expect(matchesETag('"a", W/"b"', etag)).toBe(false)
  })

  it('* は存在するだけで一致する（RFC 9110 §13.1.2）', () => {
    expect(matchesETag('*', etag)).toBe(true)
  })

  it('空文字は一致しない', () => {
    expect(matchesETag('', etag)).toBe(false)
  })

  it('前後の空白は無視する', () => {
    expect(matchesETag(`  ${etag}  `, etag)).toBe(true)
  })
})
