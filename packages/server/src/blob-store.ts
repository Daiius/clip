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
      const result = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!result.Body) throw new Error(`blob が空です (key=${key})`)

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
