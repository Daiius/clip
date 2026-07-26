import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 同一オリジン配信。ブラウザは常に自オリジンの `/api` を叩き、dev では Vite が server へ
// **パスを保持したまま**転送する（server は `/api` 配下にルートを持つ。prd/01 §5）。
// 共有パス `/s` も同じ server へ転送する（prd/01 §3）。
const apiTarget = process.env.DEV_API_TARGET ?? 'http://localhost:4000'

// リモート dev 公開（前段プロキシが TLS 終端と認証を担う）でだけ必要な差分。
// PUBLIC_ORIGIN 未設定 = ローカル dev（差分なし）。設定時のみ、未知 Host の拒否を回避する
// allowedHosts と、HMR を前段プロキシ経由（wss://<host>:443）へ向ける設定を上乗せする。prd/01 §4。
const publicOrigin = process.env.PUBLIC_ORIGIN
const remoteHost = publicOrigin ? new URL(publicOrigin).hostname : undefined

// React Compiler を有効にする（prd/01 §1）。メモ化はコンパイラに任せ、手書きの
// useMemo / useCallback / memo() は置かない。
// panicThreshold: 'all_errors' — コンパイルできない箇所はビルドを失敗させる。黙ってバイパスされると
// 「メモ化されている前提」の useEffect 依存配列が毎レンダー変わり、再取得ループのような実行時バグになる。
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]],
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: true },
      // 共有パス（prd/04 §3.1）。**ここに足さないと SPA フォールバックに落ち、
      // 実装済みのはずの経路が静かに index.html を返す**（prd/01 §3）。
      //
      // ⚠ **`'/s'` と書いてはいけない。** Vite の proxy は**文字列キーを前置一致**で見るので、
      // dev サーバーが配信する **`/src/*` まで転送されて画面が真っ白になる**（2026-07-26 に踏んだ）。
      // `^` 始まりのキーは正規表現として扱われるので、区切りまで含めて明示する。
      '^/s/': { target: apiTarget, changeOrigin: true },
    },
    ...(remoteHost
      ? {
          allowedHosts: [remoteHost],
          hmr: { clientPort: 443, protocol: 'wss' as const },
        }
      : {}),
  },
})
