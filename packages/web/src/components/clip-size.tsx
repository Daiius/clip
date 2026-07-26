import { useState } from 'react'
import type { ListedClip } from '../clips.ts'
import { formatBytes, measureText } from '../format.ts'

/** 画像の原寸。**`img` が読み込まれて初めて分かる**（下記の理由で DB には持たない）。 */
export type Dimensions = { width: number; height: number }

/**
 * 表示を切り替えられる候補を、切り替え順に並べて返す。
 *
 * 画像は **`w × h` を先に見せ、タップでデータ量に切り替える**。まだ読み込めておらず原寸が
 * 分からない間は、**データ量しか出せないので候補は1つ**（切り替えの余地が無いことを、
 * ボタンにしないことで示す）。
 */
function sizeLabels(clip: ListedClip, dimensions: Dimensions | null): string[] {
  if (clip.kind === 'text') {
    // **走査は1回だけ。** 文字数とバイト数を別々に数えると本文を2周する（`format.ts`）。
    const { characters, bytes } = measureText(clip.text)
    return [`${characters} 文字`, formatBytes(bytes)]
  }

  if (clip.kind === 'image') {
    const bytes = formatBytes(clip.byteSize)
    if (!dimensions) return [bytes]
    return [`${dimensions.width} × ${dimensions.height}`, bytes]
  }

  // 壊れた行（prd/02 §3.2）。中身が取れないので、規模を語れることが何も無い。
  return []
}

/**
 * エントリの規模の表示（prd/03 §2）。
 *
 * **意図はデータ通信量と、受け渡そうとしている情報の規模を分かるようにすること。**
 * 日時と操作の間の余白に置き、**タップでデータ量（KB / MB）に切り替える**。
 *
 * ⚠ **カード本体のタップ（＝コピー。§3）と衝突させない。** これはヘッダ行の独立した要素で、
 * プレビュー本体の外にある。
 */
export function ClipSize({
  clip,
  dimensions,
}: {
  clip: ListedClip
  dimensions: Dimensions | null
}) {
  const [index, setIndex] = useState(0)

  const labels = sizeLabels(clip, dimensions)
  if (labels.length === 0) return null

  // 読み込み後に候補が 1 → 2 に増えるので、必ず剰余を取る。
  const label = labels[index % labels.length]
  if (label === undefined) return null

  if (labels.length === 1) {
    // 切り替える先が無いなら**ボタンにしない**（押しても何も起きない当たりを作らない）。
    return <span className="text-base-content/50 text-xs tabular-nums">{label}</span>
  }

  return (
    <button
      type="button"
      // `aria-label` は付けない。**見えている文字がそのまま読み上げの名前になる**方が正しく、
      // 上書きすると表示と読み上げがずれる。切り替えられることは `title` で補う。
      title="タップでデータ量に切り替え"
      onClick={() => setIndex(index + 1)}
      className="cursor-pointer text-base-content/50 text-xs tabular-nums hover:text-base-content"
    >
      {label}
    </button>
  )
}
