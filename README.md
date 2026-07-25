# clip

手元の複数端末（Windows / MacBook / iPhone）の間で、テキストと画像を気軽に貼って
すぐプレビューできる**個人用の共有ツール**。

**実装中。** monorepo 雛形と compose が動く段階で、投入・一覧・認証はこれからです
（[prd/05-roadmap.md](./prd/05-roadmap.md)）。仕様は [prd/](./prd/) に、その決定理由は
[prd/_grilling/decisions.md](./prd/_grilling/decisions.md) にあります。

## 開発の始め方

```bash
pnpm install
pnpm init:env   # 初回のみ: .env.*.example から .env.* を作る（既存ファイルは上書きしない）
pnpm dev        # docker compose up --build --watch → http://localhost:5173
```

`.env.*` は gitignore 対象で、`pnpm init:env` が作るのは **example のダミー値のまま**です。
認証を実装する段階になったら、**`AUTH_PASSWORD`（32 文字以上のランダム文字列）と
`SESSION_SECRET` を必ず自分の値に変えてください**（[prd/04](./prd/04-auth-and-privacy.md) §2）。

- 正典: [AGENTS.md](./AGENTS.md)
- 仕様: [prd/](./prd/)
