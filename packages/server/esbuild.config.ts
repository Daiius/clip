import { build } from 'esbuild'

// 本番イメージ用のバンドル（prd/06 §3）。
//
// 実行環境（distroless）は node_modules を持たないため、依存はすべてバンドルに含める。
// エントリは2つで、**どちらも同じイメージに入る**:
//
//   src/index.ts … サーバー本体
//   migrate.ts   … マイグレーションの適用（prd/06 §4）
//
// ⚠ **出力の拡張子を `.mjs` にする。** 実行環境に package.json を置かないので、
// `.js` のままだと ESM か CJS かの判定を Node の推測に委ねることになる。
// **`.mjs` は常に ESM** なので、判定の余地そのものが無くなる。
// （distroless には shell が無く、最終段で `package.json` を生成する RUN が打てない。
//   ビルド段から COPY する手もあるが、拡張子で解決できるものにファイルを増やさない。）
await build({
  // ⚠ **エントリは名前付きで渡す。** 配列で渡すと出力先が入力の共通ベースからの相対になり、
  // `src/index.ts` は `dist/src/index.mjs` に落ちる（2つのエントリが別階層にあるため）。
  // 名前付きなら出力名を直接決められる。
  entryPoints: { server: './src/index.ts', migrate: './migrate.ts' },
  outdir: './dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: false,
  // バンドルに取り込む依存の中には CJS のものがあり（mysql2 など）、実行時に `require` を
  // 呼ぶ経路が残る。ESM 出力には `require` が無いので、ここで作って渡す。
  banner: {
    js: [
      "import { createRequire } from 'node:module'",
      "import { fileURLToPath } from 'node:url'",
      "import { dirname } from 'node:path'",
      'const require = createRequire(import.meta.url)',
      'const __filename = fileURLToPath(import.meta.url)',
      'const __dirname = dirname(__filename)',
    ].join('\n'),
  },
})

console.log('bundled: dist/server.mjs, dist/migrate.mjs')
