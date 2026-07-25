import { describe, expect, it } from 'vitest'
import { clipSchema, MAX_IMAGE_BYTES, toClip } from './clip.ts'
import type { ClipRow } from './db/schema.ts'

const baseRow = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  createdAt: new Date('2026-07-26T00:00:00Z'),
  text: null,
  blobKey: null,
  mimeType: null,
  byteSize: null,
  fileName: null,
} satisfies Omit<ClipRow, 'kind'>

describe('toClip', () => {
  it('text の行をテキストのエントリに変換する', () => {
    const clip = toClip({ ...baseRow, kind: 'text', text: 'hello' })

    expect(clip).toEqual({
      id: baseRow.id,
      createdAt: baseRow.createdAt,
      kind: 'text',
      text: 'hello',
    })
  })

  it('image の行を画像のエントリに変換する', () => {
    const clip = toClip({
      ...baseRow,
      kind: 'image',
      blobKey: `clips/${baseRow.id}`,
      mimeType: 'image/png',
      byteSize: 1234,
      fileName: 'shot.png',
    })

    expect(clip).toMatchObject({ kind: 'image', mimeType: 'image/png', byteSize: 1234 })
  })

  it('ペースト由来で fileName が無くても変換できる', () => {
    const clip = toClip({
      ...baseRow,
      kind: 'image',
      blobKey: `clips/${baseRow.id}`,
      mimeType: 'image/png',
      byteSize: 1,
      fileName: null,
    })

    expect(clip).toMatchObject({ kind: 'image', fileName: null })
  })

  it('text なのに画像側の列に値が入った行は例外にする（同居させない・prd/02 §1）', () => {
    expect(() =>
      toClip({ ...baseRow, kind: 'text', text: 'hello', blobKey: `clips/${baseRow.id}` }),
    ).toThrow(/壊れています/)
  })

  it('image なのに text に値が入った行は例外にする（同居させない・prd/02 §1）', () => {
    expect(() =>
      toClip({
        ...baseRow,
        kind: 'image',
        text: 'hello',
        blobKey: `clips/${baseRow.id}`,
        mimeType: 'image/png',
        byteSize: 1,
      }),
    ).toThrow(/壊れています/)
  })

  it('image なのに blobKey が無い行は例外にする（黙って落とさない）', () => {
    // 作成の途中失敗で実体を失った残骸。prd/02 §3.2 は「気づける異常」としてこれを選んでいるので、
    // 握り潰すと一覧から無言で消えてしまい、その選択が無意味になる。
    expect(() => toClip({ ...baseRow, kind: 'image', mimeType: 'image/png', byteSize: 1 })).toThrow(
      /壊れています/,
    )
  })
})

describe('clipSchema', () => {
  const image = {
    id: baseRow.id,
    createdAt: baseRow.createdAt,
    kind: 'image' as const,
    blobKey: 'clips/x',
    byteSize: 1,
    fileName: null,
  }

  it('SVG は受け付けない（能動コンテンツ・prd/02 §4.1）', () => {
    expect(clipSchema.safeParse({ ...image, mimeType: 'image/svg+xml' }).success).toBe(false)
  })

  it('allowlist 外の形式は受け付けない', () => {
    expect(clipSchema.safeParse({ ...image, mimeType: 'application/pdf' }).success).toBe(false)
  })

  it('上限を超える画像は受け付けない（prd/02 §5）', () => {
    expect(
      clipSchema.safeParse({ ...image, mimeType: 'image/png', byteSize: MAX_IMAGE_BYTES + 1 })
        .success,
    ).toBe(false)
  })

  it('上限ちょうどは受け付ける', () => {
    expect(
      clipSchema.safeParse({ ...image, mimeType: 'image/png', byteSize: MAX_IMAGE_BYTES }).success,
    ).toBe(true)
  })
})
