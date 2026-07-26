import { useEffect, useRef, useState } from 'react'
import { CaptureError, createImageClip, createTextClip } from '../clips.ts'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** allowlist 外を弾いたときの文言（prd/03 §1.4）。ペーストと D&D で同じものを出す。 */
const UNSUPPORTED_MESSAGE = 'PNG / JPEG / GIF / WebP のみ扱えます'

/** 貼られたもの。経路が違っても、保存に渡す時点ではこの2種類しかない（§1.1）。 */
type Payload = { kind: 'text'; text: string } | { kind: 'image'; file: File }

/**
 * 保存に失敗した投入1件。**投入ごとに独立して持つ。**
 *
 * 単一の状態にまとめると、**同時に走った別の投入の成功が、失敗した内容と再試行導線を消す**
 * （ページ全体の paste と D&D は保存中でも新しい投入を始められるため、これは実際に起きる）。
 * それでは「保存に失敗した投入内容を画面から消さない」（§1.4）を満たせない。
 */
type Failure = { id: number; payload: Payload; message: string }

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
  /** 投入に**至らなかった**理由（allowlist 外・クリップボード拒否など）。内容を伴わない。 */
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /** 保存に失敗した内容。**成功したときだけ、その1件を捨てる**（prd/03 §1.4）。 */
  const [failures, setFailures] = useState<Failure[]>([])
  /**
   * 進行中の投入の数。真偽値にすると、**同時に走ったうちの最初の1件が終わった時点で
   * 解除されてしまい**、まだ保存中なのにボタンが押せるようになる。
   */
  const [inFlight, setInFlight] = useState(0)
  const busy = inFlight > 0
  const nextFailureId = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * 保存する。`retryOf` があれば、その失敗の再試行として扱う。
   *
   * **複数が同時に走りうる**ので、成否はどれも「自分の1件」にしか触らない。
   */
  const run = async (payload: Payload, retryOf?: number) => {
    setInFlight((count) => count + 1)
    setError(null)
    try {
      // 三項演算子にしない。**React Compiler は try 内の value block を扱えない**
      // （条件式・論理演算・optional chaining。prd/01 §1）。
      if (payload.kind === 'text') {
        await createTextClip(payload.text)
      } else {
        await createImageClip(payload.file)
      }
      // 消すのは**この要求に対応する失敗だけ**。同時に走った別の投入の失敗は残す。
      if (retryOf !== undefined) {
        setFailures((failures) => failures.filter((failure) => failure.id !== retryOf))
      }
      onCaptured()
    } catch (cause) {
      const message = cause instanceof CaptureError ? cause.message : '保存に失敗しました'
      if (retryOf !== undefined) {
        // 再試行がまた失敗した場合。同じ内容を二重に並べず、理由だけ差し替える。
        setFailures((failures) =>
          failures.map((failure) => {
            if (failure.id !== retryOf) return failure
            return { ...failure, message }
          }),
        )
      } else {
        const id = nextFailureId.current++
        setFailures((failures) => [...failures, { id, payload, message }])
      }
    }
    // `finally` を使わない（React Compiler が扱えない。prd/01 §1）。
    // カウンタを戻すだけなので、**全要求が終わって初めて busy が解除される**。
    setInFlight((count) => count - 1)
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
        void run({ kind: 'image', file: image })
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
        void run({ kind: 'text', text })
      }
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  /** iPhone 用。ユーザー操作の中でだけ許可され、OS の貼り付け許可 UI が出る（§1.3）。 */
  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.read) {
      // API が無い環境。ここはまだクリック直後なのでファイル選択を開ける。
      fileInput.current?.click()
      return
    }

    // **読み取りは run の外で試す。** 失敗時に busy のままだと、案内先のボタンごと押せなくなる。
    let items: ClipboardItems
    try {
      items = await navigator.clipboard.read()
    } catch {
      // 権限拒否・読み取り不可。
      //
      // ⚠ **ここで file input を click() しても開かない。** 権限 UI を経た後の catch では
      // クリック由来の transient user activation が切れており、iOS Safari はファイル選択を
      // 無視する。自動で開こうとすると「押しても何も起きない」状態になるので、
      // **利用者の次のタップに委ねる**（§1.3）。
      setError('クリップボードを読めませんでした。「画像を選ぶ」からお試しください')
      return
    }

    // 貼るものを決める。ペーストと同じく**画像が優先**（§1.1）。
    let payload: Payload | null = null

    for (const item of items) {
      const imageType = item.types.find((type) => IMAGE_TYPES.includes(type))
      if (imageType) {
        const blob = await item.getType(imageType)
        payload = { kind: 'image', file: new File([blob], 'pasted-image', { type: imageType }) }
        break
      }
    }

    if (!payload) {
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text()
          if (text) {
            payload = { kind: 'text', text }
            break
          }
        }
      }
    }

    if (!payload) {
      setError('クリップボードに貼れるものがありませんでした')
      return
    }

    await run(payload)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)

    // 判別はペーストと同じ規則。**画像が含まれていれば画像、無ければテキスト**（§1.1）。
    const image = Array.from(event.dataTransfer.files).find((file) =>
      IMAGE_TYPES.includes(file.type),
    )
    if (image) {
      void run({ kind: 'image', file: image })
      return
    }

    // 選択テキストのドラッグもここで拾う（拾わないと、落としても何も増えない）。
    const text = event.dataTransfer.getData('text/plain')
    if (text) {
      void run({ kind: 'text', text })
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
      className={`card border-2 border-dashed bg-base-100 transition-colors ${
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
            if (file) void run({ kind: 'image', file })
          }}
        />

        {error && (
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
        )}

        {/* 失敗した内容は画面に残す。貼り直しを強いない（§1.4）。
         **同時に投入した複数が失敗しうる**ので、1件ずつ並べて個別に再試行させる。 */}
        {failures.length > 0 && (
          <ul className="flex w-full flex-col items-center gap-2">
            {failures.map((failure) => (
              <li key={failure.id} className="flex max-w-full flex-col items-center gap-1">
                <p role="alert" className="text-error text-sm">
                  {failure.message}
                </p>
                <div className="flex max-w-full items-center gap-2">
                  <span className="truncate text-base-content/60 text-xs">
                    {failure.payload.kind === 'text'
                      ? failure.payload.text
                      : failure.payload.file.name || '貼り付けた画像'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => void run(failure.payload, failure.id)}
                    disabled={busy}
                  >
                    再試行
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
