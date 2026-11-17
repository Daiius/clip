#!/usr/bin/env bash
# 本番 server イメージを、**ビルドの版を焼き込んで**ビルドする（prd/06 §3「ビルドの版」）。
#
# 使い方（リポジトリのどこから呼んでもよい。ビルドの文脈は常にこのリポジトリの根）:
#
#   scripts/build-server-image.sh            # ビルドして <名前>:<40 桁の SHA> と <名前>:latest を付ける
#   scripts/build-server-image.sh --check    # 何をビルドするかを表示するだけ（ビルドしない）
#
#   IMAGE_NAME=<名前>   イメージ名（既定: clip-server）
#   ALLOW_DIRTY=1       作業ツリーが汚れていてもビルドする（試し用。下記）
#
# やること:
#   1. 作業ツリーがきれいなことを確かめる（未追跡のファイルも含む）。汚れていたら止まる
#   2. コミットの SHA・UTC のビルド日時・dirty をビルド引数で渡して `docker build` する
#   3. `<名前>:<SHA>` と `<名前>:latest` の 2 つのタグを付ける
#
# **やらないこと: コンテナの起動・再起動・入れ替え。** ここはイメージを作るだけである。
# 入れ替えは配置先の手順で、サービスを名指しして行う。
#
# ⚠ **`latest` がこのビルドに付け替わる。** 1 つ前へ戻せるようにしたいなら、
#    **これを呼ぶ前に**今の `latest` へ別のタグを付けておくこと。
#
# ⚠ **入れ替えのときにビルドし直させない**（compose なら `up -d --no-build <service>`）。
#    ビルド引数なしで作り直されると、版が黙って `unknown` に戻る。
#
# なぜスクリプトにするか: `.dockerignore` が `.git` を除くので、イメージの中からは
# どのコミットかを知る手段が無い。**引数を渡し忘れてもビルドは通り、版が `unknown` になるだけ**
# なので、手で `docker build` を打つ運用では必ずいつか抜ける。
#
# ALLOW_DIRTY=1 のときは `dirty: true` を焼き込み、タグは `<名前>:<SHA>-dirty` だけにする
# （**`<SHA>` とも `latest` とも名乗らせない**。そのコミットの内容ではないため）。

set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-clip-server}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

check_only=0
case "${1:-}" in
  "") ;;
  --check) check_only=1 ;;
  *)
    echo "使い方: $0 [--check]" >&2
    exit 2
    ;;
esac

if ! commit="$(git -C "$ROOT" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)"; then
  echo "git のコミットが読めません: $ROOT" >&2
  exit 1
fi

# 未追跡のファイルも数える。`.dockerignore` に載っていなければビルドの文脈に入り、
# **コミットに無いものがイメージに入る**ため。
changes="$(git -C "$ROOT" status --porcelain)"
if [[ -n "$changes" ]]; then
  if [[ "${ALLOW_DIRTY:-}" != "1" ]]; then
    echo "作業ツリーがきれいではありません。コミットするか、きれいなチェックアウトで実行してください:" >&2
    echo "$changes" >&2
    exit 1
  fi
  dirty=true
  tags=("$IMAGE_NAME:$commit-dirty")
else
  dirty=false
  tags=("$IMAGE_NAME:$commit" "$IMAGE_NAME:latest")
fi

built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "commit  : $commit"
echo "builtAt : $built_at"
echo "dirty   : $dirty"
echo "tags    : ${tags[*]}"

if [[ "$check_only" == "1" ]]; then
  echo "（--check: ビルドしません）"
  exit 0
fi

tag_args=()
for tag in "${tags[@]}"; do
  tag_args+=(-t "$tag")
done

docker build \
  -f "$ROOT/packages/server/Dockerfile.prod" \
  --build-arg "GIT_COMMIT=$commit" \
  --build-arg "BUILD_TIME=$built_at" \
  --build-arg "GIT_DIRTY=$dirty" \
  "${tag_args[@]}" \
  "$ROOT"

echo "built   : ${tags[*]}"
