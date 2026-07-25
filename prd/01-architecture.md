# 01. アーキテクチャ

> 本章の内容は**全て計画**（実装は未着手）。

## 1. 技術スタック

既存リポジトリ（`seseraki` / `highscore-must-fall`）と揃える。運用・バックアップ・マイグレーションの
手順が共通になり、踏んだ罠を共有できることを優先した判断である（[_grilling/decisions.md](./_grilling/decisions.md)）。

| 層 | 採用 |
|---|---|
| 言語 | TypeScript（フルスタック） |
| パッケージ管理 | pnpm workspace（monorepo） |
| DB | MySQL 8.4 |
| ORM | Drizzle ORM |
| API | Hono（Hono RPC で web と型を共有する） |
| Front | React 19 + Vite + TanStack Router |
| スタイル | **TailwindCSS v4 + daisyUI** |
| 画像の実体 | SeaweedFS（S3 互換） |

**daisyUI を使う理由**: 個人用ツールにデザインの意思決定コストを掛けないため。素の Tailwind だと
ボタン・カード・モーダルの見た目を毎回自分で決めることになる。daisyUI のコンポーネントクラスに
寄せ、独自のデザイントークンを持ち込まない。

**メモ化は React Compiler に委ねる**。`useMemo` / `useCallback` / `React.memo` は原則書かない。
手書きで足したくなったら、まず Rules of React 違反でコンパイラが諦めていないかを疑う。

## 2. パッケージ構成

| パッケージ | 役割 |
|---|---|
| `packages/web` | UI（React + Vite + TanStack Router + Tailwind v4 + daisyUI） |
| `packages/server` | Hono(RPC) API・DB スキーマ・BlobStore・認証 |

**`shared` パッケージは作らない。** web と server が共有するのは API の型だけであり、それは
Hono RPC が担う。共有したい純ロジックが実際に現れてから切り出す。

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
| `server` | Hono API | しない（web の `/api` proxy 経由で届く） |
| `web` | Vite dev サーバ | **する**（唯一の外向きの口） |

```bash
pnpm dev          # docker compose up --build --watch で全サービス起動
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm build        # 全パッケージのビルド
pnpm db:push      # dev: スキーマを DB に強制同期（使い捨て DB 向け）
```

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
| Vite の許可ホスト / HMR | なし | `allowedHosts` + `hmr wss:443` | `${DEV_ALLOWED_HOST}` を `vite.config.ts` が判定 |

**具体的なバインドアドレス・ポート・ドメイン・前段の設定は公開しない**（`.env.remote` と
`.claude-personal/`）。

## 5. デプロイ姿勢

- 公開配置の前提: HTTPS / シークレット管理（`.env*` はコミットしない）/ **同一オリジン配信**
  （`/api` を書き換えず server へ転送）。同一オリジンのため CORS は原則不要。
- **アプリは前段プロキシの認証に依存しない**（[04](./04-auth-and-privacy.md)）。前段があってもなくても、
  アプリ単体で保護が成立する。
- 本番/開発の具体情報は公開リポに含めない。PRD は姿勢のみ記述し、具体は `.claude-personal/` に置く。
