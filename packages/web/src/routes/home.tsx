import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { type ListedClip, listClips } from '../clips.ts'
import { Capture } from '../components/capture.tsx'
import { ClipList } from '../components/clip-list.tsx'
import { ShareBar } from '../components/share-bar.tsx'

/**
 * 投入口と一覧（prd/03）。貼ったものがそのまま下に増えていく。
 */
/**
 * 次ページのカーソルと、**それを取ってきた世代**。
 *
 * カーソル単体で持つと、reload が走った後も**変更前の境界**が新しい世代番号で使われてしまう
 * （`loadMore` は開始時点の `generation` を見るが、カーソルは reload 前の値のままのため）。
 * 取得元の世代を貼り付けておき、**先頭ページが確定した世代のカーソルしか使わない**。
 */
type Next = { cursor: string; generation: number }

export function HomePage() {
  const [clips, setClips] = useState<ListedClip[]>([])
  const [next, setNext] = useState<Next | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  /**
   * 共有する対象の選択（prd/03 §6）。**一覧の並びで順序を決める**ので、集合だけを持つ。
   *
   * ⚠ **`Set` を書き換えず、毎回作り直す。** 同一参照のまま中身を変えると、React が
   * 変化に気づかない（メモ化は React Compiler に委ねている。prd/01 §1）。
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())

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
    // **古いカーソルをここで捨てる。** 残したままだと、応答を待っている間に「もっと見る」を
    // 押せてしまい、変更前の境界の続きが新しい一覧に継ぎ足される。
    setNext(null)
    setFailed(null)
    try {
      const page = await listClips()
      // 早期 return しない（下の解除を飛ばさないため。loadMore と同じ理由）。
      if (current === generation.current) {
        setClips(page.clips)
        // 三項演算子にしない。**React Compiler は try 内の value block を扱えない**（prd/01 §1）。
        if (page.nextCursor) {
          setNext({ cursor: page.nextCursor, generation: current })
        } else {
          setNext(null)
        }
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
    // **世代の合わないカーソルは使わない。** reload の開始で `next` は捨てられるが、
    // 同じ tick での取りこぼしに備えて世代でも照合する（reload と loadMore の応答が
    // どちらの順で返っても、古い境界の続きが繋がらないようにする）。
    if (!next || next.generation !== generation.current) return
    const current = generation.current
    setLoadingMore(true)
    try {
      const page = await listClips(next.cursor)
      // 待っている間に reload が走っていたら、この続きはもう繋がらない。捨てる。
      // **ここで return しない。** 早期 return すると下の解除を飛ばし、ボタンが
      // 読み込み中のまま二度と押せなくなる。
      if (current === generation.current) {
        setClips((clips) => [...clips, ...page.clips])
        // ここも三項演算子にしない（try 内の value block。prd/01 §1）。
        if (page.nextCursor) {
          setNext({ cursor: page.nextCursor, generation: current })
        } else {
          setNext(null)
        }
      }
    } catch {
      if (current === generation.current) setFailed('続きを取得できませんでした')
    }
    setLoadingMore(false)
  }

  const setSelected = (id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  /**
   * 一覧の並びのまま、選択されているものだけを返す。
   *
   * **選択した順ではなく一覧の順にする。** 受け手に渡るマニフェストの行順が
   * 「新しい順」（prd/03 §2）と一致していた方が、画面と突き合わせやすい。
   */
  const selectedInOrder = clips.filter((clip) => selectedIds.has(clip.id)).map((clip) => clip.id)

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
            selectedIds={selectedIds}
            onSelectedChange={setSelected}
            hasMore={next !== null}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            onChanged={reload}
          />
        )}

        <ShareBar selectedIds={selectedInOrder} onClear={() => setSelectedIds(new Set())} />
      </div>
    </main>
  )
}
