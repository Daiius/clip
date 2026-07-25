import { useEffect, useRef, useState } from 'react'
import { CaptureError, createImageClip, createTextClip } from '../clips.ts'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** allowlist 外を弾いたときの文言（prd/03 §1.4）。ペーストと D&D で同じものを出す。 */
const UNSUPPORTED_MESSAGE = 'PNG / JPEG / GIF / WebP のみ扱えます'

/**
 * 投入口（prd/03 §1）。**テキストの入力欄を作らない。**
 * 打ち込む場所は用意せず、貼られたものが増えるだけにする。
 *
 * 経路は3つあるが、すべて同じ判別・保存の流れに落とす:
 *
 * - **ページへのペースト**（Windows / MacBook）— どこにもフォーカスせずに ⌘/Ctrl+V
 * - **貼り付けボタン**（iPhone）— iOS Safari はページに `paste` を配らないので、
 *   `navigator.clipboard.read()` を呼ぶボタンが要る（§1.3）
 * - **D&D / ファイル選択** — 画像のみ
 */
export function Capture({ onCaptured }: { onCaptured: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      onCaptured()
    } catch (cause) {
      setError(cause instanceof CaptureError ? cause.message : '保存に失敗しました')
    }
    // `finally` を使わない（React Compiler が扱えない。prd/01 §1）。
    setBusy(false)
  }

  // ページ全体でペーストを拾う。**入力欄にフォーカスしていなくても効く**のが狙い。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData
      if (!data) return

      // 画像が含まれていれば画像、無ければテキスト（人間に選ばせない。§1.1）。
      const files = Array.from(data.files)
      const image = files.find((file) => IMAGE_TYPES.includes(file.type))
      if (image) {
        event.preventDefault()
        void run(() => createImageClip(image))
        return
      }

      // ファイルはあるが allowlist 外（SVG・PDF・zip 等）。**黙って無反応にしない**（§1.4）。
      if (files.length > 0) {
        event.preventDefault()
        setError(UNSUPPORTED_MESSAGE)
        return
      }

      const text = data.getData('text/plain')
      if (text) {
        event.preventDefault()
        void run(() => createTextClip(text))
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  /** iPhone 用。ユーザー操作の中でだけ許可され、OS の貼り付け許可 UI が出る（§1.3）。 */
  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.read) {
      // 読み取りが使えない環境ではファイル選択にフォールバックする。
      fileInput.current?.click()
      return
    }

    // **読み取りは run の外で試す。** ここで失敗したらファイル選択に落とすので（§1.3）、
    // busy にしたままだとフォールバック先のボタンごと押せなくなる。
    let items: ClipboardItems
    try {
      items = await navigator.clipboard.read()
    } catch {
      // 権限拒否・読み取り不可。ファイル選択にフォールバックする。
      fileInput.current?.click()
      return
    }

    await run(async () => {
      for (const item of items) {
        const imageType = item.types.find((type) => IMAGE_TYPES.includes(type))
        if (imageType) {
          const blob = await item.getType(imageType)
          await createImageClip(new File([blob], 'pasted-image', { type: imageType }))
          return
        }
      }

      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text()
          if (text) {
            await createTextClip(text)
            return
          }
        }
      }

      throw new CaptureError('クリップボードに貼れるものがありませんでした')
    })
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)

    // 判別はペーストと同じ規則。**画像が含まれていれば画像、無ければテキスト**（§1.1）。
    const image = Array.from(event.dataTransfer.files).find((file) =>
      IMAGE_TYPES.includes(file.type),
    )
    if (image) {
      void run(() => createImageClip(image))
      return
    }

    // 選択テキストのドラッグもここで拾う（拾わないと、落としても何も増えない）。
    const text = event.dataTransfer.getData('text/plain')
    if (text) {
      void run(() => createTextClip(text))
      return
    }

    // 画像でもテキストでもないファイル（任意ファイルは対象外。§1.4）。
    if (event.dataTransfer.files.length > 0) {
      setError(UNSUPPORTED_MESSAGE)
    }
  }

  return (
    // D&D は補助的な経路で、キーボードからは「貼り付け」「画像を選ぶ」ボタンから同じことができる
    // （prd/03 §1）。ドロップ領域に相当する role が無いため、role を足しても支援技術には伝わらない。
    // biome-ignore lint/a11y/noStaticElementInteractions: 同等の操作をボタンで別途提供している
    <section
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`card bg-base-100 border-2 border-dashed transition-colors ${
        dragging ? 'border-primary' : 'border-base-300'
      }`}
    >
      <div className="card-body items-center gap-3 py-6 text-center">
        <p className="text-base-content/70 text-sm">
          <span className="hidden sm:inline">画面のどこかで ⌘/Ctrl + V、または画像をドロップ</span>
          <span className="sm:hidden">下のボタンから貼り付け</span>
        </p>

        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={pasteFromClipboard}
            disabled={busy}
          >
            {busy ? <span className="loading loading-spinner loading-sm" /> : '貼り付け'}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            画像を選ぶ
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // 同じファイルを続けて選べるように値を戻す。
            event.target.value = ''
            if (file) void run(() => createImageClip(file))
          }}
        />

        {error && (
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
