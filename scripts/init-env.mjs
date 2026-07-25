#!/usr/bin/env node
/**
 * `.env.*.example` から `.env.*` を作る初回セットアップ（既存ファイルは上書きしない）。
 *
 * POSIX shell の構文で書くと Windows の `cmd.exe` で動かないため、OS を選ばない Node で書く。
 * compose が `env_file` として要求するので、これが無いと `pnpm dev` は起動しない（prd/01 §3）。
 */
import { copyFileSync, existsSync } from 'node:fs'

const targets = ['database', 'server', 'web']

let created = 0
for (const name of targets) {
  const source = `.env.${name}.example`
  const destination = `.env.${name}`

  if (existsSync(destination)) {
    console.log(`skip   ${destination}（既にあります）`)
    continue
  }
  copyFileSync(source, destination)
  console.log(`create ${destination}`)
  created += 1
}

if (created > 0) {
  console.log(
    '\n作成したファイルは example のダミー値のままです。' +
      '認証を使う段階になったら AUTH_PASSWORD と SESSION_SECRET を自分の値に変えてください。',
  )
}
