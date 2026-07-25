import { getRouteApi } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../api.ts'
import { safeRedirect } from '../redirect.ts'

const routeApi = getRouteApi('/login')

export function LoginPage() {
  const { redirect } = routeApi.useSearch()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<'credentials' | 'network' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await api.auth.login.$post({ json: { username, password } })
      if (response.ok) {
        // cookie を確実に載せた状態で読み直したいので、遷移ではなくページごと差し替える。
        // 戻り先は **同一オリジンの安全なパスに限定する**（`?redirect=` は攻撃者が細工できる）。
        window.location.href = safeRedirect(redirect, window.location.origin)
        // このあとページが差し替わるので、submitting は戻さない（戻すと一瞬ボタンが押せてしまう）。
        return
      }
      // 失敗の理由は区別しない（server 側も同じ 401 を返す。prd/04 §2）。
      setError('credentials')
    } catch {
      // 応答が返らないケース（server 停止・proxy 障害・回線切断）。
      // ここを拾わないと submitting が true のまま残り、**同じページで再試行できなくなる**。
      setError('network')
    }
    setSubmitting(false)
  }

  return (
    <main className="min-h-dvh bg-base-200 flex items-center justify-center p-4">
      <form onSubmit={submit} className="card bg-base-100 w-full max-w-sm shadow-sm">
        <div className="card-body gap-4">
          <h1 className="card-title">clip</h1>

          <label className="floating-label">
            <span>ユーザー名</span>
            <input
              type="text"
              className="input w-full"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label className="floating-label">
            <span>パスワード</span>
            <input
              type="password"
              className="input w-full"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <p role="alert" className="text-error text-sm">
              {error === 'credentials'
                ? 'ユーザー名またはパスワードが違います'
                : '通信に失敗しました。もう一度お試しください'}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <span className="loading loading-spinner" /> : 'ログイン'}
          </button>
        </div>
      </form>
    </main>
  )
}
