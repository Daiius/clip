import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { type ListedClip, listClips } from '../clips.ts'
import { Capture } from '../components/capture.tsx'
import { ClipList } from '../components/clip-list.tsx'

/**
 * 投入口と一覧（prd/03）。貼ったものがそのまま下に増えていく。
 */
export function HomePage() {
  const [clips, setClips] = useState<ListedClip[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  /**
   * 取得の世代。**`reload` が走ったら、進行中の「もっと見る」の結果を捨てる**ための番号。
   *
   * これが無いと、`loadMore` の最中に投入や削除で `reload` が走ったとき、
   * **古いカーソルで取った続きが新しい先頭ページに継ぎ足されて**、一覧に欠落や重複が出る。
   */
  const generation = useRef(0)

  /** 先頭から読み直す。投入・削除のあとはこれで揃える。 */
  const reload = useCallback(async () => {
    const current = ++generation.current
    setFailed(null)
    try {
      const page = await listClips()
      // 早期 return しない（下の解除を飛ばさないため。loadMore と同じ理由）。
      if (current === generation.current) {
        setClips(page.clips)
        setNextCursor(page.nextCursor)
      }
    } catch {
      if (current === generation.current) setFailed('一覧を取得できませんでした')
    }
    // `finally` を使わない。**React Compiler が finally 節を扱えず**、
    // panicThreshold: 'all_errors' ではビルドが落ちる（prd/01 §1）。
    // catch が return しないので、ここは必ず通る。
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const loadMore = async () => {
    if (!nextCursor) return
    const current = generation.current
    setLoadingMore(true)
    try {
      const page = await listClips(nextCursor)
      // 待っている間に reload が走っていたら、この続きはもう繋がらない。捨てる。
      // **ここで return しない。** 早期 return すると下の解除を飛ばし、ボタンが
      // 読み込み中のまま二度と押せなくなる。
      if (current === generation.current) {
        setClips((clips) => [...clips, ...page.clips])
        setNextCursor(page.nextCursor)
      }
    } catch {
      if (current === generation.current) setFailed('続きを取得できませんでした')
    }
    setLoadingMore(false)
  }

  const logout = async () => {
    setLoggingOut(true)
    try {
      const response = await api.auth.logout.$post()
      if (response.ok) {
        // cookie を落とした状態で読み直す（ガードが再評価されて /login へ飛ぶ）。
        window.location.href = '/'
        return
      }
    } catch {
      // 応答が返らないケース。**黙って無反応にしない**（セッションが残ったことが分からない）。
    }
    setFailed('ログアウトに失敗しました。ログインしたままです')
    setLoggingOut(false)
  }

  return (
    <main className="min-h-dvh bg-base-200">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <header className="flex items-center justify-between gap-4">
          <h1 className="font-bold text-2xl">clip</h1>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={logout}
            disabled={loggingOut}
          >
            {loggingOut ? <span className="loading loading-spinner loading-sm" /> : 'ログアウト'}
          </button>
        </header>

        <Capture onCaptured={reload} />

        {failed && (
          <p role="alert" className="text-error text-sm">
            {failed}
          </p>
        )}

        {loading ? (
          <p className="py-12 text-center">
            <span className="loading loading-spinner" />
          </p>
        ) : (
          <ClipList
            clips={clips}
            hasMore={nextCursor !== null}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            onChanged={reload}
          />
        )}
      </div>
    </main>
  )
}
