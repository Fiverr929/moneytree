import type { GalleryCell } from "@/context/GalleryContext";

export function isHudImageCell(cell: GalleryCell) {
  return Boolean(cell.imgUrl && !cell.loadingId && !cell.blocked && !cell.error);
}

export function galleryCellForStorage(cell: GalleryCell): GalleryCell {
  const stored = { ...cell };
  delete stored.imgUrl;
  delete stored.loadingId;
  delete stored.retryFn;
  return stored;
}
