# clip

手元の複数端末（Windows / MacBook / iPhone）の間で、テキストと画像を気軽に貼って
すぐプレビューできる**個人用の共有ツール**。

**Phase 1（MVP）完了。** 認証・投入（ペースト / 貼り付けボタン / D&D / ファイル選択）・一覧・
プレビュー・コピー / ダウンロード・削除が動きます（[prd/05-roadmap.md](./prd/05-roadmap.md)）。
仕様は [prd/](./prd/) に、その決定理由は
[prd/_grilling/decisions.md](./prd/_grilling/decisions.md) にあります。

## 開発の始め方

```bash
pnpm install
pnpm init:env   # 初回のみ: .env.*.example から .env.* を作る（既存ファイルは上書きしない）
pnpm dev        # docker compose up --build --watch → http://localhost:5173
```

`.env.*` は gitignore 対象で、`pnpm init:env` が作るのは **example のダミー値のまま**です。
**`AUTH_PASSWORD`（32 文字以上のランダム文字列）と `SESSION_SECRET` は、起動前に必ず
自分の値に変えてください**（[prd/04](./prd/04-auth-and-privacy.md) §2）。

- 正典: [AGENTS.md](./AGENTS.md)
- 仕様: [prd/](./prd/)
