import { useState } from 'react'
import { deleteClip, type ListedClip } from '../clips.ts'

/** 長いテキストは折りたたむ（prd/03 §2）。 */
const FOLD_THRESHOLD = 400

function formatTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * 取り出し（prd/03 §3）。**カード本体をクリックしたらクリップボードに入る。**
 * コピーボタンを探させない。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function copyImage(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/clips/${id}/blob`)
    if (!response.ok) return false
    const blob = await response.blob()
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return true
  } catch {
    // ClipboardItem は形式・ブラウザによって未対応（PNG 以外は特に）。
    // **黙って失敗させず、ダウンロードに落とす**（prd/03 §3）。
    return false
  }
}

export function ClipCard({ clip, onDeleted }: { clip: ListedClip; onDeleted: () => void }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /** 画像の取得が失敗した（実体が消えている）。削除の途中失敗で起きる（prd/02 §3.2）。 */
  const [imageMissing, setImageMissing] = useState(false)

  const broken = clip.kind === 'broken' || imageMissing

  const download = () => {
    window.location.href = `/api/clips/${clip.id}/download`
  }

  const copy = async () => {
    if (clip.kind === 'broken') return

    const ok = clip.kind === 'text' ? await copyText(clip.text) : await copyImage(clip.id)
    if (ok) {
      // 何も起きないと成否が分からないので、必ずフィードバックを出す（prd/03 §3）。
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      return
    }
    if (clip.kind === 'image') {
      download()
      return
    }
    setFailed('コピーできませんでした')
  }

  const remove = async () => {
    // 投入は確認なしで通す代わりに、**破壊操作だけは守る**（prd/03 §4）。
    if (!window.confirm('削除します。元に戻せません。')) return

    setDeleting(true)
    setFailed(null)
    try {
      await deleteClip(clip.id)
      onDeleted()
    } catch {
      setFailed('削除できませんでした')
      setDeleting(false)
    }
  }

  const isLongText = clip.kind === 'text' && clip.text.length > FOLD_THRESHOLD

  return (
    <li className="card bg-base-100 shadow-sm">
      <div className="card-body gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <time className="text-base-content/50 text-xs">{formatTime(clip.createdAt)}</time>
          <div className="flex items-center gap-1">
            {copied && <span className="badge badge-success badge-sm">コピーしました</span>}
            {clip.kind === 'image' && !broken && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={download}>
                ダウンロード
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={remove}
              disabled={deleting}
            >
              削除
            </button>
          </div>
        </div>

        {broken ? (
          // 削除は S3 → DB の順なので、途中で失敗すると**実体を失った行**が残る（prd/02 §3.2）。
          // 行の構造は正常なので一覧 API では検出できない。**取得の失敗をここで拾って明示する**
          // （黙って壊れた画像を出すと、気づける異常を選んだ意味が無くなる）。
          <p className="text-error text-sm">
            {clip.kind === 'broken'
              ? 'この項目は壊れています（データが不整合です）。削除してください。'
              : '画像の実体が見つかりません（削除の途中で失敗した可能性があります）。削除してください。'}
          </p>
        ) : (
          <button
            type="button"
            onClick={copy}
            className="cursor-pointer text-left"
            title="クリックでコピー"
          >
            {clip.kind === 'text' ? (
              // 貼ったものがそのまま見えることを優先し、Markdown としてはレンダリングしない。
              <pre className="whitespace-pre-wrap break-all font-mono text-sm">
                {isLongText && !expanded ? `${clip.text.slice(0, FOLD_THRESHOLD)}…` : clip.text}
              </pre>
            ) : (
              // サムネイルは作らず、原寸を CSS で縮小する（prd/03 §2）。
              <img
                src={`/api/clips/${clip.id}/blob`}
                alt=""
                onError={() => setImageMissing(true)}
                className="max-h-96 max-w-full rounded object-contain"
              />
            )}
          </button>
        )}

        {isLongText && (
          <button
            type="button"
            className="btn btn-ghost btn-xs self-start"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '折りたたむ' : 'すべて表示'}
          </button>
        )}

        {failed && (
          <p role="alert" className="text-error text-sm">
            {failed}
          </p>
        )}
      </div>
    </li>
  )
}
