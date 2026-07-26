import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { type Clip, IMAGE_EXTENSIONS } from './clip.ts'
import { MAX_SHARE_CLIPS } from './limits.ts'

/**
 * 共有トークン（prd/04 §3.1）。**URL そのものが資格情報**になる capability URL である。
 *
 * ⚠ **clip の ULID を防壁にしない。** ULID は時刻由来かつ単調増加で、観測できた ID の近傍を
 * 探索しうる（prd/02 §2）。ここで作る乱数だけが認可の境界になる。
 */

/**
 * トークンの長さ（バイト）。base64url にすると 43 文字。
 *
 * 256 ビットあれば総当たりは成立しない。**短くしない**——この値だけが `/s/*` の防壁である。
 */
const TOKEN_BYTES = 32

/** 発行時に一度だけ返す平文のトークン。**DB には保存しない**（prd/02 §6）。 */
export function newShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * DB に保存・照合する形へ変換する。
 *
 * **定数時間比較は要らない。** 照合は「この値と等しい行を索引で引く」であって、
 * 秘密と入力をバイト単位で比べる処理ではない。256 ビットの値に対する索引探索の
 * 時間差から元の値を組み立てることは現実的でない（セッショントークンと同じ扱い）。
 */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * 発行要求の検証（prd/02 §5）。
 *
 * 件数の上限は一覧のページサイズに揃えてある。**重複を許さない**のは、同じ clip が
 * マニフェストに2行出ても受け手に得が無く、上限の意味も薄れるため。
 */
export const createShareSchema = z.object({
  clipIds: z
    .array(z.string().length(26))
    .min(1)
    .max(MAX_SHARE_CLIPS)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: '同じ clip を重複して選べません',
    }),
})

/**
 * メンバー URL のファイル名部分（`<id>.<ext>`）。
 *
 * **拡張子を付けるのは受け手のため。** 付けないと保存したファイルが何なのか分からず、
 * `curl -O` が拡張子なしで落とすことになる（prd/03 §6）。
 * 拡張子は**サーバーが保存時に判定した `mimeType`** から導く（申告値ではない。prd/02 §4.1）。
 */
export function memberFileName(clip: Clip): string {
  return clip.kind === 'text' ? `${clip.id}.txt` : `${clip.id}.${IMAGE_EXTENSIONS[clip.mimeType]}`
}

/** `<id>.<ext>` から `id` を取り出す（存在確認の前段。形が違えば `null`）。 */
export function parseMemberId(fileName: string): string | null {
  const dot = fileName.indexOf('.')
  if (dot !== 26) return null
  const id = fileName.slice(0, 26)
  // ULID は Crockford base32 の大文字。**ここで弾いておくと DB へ問い合わせずに済む。**
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) ? id : null
}

/**
 * マニフェスト（prd/03 §6）。**改行区切りのメンバー URL だけ**を返す。
 *
 * 受け手が最もパースしなくて済む形にしてある。JSON や書庫にすると、受け手に
 * パースや展開の手間を作ることになる。
 */
export function buildManifest(origin: string, token: string, clips: Clip[]): string {
  return clips.map((clip) => `${origin}/s/${token}/${memberFileName(clip)}`).join('\n')
}
