/**
 * 一覧に出すサイズの書式（prd/03 §2）。
 *
 * **目的は「どれくらいの規模のものを受け渡そうとしているか」を分かるようにすること。**
 * 精密な計測ではないので、有効数字は小数第1位までで足りる。
 */

/**
 * 単位の刻み。**10 進の 1000 ではなく 1024 を使う。**
 *
 * 上限が `20 * 1024 * 1024`（prd/02 §5「20MB まで」）で定義されているため。
 * 1000 で割ると、ちょうど上限の画像が「21.0 MB」と表示されて**上限表示と食い違う**。
 */
const UNIT = 1024

/** 小数第1位に丸める。 */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatBytes(bytes: number): string {
  if (bytes < UNIT) return `${bytes} B`

  const kb = round1(bytes / UNIT)
  // **丸めた結果が 1024 に達したら1つ上の単位へ送る。** これをしないと 1048575 B が
  // 「1024.0 KB」になり、1 バイト多いだけの 1048576 B の「1.0 MB」と繋がらなくなる。
  if (kb < UNIT) return `${kb.toFixed(1)} KB`

  return `${round1(bytes / UNIT / UNIT).toFixed(1)} MB`
}

/** テキストの規模。文字数（コードポイント）とデータ量（UTF-8 バイト数）。 */
export type TextSize = { characters: number; bytes: number }

/**
 * テキストの文字数とバイト数を、**走査1回・追加確保なしで**同時に数える。
 *
 * 数え方の理由:
 *
 * - **文字数はコードポイント単位。** `String.length` は UTF-16 のコード単位なので、
 *   **絵文字など BMP 外の文字が 2 と数えられる**。「何文字貼ったか」を見せるのが目的なので、
 *   見た目の数に近いコードポイントで数える（`fileName` を 255 コードポイントで丸めているのと
 *   同じ基準。prd/02 §5）。
 * - **バイト数は UTF-8。** サーバーが `Buffer.byteLength(text, 'utf8')` で上限
 *   （`MAX_TEXT_BYTES`）を判定しているので、同じ数え方でなければ表示と上限が食い違う。
 *
 * ⚠ **`Array.from(text)` や `TextEncoder().encode(text)` は使えない。** どちらも本文全体分を
 * 新たに確保するが、テキストの上限は 16,777,215 バイトで、一覧は 50 件を一度に描画する
 * （prd/02 §5 / prd/03 §2）。**正規の保存データだけでタブが停止しうる。**
 */
export function measureText(text: string): TextSize {
  let characters = 0
  let bytes = 0

  for (let i = 0; i < text.length; i++) {
    // `charCodeAt` は UTF-16 のコード単位を返すので、サロゲートペアは自分で組む。
    // `codePointAt` でも書けるが、進めた分を別途数え直すことになる。
    const unit = text.charCodeAt(i)
    characters++

    if (unit < 0x80) {
      bytes += 1
    } else if (unit < 0x800) {
      bytes += 2
    } else if (unit >= 0xd800 && unit <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      // 対になったサロゲート = BMP 外の1文字。UTF-8 では 4 バイト。
      bytes += 4
      i++
    } else {
      // 対を成さないサロゲートもここに落ちる。**`Buffer.byteLength` / `TextEncoder` は
      // これを U+FFFD（3 バイト）に置き換える**ので、同じく 3 として数える
      // （壊れた入力でサーバーの上限判定と食い違わせない）。
      bytes += 3
    }
  }

  return { characters, bytes }
}

/** 末尾を超えた `charCodeAt` は `NaN` を返すので、比較は自然に false になる。 */
function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff
}
