import DB from "@/lib/db";

export type StoredStudioImage = {
  uuid: string;
  url: string;
  visible?: boolean;
};

export type StoredStudioGroup = {
  action: string;
  name: string;
  images: StoredStudioImage[];
};

export type StudioStateEntry = {
  history: string[];
  activeUrl: string | null;
  layers: { groups: StoredStudioGroup[] };
};

type StudioStateRecord = {
  project_id?: number;
  histories?: Record<string, StudioStateEntry>;
};

const MAX_STUDIO_HISTORY = 20;
const projectQueues = new Map<number, Promise<void>>();

const limitHistory = (items: string[]) => items.slice(0, MAX_STUDIO_HISTORY);

const prependUnique = (url: string, history: string[]) => (
  limitHistory([url, ...history.filter((item) => item !== url)])
);

function serializeProjectUpdate<T>(projectId: number, task: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(projectId) || Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  const queued = result.then(() => undefined, () => undefined);
  projectQueues.set(projectId, queued);
  void queued.finally(() => {
    if (projectQueues.get(projectId) === queued) projectQueues.delete(projectId);
  });
  return result;
}

function historiesFor(record: StudioStateRecord | undefined) {
  return { ...(record?.histories || {}) };
}

function legacyEntry(
  histories: Record<string, StudioStateEntry>,
  workspaceKey: string,
  legacyUuid?: string,
) {
  if (!legacyUuid || legacyUuid === workspaceKey) return undefined;
  return histories[legacyUuid];
}

export function moduleStudioWorkspaceKey(fileId: number) {
  return `module:${fileId}`;
}

export function galleryStudioWorkspaceKey(cellId: number) {
  return `gallery:${cellId}`;
}

export async function loadStudioEntry(
  projectId: number,
  workspaceKey: string,
  legacyUuid?: string,
  currentImageUrl?: string,
): Promise<StudioStateEntry | undefined> {
  return serializeProjectUpdate(projectId, async () => {
    const record = await DB.studioState.get(projectId) as StudioStateRecord | undefined;
    const histories = historiesFor(record);
    const current = histories[workspaceKey];
    if (current) return current;

    const directLegacy = legacyEntry(histories, workspaceKey, legacyUuid);
    const matchingLegacyEntries = currentImageUrl
      ? Object.entries(histories).filter(([key, entry]) => (
          !key.startsWith("module:")
          && !key.startsWith("gallery:")
          && (entry.activeUrl === currentImageUrl || entry.history?.includes(currentImageUrl))
        ))
      : [];
    const matchedLegacy = matchingLegacyEntries.length === 1 ? matchingLegacyEntries[0] : undefined;
    const legacyKey = directLegacy ? legacyUuid : matchedLegacy?.[0];
    const legacy = directLegacy || matchedLegacy?.[1];
    if (!legacy) return undefined;

    histories[workspaceKey] = legacy;
    if (legacyKey) delete histories[legacyKey];
    await DB.studioState.save(projectId, { ...record, histories });
    return legacy;
  });
}

export async function saveStudioEntry(
  projectId: number,
  workspaceKey: string,
  entry: StudioStateEntry,
  legacyUuid?: string,
) {
  return serializeProjectUpdate(projectId, async () => {
    const record = await DB.studioState.get(projectId) as StudioStateRecord | undefined;
    const histories = historiesFor(record);
    const existing = histories[workspaceKey] || legacyEntry(histories, workspaceKey, legacyUuid);
    const mergedHistory = limitHistory([
      ...entry.history,
      ...(existing?.history || []).filter((url) => !entry.history.includes(url)),
    ]);
    const hasUnseenActiveResult = Boolean(
      existing?.activeUrl && !entry.history.includes(existing.activeUrl),
    );
    histories[workspaceKey] = {
      ...entry,
      history: mergedHistory,
      activeUrl: hasUnseenActiveResult ? existing!.activeUrl : entry.activeUrl,
    };
    if (legacyUuid && legacyUuid !== workspaceKey) delete histories[legacyUuid];
    await DB.studioState.save(projectId, { ...record, histories });
  });
}

export async function appendStudioResult(input: {
  projectId: number;
  workspaceKey: string;
  legacyUuid?: string;
  generatedUrl: string;
  fallbackHistory: string[];
  fallbackGroups: StoredStudioGroup[];
  activateResult: boolean;
}) {
  return serializeProjectUpdate(input.projectId, async () => {
    const record = await DB.studioState.get(input.projectId) as StudioStateRecord | undefined;
    const histories = historiesFor(record);
    const existing = histories[input.workspaceKey]
      || legacyEntry(histories, input.workspaceKey, input.legacyUuid);
    const history = prependUnique(input.generatedUrl, existing?.history || input.fallbackHistory);
    histories[input.workspaceKey] = {
      history,
      activeUrl: input.activateResult
        ? input.generatedUrl
        : existing?.activeUrl || existing?.history?.[0] || input.fallbackHistory[0] || null,
      layers: existing?.layers || { groups: input.fallbackGroups },
    };
    if (input.legacyUuid && input.legacyUuid !== input.workspaceKey) {
      delete histories[input.legacyUuid];
    }
    await DB.studioState.save(input.projectId, { ...record, histories });
    return histories[input.workspaceKey];
  });
}
