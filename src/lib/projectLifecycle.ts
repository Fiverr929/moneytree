export const PROJECT_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function projectTrashMetadata(now = new Date()) {
  return {
    deletedAt: now.toISOString(),
    purgeAfter: new Date(now.getTime() + PROJECT_TRASH_RETENTION_MS).toISOString(),
  };
}

export function projectIsTrashed(project: { deletedAt?: string | null }) {
  return Boolean(project.deletedAt);
}

export function projectTrashExpired(project: { deletedAt?: string | null; purgeAfter?: string | null }, now = Date.now()) {
  return projectIsTrashed(project) && Boolean(project.purgeAfter) && Date.parse(project.purgeAfter!) <= now;
}
