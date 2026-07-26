import { afterEach, describe, expect, it } from 'vitest'
import { publicOrigin } from './origin.ts'

const original = process.env.PUBLIC_ORIGIN

afterEach(() => {
  if (original === undefined) {
    delete process.env.PUBLIC_ORIGIN
  } else {
    process.env.PUBLIC_ORIGIN = original
  }
})

describe('publicOrigin', () => {
  it('未設定ならローカル dev の既定値を返す', () => {
    delete process.env.PUBLIC_ORIGIN
    expect(publicOrigin()).toBe('http://localhost:5173')
  })

  it('空白だけの設定は未設定として扱う', () => {
    process.env.PUBLIC_ORIGIN = '   '
    expect(publicOrigin()).toBe('http://localhost:5173')
  })

  it('設定されていればそのオリジンを返す', () => {
    process.env.PUBLIC_ORIGIN = 'https://example.test'
    expect(publicOrigin()).toBe('https://example.test')
  })

  it('末尾のスラッシュを落とす', () => {
    // 残すと `//s/<token>` になり、前段のパス判定から外れうる。
    process.env.PUBLIC_ORIGIN = 'https://example.test/'
    expect(publicOrigin()).toBe('https://example.test')
  })

  it('パスやクエリが付いていてもオリジンだけを取る', () => {
    process.env.PUBLIC_ORIGIN = 'https://example.test/app?x=1'
    expect(publicOrigin()).toBe('https://example.test')
  })

  it('ポート付きを保つ', () => {
    process.env.PUBLIC_ORIGIN = 'http://example.test:8301'
    expect(publicOrigin()).toBe('http://example.test:8301')
  })

  it('URL として不正なら例外にする', () => {
    // 壊れた値から組んだリンクは、届かないまま黙って発行される（prd/01 §4）。
    process.env.PUBLIC_ORIGIN = 'not a url'
    expect(() => publicOrigin()).toThrow(/PUBLIC_ORIGIN/)
  })

  it('http / https 以外のスキームを拒む', () => {
    process.env.PUBLIC_ORIGIN = 'ftp://example.test'
    expect(() => publicOrigin()).toThrow(/PUBLIC_ORIGIN/)
  })
})
