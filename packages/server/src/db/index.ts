import { drizzle } from 'drizzle-orm/mysql2'
import { type Pool, createPool } from 'mysql2'

/**
 * DB 接続（prd/01 §3）。接続先は compose 網内の `db` で、ホストには公開していない。
 *
 * 資格情報が無ければ起動時に落とす。既定値で暗黙に別の DB を掴むより、動かない方が安全なため。
 */
const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const client: Pool = createPool({
  host: process.env.DB_HOST ?? 'db',
  port: Number(process.env.DB_PORT ?? 3306),
  user: required('MYSQL_USER'),
  password: required('MYSQL_PASSWORD'),
  database: required('MYSQL_DATABASE'),
  // Date ⇄ DATETIME のシリアライズを UTC 固定にする。プロセス TZ（compose では Asia/Tokyo）に
  // 依存させると、保存した時刻と読み出した時刻がずれる。
  timezone: 'Z',
})

export const db = drizzle({ client })
