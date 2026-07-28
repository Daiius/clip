import { useState } from 'react'
import { deleteClip, type ListedClip } from '../clips.ts'
import { ClipSize, type Dimensions } from './clip-size.tsx'
import { ArrowDownTrayIcon, TrashIcon } from './icons.tsx'

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

export function ClipCard({
  clip,
  selected,
  selectDisabled,
  onSelectedChange,
  onDeleted,
}: {
  clip: ListedClip
  selected: boolean
  /** 上限に達していて、**これ以上増やせない**（prd/03 §6）。選択済みのものは常に外せる。 */
  selectDisabled: boolean
  onSelectedChange: (selected: boolean) => void
  onDeleted: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /** 画像の取得が失敗した（実体が消えている）。削除の途中失敗で起きる（prd/02 §3.2）。 */
  const [imageMissing, setImageMissing] = useState(false)
  /**
   * 画像の原寸。**DB には持たず、読み込んだ `img` から取る**（prd/03 §2）。
   *
   * 「サムネイルを作らず**原寸を CSS で縮小**する」（§確定事項）ため、表示に使う画像は
   * 常に原寸そのものである。**すでに手元にある寸法を、サーバーで解析し直して列に持つ理由がない。**
   */
  const [dimensions, setDimensions] = useState<Dimensions | null>(null)

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
          {/* 選択・日時・サイズ。**操作との間の余白に規模を出す**（prd/03 §2）。 */}
          <div className="flex min-w-0 items-center gap-2">
            {/* 選択（prd/03 §6）。**モードにしない**ので常に出す。壊れた行には出さない
                （渡せないものを選ばせない）。カード本体のタップ＝コピーとは別の場所に置く。 */}
            {!broken && (
              /*
               * ⚠ **タップ領域を見た目より広く取る。** チェックボックスの見た目は小さいままで
               * よいが、指で押す的が 16px しかないと iPhone で正確に押せない
               * （Apple の HIG は最小 44pt を求めている）。
               *
               * `p-3` で四方に余白を足し、**同じ量の負のマージンで打ち消す**。
               * こうすると**周りのレイアウトを 1px も動かさずに**的だけが広がる。
               */
              <label className="-m-3 flex cursor-pointer items-center p-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={selected}
                  // 上限に達したら**未選択のものだけ**押せなくする。選択済みを外す道は塞がない
                  // （塞ぐと、上限に達した時点で選び直せなくなる）。
                  disabled={selectDisabled && !selected}
                  onChange={(event) => onSelectedChange(event.currentTarget.checked)}
                  aria-label="共有する対象に選ぶ"
                />
              </label>
            )}
            <time className="text-base-content/50 text-xs">{formatTime(clip.createdAt)}</time>
            {!broken && <ClipSize clip={clip} dimensions={dimensions} />}
          </div>

          {/* 操作。**狭い幅ではアイコンだけにする**（prd/03 §5）。
              `aria-label` を必ず付ける。付けないと、文字を隠した時点で読み上げが名前を失う。 */}
          <div className="flex shrink-0 items-center gap-1">
            {copied && <span className="badge badge-success badge-sm">コピーしました</span>}
            {clip.kind === 'image' && !broken && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={download}
                aria-label="ダウンロード"
                title="ダウンロード"
              >
                <ArrowDownTrayIcon className="size-4 sm:hidden" />
                <span className="hidden sm:inline">ダウンロード</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={remove}
              disabled={deleting}
              aria-label="削除"
              title="削除"
            >
              <TrashIcon className="size-4 sm:hidden" />
              <span className="hidden sm:inline">削除</span>
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
                // 原寸はここでしか分からない（`ClipSize` へ渡す）。
                onLoad={(event) =>
                  setDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                // カード幅に満たない画像は中央に置く（`mx-auto`）。左端に寄っていると
                // 幅の違う画像が並んだときに揃わず、一覧が落ち着かない。
                className="mx-auto max-h-96 max-w-full rounded object-contain"
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
