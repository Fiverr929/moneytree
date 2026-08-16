"use client";

import DB from "@/lib/db";

type StoredUuid = { uuid?: string };
type StudioStateImage = { uuid?: string };
type StudioStateGroup = { images?: StudioStateImage[] };
type StudioStateEntry = { layers?: { groups?: StudioStateGroup[] } };
type StudioStateRecord = { histories?: Record<string, StudioStateEntry> };

export async function pruneProjectImages(projectId: number) {
  const [references, gallery, images, studioState] = await Promise.all([
    DB.references.getByProject(projectId),
    DB.gallery.getByProject(projectId),
    DB.images.getByProject(projectId),
    DB.studioState.get(projectId),
  ]);

  const keep = new Set<string>();

  (references as StoredUuid[]).forEach((file) => {
    if (file.uuid) keep.add(file.uuid);
  });

  (gallery as StoredUuid[]).forEach((cell) => {
    if (cell.uuid) keep.add(cell.uuid);
  });

  const histories = (studioState as StudioStateRecord | undefined)?.histories || {};
  Object.values(histories).forEach((entry) => {
    entry.layers?.groups?.forEach((group) => {
      group.images?.forEach((image) => {
        if (image.uuid) keep.add(image.uuid);
      });
    });
  });

  await Promise.all(
    (images as Array<{ uuid: string }>)
      .filter((image) => !keep.has(image.uuid))
      .map((image) => DB.images.delete(image.uuid)),
  );
}
