import type { InferResponseType } from 'hono/client'
import { api } from './api.ts'

// ステータスを 200 に絞る。絞らないと zod のバリデーションエラー（400）との union になり、
// 成功時の形が取り出せない。
export type ClipListResponse = InferResponseType<typeof api.clips.$get, 200>
export type ListedClip = ClipListResponse['clips'][number]

/** 投入の失敗を、画面にそのまま出せる文言へ変換する（prd/03 §1.4）。 */
export class CaptureError extends Error {}

/**
 * 投入（prd/03 §1）。
 *
 * multipart を送るのでここだけ素の `fetch` を使う（RPC のフォーム型は File を含むと扱いづらい）。
 * 経路は3つあるが**すべてこの1本に集約する**ので、増えるのは呼び出し側だけ。
 */
async function postClip(form: FormData): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/clips', { method: 'POST', body: form })
  } catch {
    throw new CaptureError('通信に失敗しました。もう一度お試しください')
  }

  if (response.ok) return

  // 失敗しても投入した内容を画面から消さない（貼り直しを強いない。prd/03 §1.4）。
  if (response.status === 415) {
    throw new CaptureError('PNG / JPEG / GIF / WebP のみ扱えます')
  }
  if (response.status === 413) {
    // 画像とテキストで理由が違う（prd/03 §1.4）。**どちらも「画像は 20MB まで」と出すと嘘になる。**
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new CaptureError(
      body?.error === 'text too large'
        ? 'テキストが大きすぎます'
        : '画像が大きすぎます（20MB まで）',
    )
  }
  if (response.status === 401) {
    throw new CaptureError('ログインの有効期限が切れています。再読み込みしてください')
  }
  throw new CaptureError('保存に失敗しました')
}

export async function createTextClip(text: string): Promise<void> {
  const form = new FormData()
  form.set('text', text)
  await postClip(form)
}

export async function createImageClip(file: File): Promise<void> {
  const form = new FormData()
  form.set('file', file, file.name || 'pasted-image')
  await postClip(form)
}

export async function listClips(cursor?: string): Promise<ClipListResponse> {
  const response = await api.clips.$get({ query: cursor ? { cursor } : {} })
  if (response.status !== 200) throw new Error('一覧を取得できませんでした')
  return response.json()
}

export async function deleteClip(id: string): Promise<void> {
  const response = await api.clips[':id'].$delete({ param: { id } })
  if (!response.ok) throw new Error('削除できませんでした')
}
