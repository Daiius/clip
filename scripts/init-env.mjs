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
  // ⚠ この文言を「後で変えればよい」方向へ緩めないこと。**ダミー値は example として公開済み**で、
  // 認証は常に有効（prd/04 §2）。起動してから直す案内にすると、既知のパスワードと署名鍵のまま
  // 動くことを許してしまう。
  console.log(
    '\n作成したファイルは example のダミー値のままです。' +
      '\n⚠ 起動する前に AUTH_PASSWORD（32 文字以上のランダム文字列）と SESSION_SECRET を' +
      '\n   必ず自分の値に変えてください（公開済みのダミー値のままでは誰でもログインできます）。',
  )
}
