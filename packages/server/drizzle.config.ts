import { defineConfig } from 'drizzle-kit'

// dev のスキーマ同期（`pnpm db:push`）用の設定。
// 接続先は呼び出し環境の env から取る。compose 内で実行する前提なので既定は `db`（prd/01 §3）。
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    host: process.env.DB_HOST ?? 'db',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'clip',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'clip',
  },
})
