# 01. アーキテクチャ

> **本章は全て実装済み。** monorepo 構成 / compose（db・seaweedfs・server・web）/ 開発コマンド /
> 同一オリジン配信（Phase 1-1）/ **Hono RPC による server・web 間の API 型共有**（Phase 1-3）/
> **リモート dev 公開**（`.env.remote` による差分集約。前段プロキシ越しの動作確認済み。Phase 1-7）。

## 1. 技術スタック

既存リポジトリ（`seseraki` / `highscore-must-fall`）と揃える。運用・バックアップ・マイグレーションの
手順が共通になり、踏んだ罠を共有できることを優先した判断である（[_grilling/decisions.md](./_grilling/decisions.md)）。

| 層 | 採用 |
|---|---|
| 実行環境 | Node.js **22.12 以上**（Vite 8 の要件。`engines.node` で宣言する） |
| 言語 | TypeScript（フルスタック） |
| パッケージ管理 | pnpm workspace（monorepo） |
| DB | MySQL 8.4 |
| ORM | Drizzle ORM |
| API | Hono（Hono RPC で web と型を共有する） |
| Front | React 19 + Vite + TanStack Router |
| スタイル | **TailwindCSS v4 + daisyUI** |
| 画像の実体 | SeaweedFS（S3 互換） |
| lint / format | Biome（`pnpm check` / `pnpm format`） |
| テスト | Vitest |

**daisyUI を使う理由**: 個人用ツールにデザインの意思決定コストを掛けないため。素の Tailwind だと
ボタン・カード・モーダルの見た目を毎回自分で決めることになる。daisyUI のコンポーネントクラスに
寄せ、独自のデザイントークンを持ち込まない。

**メモ化は React Compiler に委ねる**。`useMemo` / `useCallback` / `React.memo` は原則書かない。
手書きで足したくなったら、まず Rules of React 違反でコンパイラが諦めていないかを疑う。

**React Compiler は `panicThreshold: 'all_errors'` で動かす。** 諦めた箇所を黙って素通しにすると、
「メモ化はコンパイラに委ねる」という前提が静かに崩れるため。代わりに、**コンパイラが扱えない
書き方はビルドが落ちる**。⚠ **`pnpm typecheck` では検出できず、`pnpm build` で初めて分かる。**
コンポーネント／フックの中で現時点で書けないもの:

| 書けないもの | 代わりに |
|---|---|
| `try { } finally { }` の `finally` 節 | `catch` を return させず、解除処理を `try/catch` の後ろに置く |
| `try` 内の value block（三項演算子・論理演算・optional chaining） | `if` / `else` に開く |
| **`try` 内の `throw`** | 検査を `try` の外へ出し、失敗は throw せず記録する |
| 動的 `import()` | 静的 import にする |

## 2. パッケージ構成

| パッケージ | 役割 |
|---|---|
| `packages/web` | UI（React + Vite + TanStack Router + Tailwind v4 + daisyUI） |
| `packages/server` | Hono(RPC) API・DB スキーマ・BlobStore・認証 |

**`shared` パッケージは作らない。** web と server が共有するのは、**API の型**（Hono RPC が担う）と、
**投入の上限値**（`server/limits`）だけ。後者は web が `server` を workspace 依存として
直接 import する。**共有物が2つ現れた程度で中間パッケージを作らない。**

> 上限値を web 側へ**書き写さない**のは、サーバーの上限を上げたときにクライアントだけが
> 古い値のまま厳しくなり、**正しい画像が投入できなくなる**ため（利用者が回避できない向きの
> 誤判定になる。[03](./03-ux.md) §1.4）。そのため `server/limits` には
> **zod も drizzle も持ち込まない**（定数だけを置き、ブラウザ側の束にサーバー専用コードを混ぜない）。

**DB スキーマは `packages/server` 内に置く**（`database` パッケージに分けない）。テーブルが1つの
規模で分割の定型句を先に払う理由がない（[02](./02-data-model.md)）。

## 3. 開発環境

`docker compose` で全サービスを起動する。**ホストにポートを出すのは web だけ**とし、
db / server / seaweedfs は compose 網内に閉じる（他プロジェクトとのポート衝突を避け、
remote 公開時の外向きの口を1つに保つため）。

| サービス | 役割 | ホスト公開 |
|---|---|---|
| `db` | MySQL 8.4 | しない |
| `seaweedfs` | S3 互換ストレージ | しない |
| `server` | Hono API | しない（web の proxy 経由で届く） |
| `web` | Vite dev サーバ | **する**（唯一の外向きの口） |

**Vite が server へ転送するのは `/api` と `/s`**（[04](./04-auth-and-privacy.md) §3.1 の共有パス）。
ここに載っていないパスは Vite の SPA フォールバックに落ち、**`index.html` が返る**。
**サーバー側にルートを足すときは、この転送設定にも足す**（忘れると、実装したはずの API が
静かに `index.html` を返す）。

**初回だけ `.env.*` を用意する。** compose が `env_file` として要求するため、これが無いと起動しない。

```bash
pnpm install
pnpm init:env     # .env.*.example から .env.* を作る（既存ファイルは上書きしない）
```

`init:env` が作るのは **example のダミー値のまま**である。**起動する前に** `AUTH_PASSWORD`
（32 文字以上のランダム文字列）と `SESSION_SECRET` を自分の値へ置き換えること
（[04](./04-auth-and-privacy.md) §2）。**ダミー値は example として公開されており、認証は
常に有効**なので、そのまま起動すると誰でもログインできる状態になる。

```bash
pnpm dev          # docker compose up --build --watch で全サービス起動
pnpm down         # 停止（volume は残す）
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm build        # 全パッケージのビルド
pnpm test         # 全パッケージ vitest run
pnpm check        # biome（lint + format 検査）
pnpm format       # biome で整形
pnpm db:push      # dev: スキーマを DB に強制同期（使い捨て DB 向け）
```

> **`pnpm db:push` は compose 内の `server` コンテナで `drizzle-kit push` を実行する。**
> db をホストに公開していないため、ホストから直接は繋げない（§3 の表）。スタックが起動している
> ことが前提になる。
>
> ⚠ **`push` は dev 専用である。** 差分を推測して DDL を出すため、本番に使うと
> **列のリネームを削除 + 追加と解釈しうる**。本番はバージョン管理マイグレーションを使う
> （[06](./06-deployment.md) §4）。

環境変数は `.env.database` / `.env.server` / `.env.web` に分け、**`.env.*.example` だけを追跡する**。

## 4. リモート dev 環境

常駐マシン上の dev スタックを、前段プロキシ（認証付き）越しに手元ブラウザから使う。

**ローカル dev と remote で compose / vite 設定を分けない。** 単一の `compose.yml` と
`vite.config.ts` を環境変数でパラメータ化し、remote 差分は `.env.remote` だけに集約する
（`seseraki` の `REMOTE-DEV.md` と同じ方式）。

| 差分 | ローカル既定 | remote | 効かせ方 |
|---|---|---|---|
| web の公開バインド | 全 IF | ループバックのみ | compose `${WEB_BIND}` |
| secure cookie | `false` | `true` | compose `${COOKIE_SECURE}` → server |
| Vite の許可ホスト / HMR | なし | `allowedHosts` + `hmr wss:443` | `${PUBLIC_ORIGIN}` から host を導出して `vite.config.ts` が判定 |
| 共有 URL のオリジン | `http://localhost:5173`（既定値） | `${PUBLIC_ORIGIN}` | server が組み立てる（[03](./03-ux.md) §6） |

**ローカル既定を全 IF にしてあるのは、黙ってそうなっているのではなく選んだ結果である。**
`WEB_BIND` を設定し忘れた `docker compose up` は dev サーバーをローカルネットワークへ出すが、
**そこから外部への到達経路が無い**ことと、**アプリ自身が認証を持つ**こと（[04](./04-auth-and-privacy.md) §1）が
根拠になっている。ループバック既定に変えても `.env.remote` の付け忘れ自体は防げず
（バインド先が変われば前段からは届かなくなる）、代わりに**同一ネットワークの別端末から
ローカル dev を見る**経路が失われる。
⚠ **この根拠はネットワークの性質であってリポジトリの性質ではない。** 別の場所で動かすときは
成り立たない。

**共有リンクに書く絶対 URL のオリジンは、`PUBLIC_ORIGIN` から取る。未設定ならローカル dev の
既定値（`http://localhost:5173` = web の公開ポート）を使う。**

⚠ **リクエストの `Host` ヘッダからは組めない。** 一見すると「**取りに来られたホストは、
その受け手にとって到達可能だと実証済み**」という筋の通った案に見えるが、**この構成では成立しない**:

- **dev では Vite の proxy が `changeOrigin: true` で Host を書き換える。** server が見るのは
  利用者のオリジンではなく転送先（`server:4000`）であり、そこから組んだ URL は
  **ホストに公開していない server を指す**（§3 の表）。ブラウザからも受け手からも届かない。
- **remote では正しいスキームが得られない。** 前段は平文でコンテナへ繋ぐので server が見るのは
  `http` であり、`https` を組むには `X-Forwarded-Proto` を信じる必要がある。
  [04](./04-auth-and-privacy.md) §1 が**前段を前提にしない**と宣言している以上、
  前段のヘッダ設定に正しさを預けない。

つまり **server は自分の公開オリジンを発見できない。設定として受け取るしかない。**
ローカルの既定値は `WEB_BIND` の既定（5173）と対応する。**別のポートで公開するなら
`PUBLIC_ORIGIN` を設定する**（既定値のままだと、届かない URL のリンクが黙って発行される）。

**具体的なバインドアドレス・ポート・ドメイン・前段の設定は公開しない**（`.env.remote` と
`.claude-personal/`）。

## 5. デプロイ姿勢

> **本番のビルドと配置は [06](./06-deployment.md) が正典。** ここには、開発環境と共通する前提だけを置く。

- 公開配置の前提: HTTPS / シークレット管理（`.env*` はコミットしない）/ **同一オリジン配信**
  （`/api` を書き換えず server へ転送）。同一オリジンのため CORS は原則不要。
- **アプリは前段プロキシの認証に依存しない**（[04](./04-auth-and-privacy.md)）。前段があってもなくても、
  アプリ単体で保護が成立する。
- 本番/開発の具体情報は公開リポに含めない。PRD は姿勢のみ記述し、具体は `.claude-personal/` に置く。

**本章（開発環境）と [06](./06-deployment.md)（本番）で違うのは、静的資産を誰が配るかである。**
dev は Vite が配って `/api` と `/s` を転送し、本番は前段プロキシが配って同じ 2 つを転送する。
**アプリが持つ経路は両方で変わらない**（[06](./06-deployment.md) §2）。
