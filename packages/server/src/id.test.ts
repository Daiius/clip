import { describe, expect, it } from 'vitest'
import { newClipId } from './id.ts'

describe('newClipId', () => {
  it('ULID の長さ（26 文字）で返る', () => {
    expect(newClipId()).toHaveLength(26)
  })

  it('連続して生成しても辞書順に増加する（同一ミリ秒でも単調）', () => {
    // 一覧の並びとページングを id 単独で成立させているため、ここが崩れると
    // ページ境界で行が重複・欠落する（prd/02 §2）。
    const ids = Array.from({ length: 1000 }, () => newClipId())
    const sorted = [...ids].sort()

    expect(ids).toEqual(sorted)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
