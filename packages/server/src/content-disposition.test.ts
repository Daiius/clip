import { describe, expect, it } from 'vitest'
import { attachmentDisposition, encodeRfc5987 } from './content-disposition.ts'

describe('encodeRfc5987', () => {
  it('そのまま使える文字は変えない', () => {
    expect(encodeRfc5987('dot.png')).toBe('dot.png')
    expect(encodeRfc5987('a-b_c.1')).toBe('a-b_c.1')
  })

  it("encodeURIComponent が素通しする ' ( ) * も符号化する", () => {
    // RFC 5987 の attr-char に含まれないため、素通しすると拡張値の構文として不正になる。
    expect(encodeRfc5987("O'Brien.png")).toBe('O%27Brien.png')
    expect(encodeRfc5987('shot(1).png')).toBe('shot%281%29.png')
    expect(encodeRfc5987('a*b.png')).toBe('a%2Ab.png')
  })

  it('マルチバイト文字を UTF-8 で符号化する', () => {
    expect(encodeRfc5987('画像.png')).toBe('%E7%94%BB%E5%83%8F.png')
  })

  it('ヘッダを壊しうる文字を符号化する', () => {
    expect(encodeRfc5987('a\r\nX-Evil: 1.png')).toBe('a%0D%0AX-Evil%3A%201.png')
    expect(encodeRfc5987('a"b.png')).toBe('a%22b.png')
    expect(encodeRfc5987('a;b.png')).toBe('a%3Bb.png')
  })
})

describe('attachmentDisposition', () => {
  it('RFC 5987 の拡張値として組み立てる', () => {
    expect(attachmentDisposition('dot.png')).toBe("attachment; filename*=UTF-8''dot.png")
    expect(attachmentDisposition("O'Brien.png")).toBe("attachment; filename*=UTF-8''O%27Brien.png")
  })

  it('組み立てた値に改行が混ざらない', () => {
    expect(attachmentDisposition('a\r\nb.png')).not.toMatch(/[\r\n]/)
  })
})
