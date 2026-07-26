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

/**
 * 文字数。**コードポイント単位で数える。**
 *
 * `String.length` は UTF-16 のコード単位なので、**絵文字など BMP 外の文字が 2 と数えられる**。
 * 「何文字貼ったか」を見せるのが目的なので、見た目の数に近いコードポイントで数える
 * （`fileName` を 255 コードポイントで丸めているのと同じ基準。prd/02 §5）。
 */
export function countCharacters(text: string): number {
  return Array.from(text).length
}

/** テキストのデータ量（UTF-8 バイト数）。DB の上限と同じ数え方（prd/02 §5）。 */
export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
