import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

/**
 * 画像の実体の置き場（prd/02 §3）。**呼び出し側は保存先を知らない。**
 *
 * 実装は S3 互換クライアント1つで、接続先は compose 内の SeaweedFS。将来ローカルファイルや
 * 別のオブジェクトストレージへ差し替えられるが、**MVP では複数実装を用意しない**
 * （使わない抽象を先に作らない）。
 */
export interface BlobStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentLength?: number }>
  delete(key: string): Promise<void>
}

/**
 * 実体が無い（prd/02 §3.2）。**ストレージ障害とは区別する。**
 *
 * 削除は「S3 の実体 → DB 行」の順なので、途中で失敗すると**実体を失った行**が残る。
 * これは意図して選んだ「気づける異常」であり、**起こりうる正常系**である。
 * 呼び出し側がこれを 404 に変換できるよう、他の失敗と型で分ける
 * （区別せず全部 500 にすると、無認証の共有経路で応答の意味が変わってしまう）。
 */
export class BlobNotFoundError extends Error {
  constructor(key: string) {
    super(`blob が見つかりません (key=${key})`)
    this.name = 'BlobNotFoundError'
  }
}

/**
 * S3 の「オブジェクトが無い」応答か。
 *
 * SDK は `NoSuchKey` を投げるが、**S3 互換実装では名前が揺れる**ので HTTP 404 も見る。
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404
}

const required = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

/** オブジェクトキーは `clips/<id>`。`id` は ULID なので衝突しない（prd/02 §3）。 */
export function blobKeyFor(clipId: string): string {
  return `clips/${clipId}`
}

let client: S3Client | undefined
let bucketReady: Promise<void> | undefined

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: required('S3_ACCESS_KEY_ID'),
        secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
      },
      // SeaweedFS はパススタイル（`<endpoint>/<bucket>/<key>`）で受ける。
      forcePathStyle: true,
    })
  }
  return client
}

/**
 * バケットを一度だけ用意する。
 *
 * dev では volume を作り直すたびに空になるので、**存在しなければ作る**。既にあるときのエラーは
 * 握り潰す（`BucketAlreadyOwnedByYou` / `BucketAlreadyExists`）。
 */
async function ensureBucket(bucket: string): Promise<void> {
  if (!bucketReady) {
    bucketReady = getClient()
      .send(new CreateBucketCommand({ Bucket: bucket }))
      .then(() => undefined)
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : ''
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return
        // 作れない理由が他にあるなら、次の呼び出しでやり直せるように覚えない。
        bucketReady = undefined
        throw error
      })
  }
  await bucketReady
}

export function createS3BlobStore(): BlobStore {
  const bucket = required('S3_BUCKET')

  return {
    async put(key, body, contentType) {
      await ensureBucket(bucket)
      await getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
        }),
      )
    },

    async get(key) {
      await ensureBucket(bucket)

      const result = await getClient()
        .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        .catch((error: unknown) => {
          // **「無い」だけを型で分ける。** 障害はそのまま投げ、500 のままにする。
          if (isNotFound(error)) throw new BlobNotFoundError(key)
          throw error
        })

      if (!result.Body) throw new BlobNotFoundError(key)

      return {
        body: result.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        contentLength: result.ContentLength,
      }
    },

    async delete(key) {
      await ensureBucket(bucket)
      await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
