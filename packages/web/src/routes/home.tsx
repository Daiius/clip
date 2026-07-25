import { api } from '../api.ts'

/**
 * 投入口と一覧が入る画面（prd/03）。現時点ではログイン後に見えることを示すだけ。
 */
export function HomePage() {
  const logout = async () => {
    await api.auth.logout.$post()
    // cookie を落とした状態で読み直す（ガードが再評価されて /login へ飛ぶ）。
    window.location.href = '/'
  }

  return (
    <main className="min-h-dvh bg-base-200">
      <div className="mx-auto max-w-3xl p-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">clip</h1>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            ログアウト
          </button>
        </div>
        <p className="mt-2 text-base-content/70">
          ログインできています。投入口と一覧はこれから実装します。
        </p>
      </div>
    </main>
  )
}
