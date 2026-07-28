# AGENTS.md

> このファイルがリポジトリの**正典**です（使用する各コーディングエージェント共通）。簡潔・リンク中心に保つこと。
> 詳細仕様は [`prd/`](./prd/) を参照。

## プロジェクト目的

手元の複数端末（Windows / MacBook / iPhone）の間で、**テキストと画像を気軽に貼って、
すぐプレビューできる個人用の共有ツール**。チャットサービスのメッセージ欄を
「端末間クリップボード」として流用していたのを、専用の web アプリで置き換える。

→ 詳細は [`prd/README.md`](./prd/README.md)。

## ステータス

**[Phase 1（MVP）完了](./prd/05-roadmap.md)。** 認証・投入（ペースト / 貼り付けボタン / D&D /
ファイル選択）・一覧・プレビュー・コピー / ダウンロード・削除が動き、**remote dev 環境で
手元の端末から実際に受け渡しができる**。
**Phase 2 も完了。**[共有トークン](./prd/04-auth-and-privacy.md)で、LLM のセッションへ選んだものだけを期限付きリンクで渡せる。
**Phase 3（本番配置）は設計のみ確定・未着手**（[prd/06](./prd/06-deployment.md)）。
[`prd/`](./prd/) の各章は冒頭に「どこまで実装済みか」を書く。**実装を変えたら同じ PR で PRD も直すこと。**

## 技術スタック / 構成

フルスタック TypeScript の **pnpm monorepo**。詳細は [prd/01](./prd/01-architecture.md)。

- **DB**: MySQL 8.4 / **API**: Hono(RPC) / **ORM**: Drizzle ORM
- **Front**: React 19 + Vite + TanStack Router + **TailwindCSS v4 + daisyUI**
  - デザインの意思決定コストを掛けないため **daisyUI のコンポーネントに寄せる**。独自のデザイントークンを持ち込まない。
  - **メモ化は React Compiler に委ねる**。`useMemo` / `useCallback` / `React.memo` は原則書かない。
- **画像の実体**: SeaweedFS（S3 互換）。メタデータは MySQL（[prd/02](./prd/02-data-model.md)）。

| パッケージ | 役割 |
|---|---|
| `packages/web` | UI（React + Vite + TanStack Router + Tailwind v4 + daisyUI） |
| `packages/server` | Hono(RPC) API・DB スキーマ・BlobStore・認証 |

> `shared` も `database` も作らない（[prd/01](./prd/01-architecture.md) §2）。

## ドキュメント（PRD）

| 文書 | 内容 |
|---|---|
| [prd/README.md](./prd/README.md) | 目的 / スコープ / アーキ概観 / 索引 / 秘匿方針 |
| [prd/01-architecture.md](./prd/01-architecture.md) | 技術スタック / monorepo / 開発環境 / リモート dev / デプロイ姿勢 |
| [prd/02-data-model.md](./prd/02-data-model.md) | DB スキーマ（clips）/ BlobStore / 画像の配信 / 上限 |
| [prd/03-ux.md](./prd/03-ux.md) | 投入口 / 一覧とプレビュー / 取り出し / 削除 / 端末ごとの経路 |
| [prd/04-auth-and-privacy.md](./prd/04-auth-and-privacy.md) | 認証 / ルート保護 / 公開配置の前提 |
| [prd/05-roadmap.md](./prd/05-roadmap.md) | フェーズ分け / 未実装・やらないこと / 確定事項 |
| [prd/06-deployment.md](./prd/06-deployment.md) | 本番の配信の形 / 本番イメージ / マイグレーション / 前段が満たすべき条件 |

> 仕様策定の経緯（grill ログ）: [`prd/_grilling/decisions.md`](./prd/_grilling/decisions.md)

## レビュー運用（oculibis）

PR は `oculibis` レビュー bot に掛ける。レビュー対象の文書は
[`.github/review-bot.json`](./.github/review-bot.json) で宣言し、**bot は default branch から読む**
（PR head からは読まない）。

```bash
gh pr comment <PR> --body "@oculibis review"
```

- **完了はトリガーコメントに付く `+1` リアクションで判定する。** `eyes` は受理、`+1` は publish 成功。
  **bot のコメントの有無で判定してはいけない**（managed comment は新規作成せず1つを更新し続けるため、
  2回目以降は開始直後から既存コメントが存在し、完了と誤判定する）。
- 指摘があれば直して**追加コミットを積み**、再度トリガーする。**指摘ゼロになるまで**繰り返す。
- 的外れだと感じる指摘は、対応せず PR に理由をコメントして人間の判断を仰ぐ。

## Git / PR 運用

- **レビュー中の PR は追加コミットを積む**。`git commit --amend` + `git push --force` はしない
  （レビュー bot はコミット単位で追随でき、対応履歴も追いやすい）。
- 最終的な履歴整形は **squash マージ**に任せる（PR タイトルが正典コミットになる）。

## 公開リポジトリ方針

本リポジトリは公開のため、コード・文書に以下を持ち込まない（詳細は [prd/README.md](./prd/README.md) §秘匿方針）:

- 秘密情報（`.env*`・API_KEY・DB 資格情報・cookie の値）。
- 本番/開発の具体情報（ドメイン・TLS・接続先・リバースプロキシ）。姿勢のみ記述する。
- **このアプリに実際に貼り付けた内容**（スクリーンショット・テキスト）。動作確認の証跡を残すときは
  差し支えのないダミーを使う。

## ローカル専用メモ（存在すれば読む）

`.claude-personal/CLAUDE.md`（gitignore 対象）が**存在する場合は、セッション開始時に必ず読む**。
ローカル限定の作業メモ・運用情報はそこから辿る（個々のファイルは公開文書に列挙しない）。
