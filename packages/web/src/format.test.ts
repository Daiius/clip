import { describe, expect, it } from 'vitest'
import { countCharacters, formatBytes, textByteLength } from './format.ts'

describe('formatBytes', () => {
  it('1024 未満はバイトのまま出す', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(70)).toBe('70 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('1024 以上は KB にする', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(38907)).toBe('38.0 KB')
  })

  it('丸めた結果が 1024 に達したら単位を繰り上げる', () => {
    // 1 バイト違いで「1024.0 KB」→「1.0 MB」と飛ぶのを防ぐ。
    expect(formatBytes(1024 * 1024 - 1)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
  })

  it('上限の 20MB がそのまま 20.0 MB になる', () => {
    // 1000 で割ると 21.0 MB になり、prd/02 §5 の「20MB まで」と食い違う。
    expect(formatBytes(20 * 1024 * 1024)).toBe('20.0 MB')
  })
})

describe('countCharacters', () => {
  it('コードポイント単位で数える', () => {
    expect(countCharacters('abc')).toBe(3)
    expect(countCharacters('あいう')).toBe(3)
  })

  it('BMP 外の文字を 1 と数える', () => {
    // String.length では 2 になる。見た目の数から離れるため採らない。
    expect('🙂'.length).toBe(2)
    expect(countCharacters('🙂')).toBe(1)
  })

  it('空文字は 0', () => {
    expect(countCharacters('')).toBe(0)
  })
})

describe('textByteLength', () => {
  it('UTF-8 のバイト数を返す', () => {
    expect(textByteLength('abc')).toBe(3)
    expect(textByteLength('あ')).toBe(3)
    expect(textByteLength('🙂')).toBe(4)
    expect(textByteLength('')).toBe(0)
  })
})
