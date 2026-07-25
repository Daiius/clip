/**
 * ログイン後の戻り先を**同一オリジン内の安全なパスに限定する**。
 *
 * `?redirect=` は URL に載る以上、攻撃者が自由に細工したログイン URL へ利用者を誘導できる。
 * 検証せずに `window.location.href` へ渡すと:
 *
 * - **オープンリダイレクト** — 正規の資格情報でログインさせた直後に外部サイトへ飛ばせる。
 * - **任意スクリプト実行** — `javascript:` 形式を許すブラウザでは、**認証済みのアプリオリジンで**
 *   スクリプトが動く。cookie が HttpOnly でも、認証済み API を呼んで private なデータを
 *   送り出せるので防壁にならない。
 *
 * したがって、**同一オリジンの http(s) であることを確認し、パス部分だけを取り出して使う**。
 * 判定できないものは黙って `/` に落とす（利用者にはログイン後の遷移先が変わるだけで実害がない）。
 */
export function safeRedirect(raw: string | undefined, origin: string): string {
  if (!raw) return '/'

  try {
    const url = new URL(raw, origin)
    if (url.origin !== origin) return '/'
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
