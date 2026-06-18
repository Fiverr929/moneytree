import type { GalleryCell } from "@/context/GalleryContext";

export function isHudImageCell(cell: GalleryCell) {
  return Boolean(cell.imgUrl && !cell.loadingId && !cell.blocked && !cell.error);
}
