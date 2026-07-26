import type { ListedClip } from '../clips.ts'
import { ClipCard } from './clip-card.tsx'

/**
 * 一覧（prd/03 §2）。**新しい順の時系列のみ**で、検索も絞り込みも持たない。
 * 受け渡し用途では目的のものは大抵一番上にあるので、最上部が最新であることを優先する。
 */
export function ClipList({
  clips,
  selectedIds,
  onSelectedChange,
  hasMore,
  loadingMore,
  onLoadMore,
  onChanged,
}: {
  clips: ListedClip[]
  selectedIds: ReadonlySet<string>
  onSelectedChange: (id: string, selected: boolean) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onChanged: () => void
}) {
  if (clips.length === 0) {
    return (
      <p className="py-12 text-center text-base-content/50 text-sm">
        まだ何もありません。貼るとここに増えます。
      </p>
    )
  }

  return (
    <>
      <ul className="flex list-none flex-col gap-3">
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            selected={selectedIds.has(clip.id)}
            onSelectedChange={(selected) => onSelectedChange(clip.id, selected)}
            onDeleted={onChanged}
          />
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-4 w-full"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? <span className="loading loading-spinner loading-sm" /> : 'もっと見る'}
        </button>
      )}
    </>
  )
}
