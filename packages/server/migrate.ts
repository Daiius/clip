import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { db } from './src/db/index.ts'

// drizzle-kit generate で作った drizzle/<timestamp>_<name>/migration.sql を順に適用する。
// 未適用のものだけが走る（記録先は __drizzle_migrations）。
//
// **本番イメージに同梱して `docker compose run --rm clip-migrate` で実行する。**
// マイグレーションとコードが同じイメージに入るため、両者のバージョンがずれない。
//
// 参照先は cwd ではなくこのファイルからの相対にする。バンドル後は /app/migrate.js と
// /app/drizzle が並ぶが、cwd に依存すると実行のしかたで壊れる。
const migrationsFolder = fileURLToPath(new URL('./drizzle', import.meta.url))

// 一発限りの CLI。プールの終了待ちに頼らず明示的に exit する
// （seseraki で、tunnel 越しだと close が返らずプロセスが終わらない事例があった）。
try {
  await migrate(db, { migrationsFolder })
  console.log('migrations applied (up to date)')
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
