import { useState } from 'react'
import { createShare, revokeShare, type Share } from '../clips.ts'

/**
 * 自動コピー（prd/03 §6）。
 *
 * ⚠ **`await` を挟んだ後の `clipboard.writeText()` は Safari が拒否する。**
 * 書き込みがユーザー操作と**同期的に結び付いていること**を要求するため、発行の応答を
 * 待ってから書くと、その時点でジェスチャーの資格を失っている。
 * **`ClipboardItem` に Promise を渡せば、書き込み自体は操作の中で始まり中身だけ後から解決する。**
 *
 * 失敗しても画面にリンクを出すので、**ここは補助であって唯一の経路ではない**。
 */
function copyWhenReady(pending: Promise<Share>): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    return Promise.resolve(false)
  }

  const blob = pending.then((share) => new Blob([share.url], { type: 'text/plain' }))
  // 発行が失敗したときに未処理の rejection を残さない（下の write が消費しない場合に備える）。
  blob.catch(() => undefined)

  return navigator.clipboard
    .write([new ClipboardItem({ 'text/plain': blob })])
    .then(() => true)
    .catch(() => false)
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

/**
 * 選択したものを共有する下部バー（prd/03 §6）。**0 件のときは何も出さない。**
 *
 * 発行したらリンクを画面に出し、同時にクリップボードへ入れる（§3 の
 * 「コピーボタンを探させない」と同じ姿勢）。
 */
export function ShareBar({ selectedIds, onClear }: { selectedIds: string[]; onClear: () => void }) {
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState<Share | null>(null)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  if (selectedIds.length === 0 && !share) return null

  const issue = () => {
    setBusy(true)
    setFailed(null)
    setCopied(false)

    const pending = createShare(selectedIds)
    // **クリップボードへの書き込みは、この click の中で始める**（上記の Safari の制約）。
    const copying = copyWhenReady(pending)

    // `try` を使わない。**React Compiler は try 内の throw と value block を扱えない**（prd/01 §1）。
    void pending
      .then(async (issued) => {
        setShare(issued)
        setCopied(await copying)
      })
      .catch((error: unknown) => {
        setFailed(error instanceof Error ? error.message : '共有リンクを作れませんでした')
      })
      .then(() => setBusy(false))
  }

  const revoke = () => {
    if (!share) return
    const id = share.id
    setBusy(true)
    void revokeShare(id)
      .then(() => {
        setShare(null)
        setCopied(false)
      })
      .catch(() => setFailed('失効させられませんでした'))
      .then(() => setBusy(false))
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 border-base-300 border-t bg-base-100 p-4 shadow-lg">
      {share ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {copied ? 'コピーしました。' : 'リンクを作りました。'}
            <span className="text-base-content/60">
              {' '}
              {formatExpiry(share.expiresAt)} まで有効です
            </span>
          </p>
          {/* **自動コピーを唯一の経路にしない**（prd/03 §6）。手で選んでコピーできるようにする。 */}
          <input
            type="text"
            readOnly
            value={share.url}
            aria-label="共有リンク"
            className="input input-sm w-full font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={revoke} disabled={busy}>
              このリンクを失効させる
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShare(null)}>
              閉じる
            </button>
          </div>
          {/* 閉じると失効させる手段が無くなることを隠さない（管理画面は無い。prd/03 §6）。 */}
          <p className="text-base-content/50 text-xs">
            閉じるとここからは失効させられなくなります（期限まで有効なままです）。
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{selectedIds.length} 件を選択中</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClear}
              disabled={busy}
            >
              選択解除
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={issue}
              disabled={busy}
            >
              {busy ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                `${selectedIds.length} 件を共有`
              )}
            </button>
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-2 text-error text-sm">
          {failed}
        </p>
      )}
    </div>
  )
}
