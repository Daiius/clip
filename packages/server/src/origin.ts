/**
 * 共有リンクに書く絶対 URL のオリジン（prd/01 §4）。
 *
 * ⚠ **サーバーは自分の公開オリジンを発見できない。設定として受け取るしかない。**
 * リクエストの `Host` から組む案は、この構成では成立しない:
 *
 * - **dev では Vite の proxy が `changeOrigin: true` で Host を書き換える。** サーバーが見るのは
 *   利用者のオリジンではなく転送先（`server:4000`）で、そこから組んだ URL は
 *   **ホストに公開していないコンテナを指す**。ブラウザからも受け手からも届かない。
 * - **remote では正しいスキームが得られない。** 前段は平文でコンテナへ繋ぐのでサーバーが見るのは
 *   `http` であり、`https` を組むには `X-Forwarded-Proto` を信じる必要がある。
 *   prd/04 §1 が**前段を前提にしない**と宣言している以上、前段のヘッダ設定に正しさを預けない。
 *
 * したがって **`Host` にも `X-Forwarded-*` にもフォールバックしない。**
 */

/**
 * ローカル dev の既定値。`WEB_BIND` の既定（5173）に対応する。
 *
 * **別のポートで公開するなら `PUBLIC_ORIGIN` を設定すること。** 既定値のままだと、
 * 届かない URL のリンクが黙って発行される（prd/01 §4）。
 */
const LOCAL_DEFAULT_ORIGIN = 'http://localhost:5173'

/**
 * 末尾のスラッシュは落とす。**付いたまま連結すると `//s/<token>` になる**（前段の経路指定が
 * パスで判定される以上、余分なスラッシュは素通しの範囲から外れうる）。
 */
function normalize(origin: string): string {
  return origin.replace(/\/+$/, '')
}

export function publicOrigin(): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim()
  if (!configured) return LOCAL_DEFAULT_ORIGIN

  // 設定ミスに黙って従わない。**壊れた値から組んだリンクは、届かないまま発行される。**
  const parsed = URL.parse(configured)
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error(`PUBLIC_ORIGIN が URL として不正です: ${configured}`)
  }

  return normalize(parsed.origin)
}
