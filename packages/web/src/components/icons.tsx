/**
 * アイコン（[heroicons](https://heroicons.com/) v2 の outline / 24 から `path` を写したもの）。
 *
 * **npm パッケージは入れない。** 使うのは数個で、依存を1つ増やして木を揺すらせる価値がない。
 * 足すときは heroicons の outline 24 から `path` の `d` をそのまま写し、体裁はここに合わせる。
 *
 * ⚠ **アイコンだけのボタンには、呼び出し側で必ず `aria-label` を付けること。**
 * ここでは `aria-hidden` を付けて支援技術から隠しているので、
 * ラベルが無いと**そのボタンは読み上げから名前を失う**（prd/03 §5）。
 */

type IconProps = { className?: string }

// `aria-hidden` はスプレッドに入れない。**lint が静的に見られず**、
// 「代替テキストが無い svg」として弾かれる（各要素に直接書く）。
const OUTLINE = {
  fill: 'none',
  viewBox: '0 0 24 24',
  strokeWidth: 1.5,
  stroke: 'currentColor',
} as const

/** ダウンロード（heroicons: `arrow-down-tray`）。 */
export function ArrowDownTrayIcon({ className }: IconProps) {
  return (
    <svg {...OUTLINE} aria-hidden="true" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  )
}

/** 削除（heroicons: `trash`）。 */
export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...OUTLINE} aria-hidden="true" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  )
}
