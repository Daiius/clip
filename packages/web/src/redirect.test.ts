import { describe, expect, it } from 'vitest'
import { safeRedirect } from './redirect.ts'

const ORIGIN = 'https://clip.example'

describe('safeRedirect', () => {
  it('同一オリジンのパスはそのまま使う', () => {
    expect(safeRedirect('/', ORIGIN)).toBe('/')
    expect(safeRedirect('/foo?a=1#b', ORIGIN)).toBe('/foo?a=1#b')
    expect(safeRedirect(`${ORIGIN}/foo`, ORIGIN)).toBe('/foo')
  })

  it('未指定なら / に落とす', () => {
    expect(safeRedirect(undefined, ORIGIN)).toBe('/')
    expect(safeRedirect('', ORIGIN)).toBe('/')
  })

  it('別オリジンへは飛ばさない（オープンリダイレクト）', () => {
    expect(safeRedirect('https://evil.example/x', ORIGIN)).toBe('/')
    expect(safeRedirect('//evil.example/x', ORIGIN)).toBe('/')
    expect(safeRedirect('https://clip.example.evil.test/x', ORIGIN)).toBe('/')
  })

  it('javascript: は弾く（認証済みオリジンでのスクリプト実行）', () => {
    expect(safeRedirect('javascript:alert(1)', ORIGIN)).toBe('/')
    // 制御文字を挟んだ偽装（ブラウザによっては javascript: として解釈されうる）
    expect(safeRedirect('java\tscript:alert(1)', ORIGIN)).toBe('/')
    expect(safeRedirect('JavaScript:alert(1)', ORIGIN)).toBe('/')
  })

  it('data: や他のスキームも弾く', () => {
    expect(safeRedirect('data:text/html,<script>alert(1)</script>', ORIGIN)).toBe('/')
    expect(safeRedirect('file:///etc/passwd', ORIGIN)).toBe('/')
  })
})
