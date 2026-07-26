import { monotonicFactory } from 'ulid'

/**
 * エントリ ID の生成（prd/02 §2）。
 *
 * **monotonic な生成器を使う。** 素の `ulid()` は同一ミリ秒内の乱数部が単調とは限らず、
 * 連続して貼ったときに **`id` の降順が生成順と食い違いうる**。一覧の並びとページングを
 * `id` 単独で成立させているため、ここが崩れるとページ境界で行が重複・欠落する。
 *
 * ⚠ **これは認可トークンではない。** 先頭 48 ビットは生成時刻そのもので、単調増加させている
 * 以上、観測できた ID の近傍は探索しうる。共有 URL の防壁に使わないこと（prd/02 §2 / prd/04 §3）。
 */
const nextUlid = monotonicFactory()

export function newClipId(): string {
  return nextUlid()
}

/**
 * 共有の ID（prd/02 §6）。**同じ生成器を使う**（別テーブルなので値が混ざっても問題なく、
 * 単調性の保証を1箇所に保てる）。
 *
 * ⚠ **これも認可トークンではない。** 共有を開けるのは `shares.tokenHash` に対応する乱数だけで、
 * この `id` は**失効の宛先**にしか使わない（prd/04 §3.1）。
 */
export function newShareId(): string {
  return nextUlid()
}
