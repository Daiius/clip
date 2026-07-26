import { useEffect, useRef, useState } from 'react'
import { MAX_IMAGE_BYTES } from 'server/limits'
import { CaptureError, createImageClip, createTextClip, IMAGE_TOO_LARGE_MESSAGE } from '../clips.ts'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** 貼られたもの。経路が違っても、保存に渡す時点ではこの2種類しかない（§1.1）。 */
type Payload = { kind: 'text'; text: string } | { kind: 'image'; file: File }

/**
 * 落とされた・貼られたファイルから画像候補を1つ選ぶ（ペーストと D&D で同じ規則。§1.1）。
 *
 * **申告 MIME だけで弾かない。** `File.type` はクライアント申告値で、正しい PNG や JPEG でも
 * 空文字や `application/octet-stream` になることがある。ここで allowlist に照合して落とすと、
 * **正しい画像がサーバーのシグネチャ検証に到達しないまま拒否される**（prd/03 §1.2）。
 *
 * allowlist の判定は**サーバー1箇所に集約する**（prd/02 §4.1）。ここは「どれを送るか」だけを
 * 決め、申告が allowlist に合うものを優先し、無ければ先頭を送って**サーバーに判定させる**。
 * 本当に対象外（SVG・PDF・zip 等）なら 415 が返り、§1.4 の文言がそのまま画面に出る。
 */
function pickImageCandidate(files: readonly File[]): File | null {
  return files.find((file) => IMAGE_TYPES.includes(file.type)) ?? files[0] ?? null
}

/**
 * クリップボードの表現から画像候補の MIME を選ぶ（貼り付けボタン経由。§1.3）。
 *
 * **申告 MIME だけで弾かないのは `pickImageCandidate` と同じ理由**（§1.2）。allowlist に合う
 * 表現を優先し、無ければ**テキスト以外の表現**を候補としてサーバーのシグネチャ検証に判定させる。
 * ここで完全一致だけを見ると、`application/octet-stream` で申告された正しい画像が投入できず、
 * SVG・PDF も 415 の所定の文言ではなく「貼れるものがありません」になってしまう。
 *
 * ⚠ **除くのは `text/plain` だけではなく `text/*` 全体。** リッチテキストのコピーは
 * `text/html` と `text/plain` の組で来るため、`text/html` を画像候補にすると
 * **普通の文字列のペーストが 415 で落ちる**（iPhone の主経路が壊れる）。
 * Chrome の独自形式（`web ` 前置き）も同じ理由で除く。
 */
function pickClipboardImageType(types: readonly string[]): string | null {
  const allowed = types.find((type) => IMAGE_TYPES.includes(type))
  if (allowed) return allowed
  return types.find((type) => !type.startsWith('text/') && !type.startsWith('web ')) ?? null
}

/**
 * クリップボードの中身から投入するものを1つ決める。ペーストと同じく**画像が優先**（§1.1）。
 *
 * ⚠ **表現の取り出し（`getType` と text 変換）自体が失敗しうる。** 呼び出し側で必ず catch すること
 * （握り潰すと click handler の Promise が reject したまま、画面には何も出ない）。
 */
async function extractPayload(items: ClipboardItems): Promise<Payload | null> {
  for (const item of items) {
    const imageType = pickClipboardImageType(item.types)
    if (imageType) {
      const blob = await item.getType(imageType)
      return { kind: 'image', file: new File([blob], 'pasted-image', { type: imageType }) }
    }
  }

  for (const item of items) {
    if (item.types.includes('text/plain')) {
      const text = await (await item.getType('text/plain')).text()
      if (text) return { kind: 'text', text }
    }
  }

  return null
}

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

  /** 失敗を記録する。再試行なら文言だけ差し替え、そうでなければ1件足す。 */
  const recordFailure = (payload: Payload, retryOf: number | undefined, message: string) => {
    if (retryOf !== undefined) {
      // 再試行がまた失敗した場合。同じ内容を二重に並べない。
      setFailures((failures) =>
        failures.map((failure) => {
          if (failure.id !== retryOf) return failure
          return { ...failure, message }
        }),
      )
      return
    }
    const id = nextFailureId.current++
    setFailures((failures) => [...failures, { id, payload, message }])
  }

  /**
   * 保存する。`retryOf` があれば、その失敗の再試行として扱う。
   *
   * **複数が同時に走りうる**ので、成否はどれも「自分の1件」にしか触らない。
   */
  const run = async (payload: Payload, retryOf?: number) => {
    setError(null)

    // **送る前に大きさで弾く**（prd/03 §1.4）。20MB 超をアップロードしきってから 413 で
    // 捨てるのは、モバイル回線では待ち時間と通信量の両方が無駄になる。
    //
    // ⚠ 弾く根拠が **`File.size`（実測値）である**ことが重要。`File.type` は申告値なので
    // 事前判定に使わない（正しい画像でも空や汎用値になり、利用者が回避できない誤判定に
    // なる。§1.2 / `pickImageCandidate`）。**形式の判定はサーバーのシグネチャ検証のまま。**
    //
    // **`try` の外でやる。** 通信していないので進行中に数える必要がなく、そもそも
    // **React Compiler は `try` 内の `throw` を扱えない**（prd/01 §1）。
    if (payload.kind === 'image' && payload.file.size > MAX_IMAGE_BYTES) {
      recordFailure(payload, retryOf, IMAGE_TOO_LARGE_MESSAGE)
      return
    }

    setInFlight((count) => count + 1)
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
      recordFailure(payload, retryOf, message)
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

      // ファイルが含まれていれば画像、無ければテキスト（人間に選ばせない。§1.1）。
      // 対象外の形式かどうかは**送ってサーバーに判定させる**（`pickImageCandidate` 参照）。
      const image = pickImageCandidate(Array.from(data.files))
      if (image) {
        event.preventDefault()
        void run({ kind: 'image', file: image })
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
    //
    // **取り出し（`extractPayload`）まで含めて囲む。** `read()` だけを囲むと、その後の
    // `getType()` や text 変換が失敗したときに Promise が reject したままになり、
    // 理由も代替経路の案内も出ない（§1.3）。
    let payload: Payload | null
    try {
      const items = await navigator.clipboard.read()
      payload = await extractPayload(items)
    } catch {
      // 権限拒否・読み取り不可・表現の取り出し失敗。
      //
      // ⚠ **ここで file input を click() しても開かない。** 権限 UI を経た後の catch では
      // クリック由来の transient user activation が切れており、iOS Safari はファイル選択を
      // 無視する。自動で開こうとすると「押しても何も起きない」状態になるので、
      // **利用者の次のタップに委ねる**（§1.3）。
      setError('クリップボードを読めませんでした。「画像を選ぶ」からお試しください')
      return
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

    // 判別はペーストと同じ規則。**ファイルが含まれていれば画像、無ければテキスト**（§1.1）。
    const image = pickImageCandidate(Array.from(event.dataTransfer.files))
    if (image) {
      void run({ kind: 'image', file: image })
      return
    }

    // 選択テキストのドラッグもここで拾う（拾わないと、落としても何も増えない）。
    const text = event.dataTransfer.getData('text/plain')
    if (text) {
      void run({ kind: 'text', text })
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

        {/* **`accept` を付けない**（§1.2）。他の経路と同じく、申告 MIME で事前に遮断しない。
            デスクトップの `accept` は「候補を絞るが選べなくはしない」誘導に留まるが、
            **iOS のファイルピッカーは条件に合わないものをグレーアウトし、
            「すべてのファイル」へ切り替える逃げ道が無い**。OS が正しい画像の MIME を
            空文字や `application/octet-stream` と申告した場合、**そもそも選べなくなる** —
            iPhone は主要端末（§1.3）であり、利用者が回避できない誤判定になる。
            `image/*` へ広げても申告依存は変わらないので、外す方を採る。
            対象外なら送信後に 415 が返り、§1.4 の文言が出る。 */}
        <input
          ref={fileInput}
          type="file"
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
