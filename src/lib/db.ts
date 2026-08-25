/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { projectTrashExpired, projectTrashMetadata } from "@/lib/projectLifecycle";

const DB_NAME = 'cafehtml-db';
let _db: IDBDatabase | null = null;

const S = {
  PROJECTS: 'projects',
  SETTINGS: 'settings',
  MODULE_STATE: 'module-state',
  REFERENCES: 'references',
  GALLERY: 'gallery',
  IMAGES: 'images',
  VIDEOS: 'videos',
  DESCRIPTIONS: 'descriptions',
  STUDIO_STATE: 'studio-state',
  GENERATION_JOBS: 'generation-jobs',
  AGENT_RUNS: 'agent-runs',
  AGENT_EVENTS: 'agent-events',
  AGENT_MEMORIES: 'agent-memories',
  AGENT_INSIGHTS: 'agent-insights',
  AGENT_MESSAGES: 'agent-messages',
  AGENT_CHECKPOINTS: 'agent-checkpoints',
  SYNC_TOMBSTONES: 'sync-tombstones'
};

function emitCloudChange(projectId?: number, kind = "project") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cafehtml:cloud-sync", { detail: { projectId, kind } }));
}

const ready = new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof window === "undefined") return; // SSR check
  
  const reqCurrent = indexedDB.open(DB_NAME);
  reqCurrent.onsuccess = (e: any) => {
    const db = e.target.result as IDBDatabase;
    const currentVersion = db.version || 1;
    const hasIndex = (storeName: string, indexName: string) =>
      db.objectStoreNames.contains(storeName) &&
      db.transaction(storeName).objectStore(storeName).indexNames.contains(indexName);
    const needsUpgrade = !db.objectStoreNames.contains(S.PROJECTS) ||
                         !db.objectStoreNames.contains(S.SETTINGS) ||
                         !db.objectStoreNames.contains(S.MODULE_STATE) ||
                         !db.objectStoreNames.contains(S.STUDIO_STATE) ||
                         !db.objectStoreNames.contains(S.REFERENCES) ||
                         !db.objectStoreNames.contains(S.GALLERY) ||
                         !db.objectStoreNames.contains(S.IMAGES) ||
                         !db.objectStoreNames.contains(S.VIDEOS) ||
                           !db.objectStoreNames.contains(S.DESCRIPTIONS) ||
                           !db.objectStoreNames.contains(S.GENERATION_JOBS) ||
                          !db.objectStoreNames.contains(S.AGENT_RUNS) ||
                         !db.objectStoreNames.contains(S.AGENT_EVENTS) ||
                         !hasIndex(S.PROJECTS, 'by_modified') ||
                         !hasIndex(S.REFERENCES, 'by_project') ||
                         !hasIndex(S.GALLERY, 'by_project') ||
                         !hasIndex(S.IMAGES, 'by_project') ||
                         !hasIndex(S.VIDEOS, 'by_project') ||
                          !hasIndex(S.GENERATION_JOBS, 'by_project') ||
                          !hasIndex(S.AGENT_RUNS, 'by_project') ||
                          !hasIndex(S.AGENT_RUNS, 'by_project_active') ||
                          !hasIndex(S.AGENT_EVENTS, 'by_project_created') ||
                         !db.objectStoreNames.contains(S.AGENT_MEMORIES) ||
                         !db.objectStoreNames.contains(S.AGENT_INSIGHTS) ||
                         !db.objectStoreNames.contains(S.AGENT_MESSAGES) ||
                         !db.objectStoreNames.contains(S.AGENT_CHECKPOINTS) ||
                         !db.objectStoreNames.contains(S.SYNC_TOMBSTONES) ||
                         !hasIndex(S.AGENT_MEMORIES, 'by_scope') ||
                         !hasIndex(S.AGENT_MEMORIES, 'by_project') ||
                         !hasIndex(S.AGENT_MEMORIES, 'by_session');
    const needsInsightUpgrade = !db.objectStoreNames.contains(S.AGENT_INSIGHTS)
      || !hasIndex(S.AGENT_INSIGHTS, 'by_project')
      || !hasIndex(S.AGENT_INSIGHTS, 'by_status');
    const needsConversationUpgrade = !db.objectStoreNames.contains(S.AGENT_MESSAGES)
      || !hasIndex(S.AGENT_MESSAGES, 'by_project')
      || !hasIndex(S.AGENT_MESSAGES, 'by_project_session_created')
      || !db.objectStoreNames.contains(S.AGENT_CHECKPOINTS)
      || !hasIndex(S.AGENT_CHECKPOINTS, 'by_project')
      || !hasIndex(S.AGENT_CHECKPOINTS, 'by_project_session_updated');
    db.close();

    const targetVersion = needsUpgrade || needsInsightUpgrade || needsConversationUpgrade ? currentVersion + 1 : currentVersion;

    const req = indexedDB.open(DB_NAME, targetVersion);
    req.onupgradeneeded = (e2: any) => {
      const db2 = e2.target.result as IDBDatabase;

      if (!db2.objectStoreNames.contains(S.PROJECTS)) {
        const ps = db2.createObjectStore(S.PROJECTS, { keyPath: 'id', autoIncrement: true });
        ps.createIndex('by_modified', 'date_modified');
      } else {
        const ps = e2.target.transaction.objectStore(S.PROJECTS);
        if (!ps.indexNames.contains('by_modified')) ps.createIndex('by_modified', 'date_modified');
      }
      if (!db2.objectStoreNames.contains(S.SETTINGS)) db2.createObjectStore(S.SETTINGS, { keyPath: 'project_id' });
      if (!db2.objectStoreNames.contains(S.MODULE_STATE)) db2.createObjectStore(S.MODULE_STATE, { keyPath: 'project_id' });
      if (!db2.objectStoreNames.contains(S.STUDIO_STATE)) db2.createObjectStore(S.STUDIO_STATE, { keyPath: 'project_id' });
      
      if (!db2.objectStoreNames.contains(S.REFERENCES)) {
        const rs = db2.createObjectStore(S.REFERENCES, { keyPath: 'id', autoIncrement: true });
        rs.createIndex('by_project', 'project_id');
      } else {
        const rs = e2.target.transaction.objectStore(S.REFERENCES);
        if (!rs.indexNames.contains('by_project')) rs.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.GALLERY)) {
        const gs = db2.createObjectStore(S.GALLERY, { keyPath: 'id', autoIncrement: true });
        gs.createIndex('by_project', 'project_id');
      } else {
        const gs = e2.target.transaction.objectStore(S.GALLERY);
        if (!gs.indexNames.contains('by_project')) gs.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.IMAGES)) {
        const is = db2.createObjectStore(S.IMAGES, { keyPath: 'uuid' });
        is.createIndex('by_project', 'project_id');
      } else {
        const is = e2.target.transaction.objectStore(S.IMAGES);
        if (!is.indexNames.contains('by_project')) is.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.VIDEOS)) {
        const vs = db2.createObjectStore(S.VIDEOS, { keyPath: 'id' });
        vs.createIndex('by_project', 'project_id');
      } else {
        const vs = e2.target.transaction.objectStore(S.VIDEOS);
        if (!vs.indexNames.contains('by_project')) vs.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.DESCRIPTIONS)) db2.createObjectStore(S.DESCRIPTIONS, { keyPath: 'uuid' });
      if (!db2.objectStoreNames.contains(S.GENERATION_JOBS)) {
        const js = db2.createObjectStore(S.GENERATION_JOBS, { keyPath: 'id' });
        js.createIndex('by_project', 'project_id');
      } else {
        const js = e2.target.transaction.objectStore(S.GENERATION_JOBS);
        if (!js.indexNames.contains('by_project')) js.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.AGENT_RUNS)) {
        const ars = db2.createObjectStore(S.AGENT_RUNS, { keyPath: 'id' });
        ars.createIndex('by_project', 'project_id');
        ars.createIndex('by_project_active', ['project_id', 'active']);
      } else {
        const ars = e2.target.transaction.objectStore(S.AGENT_RUNS);
        if (!ars.indexNames.contains('by_project')) ars.createIndex('by_project', 'project_id');
        if (!ars.indexNames.contains('by_project_active')) ars.createIndex('by_project_active', ['project_id', 'active']);
      }
      if (!db2.objectStoreNames.contains(S.AGENT_EVENTS)) {
        const aes = db2.createObjectStore(S.AGENT_EVENTS, { keyPath: 'id' });
        aes.createIndex('by_project_created', ['project_id', 'createdAt']);
      } else {
        const aes = e2.target.transaction.objectStore(S.AGENT_EVENTS);
        if (!aes.indexNames.contains('by_project_created')) aes.createIndex('by_project_created', ['project_id', 'createdAt']);
      }
      if (!db2.objectStoreNames.contains(S.AGENT_MEMORIES)) {
        const ams = db2.createObjectStore(S.AGENT_MEMORIES, { keyPath: 'id' });
        ams.createIndex('by_scope', 'scope');
        ams.createIndex('by_project', 'projectId');
        ams.createIndex('by_session', 'sessionId');
      } else {
        const ams = e2.target.transaction.objectStore(S.AGENT_MEMORIES);
        if (!ams.indexNames.contains('by_scope')) ams.createIndex('by_scope', 'scope');
        if (!ams.indexNames.contains('by_project')) ams.createIndex('by_project', 'projectId');
        if (!ams.indexNames.contains('by_session')) ams.createIndex('by_session', 'sessionId');
      }
      if (!db2.objectStoreNames.contains(S.AGENT_INSIGHTS)) {
        const ais = db2.createObjectStore(S.AGENT_INSIGHTS, { keyPath: 'id' });
        ais.createIndex('by_project', 'projectId');
        ais.createIndex('by_status', 'status');
      } else {
        const ais = e2.target.transaction.objectStore(S.AGENT_INSIGHTS);
        if (!ais.indexNames.contains('by_project')) ais.createIndex('by_project', 'projectId');
        if (!ais.indexNames.contains('by_status')) ais.createIndex('by_status', 'status');
      }
      if (!db2.objectStoreNames.contains(S.AGENT_MESSAGES)) {
        const messages = db2.createObjectStore(S.AGENT_MESSAGES, { keyPath: 'id' });
        messages.createIndex('by_project', 'project_id');
        messages.createIndex('by_project_session_created', ['project_id', 'session_id', 'createdAt']);
      } else {
        const messages = e2.target.transaction.objectStore(S.AGENT_MESSAGES);
        if (!messages.indexNames.contains('by_project')) messages.createIndex('by_project', 'project_id');
        if (!messages.indexNames.contains('by_project_session_created')) messages.createIndex('by_project_session_created', ['project_id', 'session_id', 'createdAt']);
      }
      if (!db2.objectStoreNames.contains(S.AGENT_CHECKPOINTS)) {
        const checkpoints = db2.createObjectStore(S.AGENT_CHECKPOINTS, { keyPath: 'id' });
        checkpoints.createIndex('by_project', 'project_id');
        checkpoints.createIndex('by_project_session_updated', ['project_id', 'session_id', 'updatedAt']);
      } else {
        const checkpoints = e2.target.transaction.objectStore(S.AGENT_CHECKPOINTS);
        if (!checkpoints.indexNames.contains('by_project')) checkpoints.createIndex('by_project', 'project_id');
        if (!checkpoints.indexNames.contains('by_project_session_updated')) checkpoints.createIndex('by_project_session_updated', ['project_id', 'session_id', 'updatedAt']);
      }
      if (!db2.objectStoreNames.contains(S.SYNC_TOMBSTONES)) {
        db2.createObjectStore(S.SYNC_TOMBSTONES, { keyPath: 'id' });
      }
    };

    req.onsuccess = (e2: any) => {
      const openedDb = e2.target.result as IDBDatabase;
      _db = openedDb;
      openedDb.onversionchange = () => {
        openedDb.close();
        _db = null;
      };
      resolve(openedDb);
    };
    req.onerror = (e2: any) => reject(e2.target.error);
  };
  reqCurrent.onerror = (e: any) => reject(e.target.error);
});

function tx(storeNames: string | string[], mode: IDBTransactionMode = 'readonly') {
  if (!_db) throw new Error("DB not ready");
  return _db.transaction(storeNames, mode);
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function deleteProjectRecordsByIndex(store: IDBObjectStore, projectId: number) {
  const request = store.index("by_project").openKeyCursor(IDBKeyRange.only(projectId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
}

async function deleteProjectCascade(id: number) {
  await ready;
  const transaction = tx(
    [
      S.PROJECTS,
      S.SETTINGS,
      S.MODULE_STATE,
      S.REFERENCES,
      S.GALLERY,
      S.IMAGES,
      S.VIDEOS,
      S.DESCRIPTIONS,
      S.STUDIO_STATE,
      S.GENERATION_JOBS,
      S.AGENT_RUNS,
      S.AGENT_EVENTS,
      S.AGENT_MEMORIES,
      S.AGENT_INSIGHTS,
      S.AGENT_MESSAGES,
      S.AGENT_CHECKPOINTS,
    ],
    "readwrite",
  );

  const imagesStore = transaction.objectStore(S.IMAGES);
  const descriptionsStore = transaction.objectStore(S.DESCRIPTIONS);
  const imagesRequest = imagesStore.getAll();

  imagesRequest.onsuccess = () => {
    (imagesRequest.result as Array<{ uuid: string; project_id?: number }>)
      .filter((image) => image.project_id === id)
      .forEach((image) => {
        imagesStore.delete(image.uuid);
        descriptionsStore.delete(image.uuid);
      });
  };

  deleteProjectRecordsByIndex(transaction.objectStore(S.REFERENCES), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.GALLERY), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.VIDEOS), id);
  transaction.objectStore(S.SETTINGS).delete(id);
  transaction.objectStore(S.MODULE_STATE).delete(id);
  transaction.objectStore(S.STUDIO_STATE).delete(id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.GENERATION_JOBS), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.AGENT_RUNS), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.AGENT_MEMORIES), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.AGENT_INSIGHTS), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.AGENT_MESSAGES), id);
  deleteProjectRecordsByIndex(transaction.objectStore(S.AGENT_CHECKPOINTS), id);
  const agentEventsStore = transaction.objectStore(S.AGENT_EVENTS);
  const agentEventsRequest = agentEventsStore.index('by_project_created').openKeyCursor(
    IDBKeyRange.bound([id, ""], [id, "\uffff"]),
  );
  agentEventsRequest.onsuccess = () => {
    const cursor = agentEventsRequest.result;
    if (!cursor) return;
    agentEventsStore.delete(cursor.primaryKey);
    cursor.continue();
  };
  transaction.objectStore(S.PROJECTS).delete(id);

  await transactionDone(transaction);
}

async function deleteProjectWithTombstone(id: number) {
  await ready;
  const project = await wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).get(id));
  const cloudId = project?.cloudId || project?.memoryCloudId;
  if (cloudId) {
    const deletedAt = new Date().toISOString();
    await wrap(tx(S.SYNC_TOMBSTONES, 'readwrite').objectStore(S.SYNC_TOMBSTONES).put({
      id: `project:${cloudId}`,
      kind: "project",
      projectCloudId: cloudId,
      deletedAt,
    }));
  }
  await deleteProjectCascade(id);
  emitCloudChange(undefined, "project-delete");
}

const projects = {
  getAllIncludingDeleted: () => ready.then(() => wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).getAll())),
  getAll: () => ready.then(async () => (
    (await wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).getAll())).filter((project: any) => !project.deletedAt)
  )),
  getTrash: () => ready.then(async () => (
    (await wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).getAll())).filter((project: any) => Boolean(project.deletedAt))
  )),
  get: (id: number) => ready.then(() => wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).get(id))),
  create: (data: any, syncSilent = false) => ready.then(() => {
    const now = new Date().toISOString();
    const cloudId = data.cloudId || data.memoryCloudId || crypto.randomUUID();
    const record = {
      mode: 'FRAME', thumbnail: null, ...data, cloudId, memoryCloudId: cloudId,
      date_created: data.date_created || now,
      date_modified: data.date_modified || now,
      cloudUpdatedAt: data.cloudUpdatedAt || data.date_modified || now,
      cloudSyncedAt: data.cloudSyncedAt || null,
    };
    return wrap(tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS).add(record)).then((id) => {
      if (!syncSilent) emitCloudChange(id as number, "project");
      return id;
    });
  }),
  update: (id: number, data: any, syncSilent = false) => ready.then(() => {
    const store = tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS);
    return wrap(store.get(id)).then(existing => {
      if (!existing) throw new Error('[DB] project not found: ' + id);
      const now = new Date().toISOString();
      const updated = syncSilent
        ? { ...existing, ...data, id }
        : { ...existing, ...data, id, date_modified: now, cloudUpdatedAt: now };
      return wrap(store.put(updated)).then((result) => {
        if (!syncSilent) emitCloudChange(id, "project");
        return result;
      });
    });
  }),
  trash: (id: number) => ready.then(async () => {
    const store = tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS);
    const existing = await wrap(store.get(id));
    if (!existing) throw new Error('[DB] project not found: ' + id);
    if (existing.deletedAt) return existing;
    const { deletedAt, purgeAfter } = projectTrashMetadata();
    const updated = {
      ...existing,
      id,
      deletedAt,
      purgeAfter,
      date_modified: deletedAt,
      cloudUpdatedAt: deletedAt,
      cloudSyncedAt: null,
    };
    await wrap(store.put(updated));
    emitCloudChange(id, "project-trash");
    return updated;
  }),
  restore: (id: number) => ready.then(async () => {
    const store = tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS);
    const existing = await wrap(store.get(id));
    if (!existing) throw new Error('[DB] project not found: ' + id);
    const restoredAt = new Date().toISOString();
    const active = { ...existing };
    delete active.deletedAt;
    delete active.purgeAfter;
    const updated = {
      ...active,
      id,
      date_modified: restoredAt,
      cloudUpdatedAt: restoredAt,
      cloudSyncedAt: null,
    };
    await wrap(store.put(updated));
    emitCloudChange(id, "project-restore");
    return updated;
  }),
  delete: (id: number) => projects.trash(id),
  deletePermanently: deleteProjectWithTombstone,
  purgeExpired: () => ready.then(async () => {
    const all = await wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).getAll());
    const now = Date.now();
    const expired = all.filter((project: any) => projectTrashExpired(project, now));
    for (const project of expired) await deleteProjectWithTombstone(project.id);
    return expired.length;
  }),
  deleteLocal: deleteProjectCascade,
};

const images = {
  get: (uuid: string) => ready.then(() => wrap(tx(S.IMAGES).objectStore(S.IMAGES).get(uuid))),
  getMany: (uuids: string[]) => ready.then(async () => {
    const uniqueUuids = [...new Set(uuids.filter(Boolean))];
    if (!uniqueUuids.length) return [];
    const store = tx(S.IMAGES).objectStore(S.IMAGES);
    return Promise.all(uniqueUuids.map((uuid) => wrap(store.get(uuid))));
  }),
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.IMAGES).objectStore(S.IMAGES).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  put: (uuid: string, dataUrl: string, projectId: number, syncSilent = false) => ready.then(async () => {
    const existing = await wrap(tx(S.IMAGES).objectStore(S.IMAGES).get(uuid));
    const unchanged = existing?.dataUrl === dataUrl;
    const result = await wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).put({
      ...(unchanged ? existing : {}),
      uuid,
      dataUrl,
      project_id: projectId,
      cloudFingerprint: unchanged ? existing?.cloudFingerprint || null : null,
      cloudSyncedAt: unchanged ? existing?.cloudSyncedAt || null : null,
    }));
    if (!syncSilent) emitCloudChange(projectId, "image");
    return result;
  }),
  markCloudSynced: (uuid: string, fingerprint: string) => ready.then(async () => {
    const existing = await wrap(tx(S.IMAGES).objectStore(S.IMAGES).get(uuid));
    if (!existing) return;
    await wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).put({
      ...existing,
      cloudFingerprint: fingerprint,
      cloudSyncedAt: new Date().toISOString(),
    }));
  }),
  markGenerationCloudSynced: (uuid: string, fingerprint: string) => ready.then(async () => {
    const existing = await wrap(tx(S.IMAGES).objectStore(S.IMAGES).get(uuid));
    if (!existing) return;
    await wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).put({
      ...existing,
      generationCloudFingerprint: fingerprint,
      generationCloudSyncedAt: new Date().toISOString(),
    }));
  }),
  delete: (uuid: string) => ready.then(() => wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).delete(uuid)))
};

const videos = {
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.VIDEOS).objectStore(S.VIDEOS).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  put: (data: any) => ready.then(() =>
    wrap(tx(S.VIDEOS, 'readwrite').objectStore(S.VIDEOS).put(data))
  ),
  putMany: (records: any[]) => ready.then(async () => {
    const transaction = tx(S.VIDEOS, 'readwrite');
    const store = transaction.objectStore(S.VIDEOS);
    records.forEach((record) => store.put(record));
    await transactionDone(transaction);
  }),
  delete: (id: string) => ready.then(() =>
    wrap(tx(S.VIDEOS, 'readwrite').objectStore(S.VIDEOS).delete(id))
  ),
};

const studioState = {
  get: (projectId: number) => ready.then(() => wrap(tx(S.STUDIO_STATE).objectStore(S.STUDIO_STATE).get(projectId))),
  save: (projectId: number, data: any) => ready.then(() => 
    wrap(tx(S.STUDIO_STATE, 'readwrite').objectStore(S.STUDIO_STATE).put({ project_id: projectId, ...data }))
  )
};

const gallery = {
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.GALLERY).objectStore(S.GALLERY).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  put: (data: any, syncSilent = false) => ready.then(async () => {
    const existing = data.id === undefined
      ? undefined
      : await wrap(tx(S.GALLERY).objectStore(S.GALLERY).get(data.id));
    const now = new Date().toISOString();
    if (!syncSilent && existing?.uuid && existing.uuid !== data.uuid) {
      const project = await projects.get(data.project_id);
      const projectCloudId = project?.cloudId || project?.memoryCloudId;
      if (projectCloudId) {
        await wrap(tx(S.SYNC_TOMBSTONES, 'readwrite').objectStore(S.SYNC_TOMBSTONES).put({
          id: `generation:${projectCloudId}:${existing.uuid}`,
          kind: "generation",
          projectCloudId,
          generationCloudId: existing.uuid,
          deletedAt: now,
        }));
      }
    }
    const record = syncSilent
      ? { ...existing, ...data }
      : { ...existing, ...data, cloudUpdatedAt: now, cloudSyncedAt: null };
    const result = await wrap(tx(S.GALLERY, 'readwrite').objectStore(S.GALLERY).put(record));
    if (!syncSilent && data.project_id && data.uuid) emitCloudChange(data.project_id, "generation");
    return result;
  }),
  delete: (id: number, syncSilent = false) => ready.then(async () => {
    const existing = await wrap(tx(S.GALLERY).objectStore(S.GALLERY).get(id));
    if (!syncSilent && existing?.uuid && existing?.project_id) {
      const project = await projects.get(existing.project_id);
      const projectCloudId = project?.cloudId || project?.memoryCloudId;
      if (projectCloudId) {
        const deletedAt = new Date().toISOString();
        await wrap(tx(S.SYNC_TOMBSTONES, 'readwrite').objectStore(S.SYNC_TOMBSTONES).put({
          id: `generation:${projectCloudId}:${existing.uuid}`,
          kind: "generation",
          projectCloudId,
          generationCloudId: existing.uuid,
          deletedAt,
        }));
      }
    }
    const result = await wrap(tx(S.GALLERY, 'readwrite').objectStore(S.GALLERY).delete(id));
    if (!syncSilent) emitCloudChange(existing?.project_id, "generation-delete");
    return result;
  })
};

const references = {
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.REFERENCES).objectStore(S.REFERENCES).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  put: (data: any, syncSilent = false) => ready.then(async () => {
    const store = tx(S.REFERENCES, 'readwrite').objectStore(S.REFERENCES);
    const existing = data.id === undefined ? undefined : await wrap(store.get(data.id));
    const now = new Date().toISOString();
    if (!syncSilent && existing?.uuid && existing.uuid !== data.uuid) {
      const project = await projects.get(data.project_id);
      const projectCloudId = project?.cloudId || project?.memoryCloudId;
      if (projectCloudId) {
        await wrap(tx(S.SYNC_TOMBSTONES, 'readwrite').objectStore(S.SYNC_TOMBSTONES).put({
          id: `reference:${projectCloudId}:${existing.uuid}`,
          kind: "reference",
          projectCloudId,
          referenceCloudId: existing.uuid,
          deletedAt: now,
        }));
      }
    }
    const record = syncSilent
      ? { ...existing, ...data }
      : { ...existing, ...data, cloudUpdatedAt: now, cloudSyncedAt: null };
    const result = await wrap(tx(S.REFERENCES, 'readwrite').objectStore(S.REFERENCES).put(record));
    if (!syncSilent) emitCloudChange(data.project_id, "reference");
    return result;
  }),
  delete: (id: number, syncSilent = false) => ready.then(async () => {
    const store = tx(S.REFERENCES, 'readwrite').objectStore(S.REFERENCES);
    const existing = await wrap(store.get(id));
    if (!syncSilent && existing?.uuid && existing?.project_id) {
      const project = await projects.get(existing.project_id);
      const projectCloudId = project?.cloudId || project?.memoryCloudId;
      if (projectCloudId) {
        const deletedAt = new Date().toISOString();
        await wrap(tx(S.SYNC_TOMBSTONES, 'readwrite').objectStore(S.SYNC_TOMBSTONES).put({
          id: `reference:${projectCloudId}:${existing.uuid}`,
          kind: "reference",
          projectCloudId,
          referenceCloudId: existing.uuid,
          deletedAt,
        }));
      }
    }
    const result = await wrap(tx(S.REFERENCES, 'readwrite').objectStore(S.REFERENCES).delete(id));
    if (!syncSilent) emitCloudChange(existing?.project_id, "reference-delete");
    return result;
  })
};

const moduleState = {
  get: (projectId: number) => ready.then(() =>
    wrap(tx(S.MODULE_STATE).objectStore(S.MODULE_STATE).get(projectId))
  ),
  put: (projectId: number, data: any, syncSilent = false) => ready.then(() => {
    const now = new Date().toISOString();
    return wrap(tx(S.MODULE_STATE, 'readwrite').objectStore(S.MODULE_STATE).put({
      ...data,
      project_id: projectId,
      cloudUpdatedAt: syncSilent ? data.cloudUpdatedAt : now,
      cloudSyncedAt: syncSilent ? data.cloudSyncedAt : null,
    })).then((result) => {
      if (!syncSilent) emitCloudChange(projectId, "folders");
      return result;
    });
  }),
};

const descriptions = {
  get: (uuid: string) => ready.then(() => wrap(tx(S.DESCRIPTIONS).objectStore(S.DESCRIPTIONS).get(uuid))),
  put: (uuid: string, description: string) => ready.then(() => 
    wrap(tx(S.DESCRIPTIONS, 'readwrite').objectStore(S.DESCRIPTIONS).put({ uuid, description }))
  )
};

const generationJobs = {
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.GENERATION_JOBS).objectStore(S.GENERATION_JOBS).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  put: (data: any) => ready.then(() =>
    wrap(tx(S.GENERATION_JOBS, 'readwrite').objectStore(S.GENERATION_JOBS).put(data))
  ),
  delete: (id: string) => ready.then(() =>
    wrap(tx(S.GENERATION_JOBS, 'readwrite').objectStore(S.GENERATION_JOBS).delete(id))
  ),
};

const agentRuns = {
  getActive: (projectId: number) => ready.then(() => {
    const idx = tx(S.AGENT_RUNS).objectStore(S.AGENT_RUNS).index('by_project_active');
    return wrap(idx.get([projectId, 1]));
  }),
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.AGENT_RUNS).objectStore(S.AGENT_RUNS).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  saveActive: (projectId: number, data: any) => ready.then(async () => {
    const transaction = tx(S.AGENT_RUNS, 'readwrite');
    const store = transaction.objectStore(S.AGENT_RUNS);
    const cursorRequest = store.index('by_project').openCursor(IDBKeyRange.only(projectId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const record = cursor.value;
      if (record.active === 1 && record.id !== data.id) cursor.update({ ...record, active: 0 });
      cursor.continue();
    };
    store.put({
      ...data,
      project_id: projectId,
      active: 1,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    });
    await transactionDone(transaction);
  }),
  clearActive: (projectId: number) => ready.then(async () => {
    const transaction = tx(S.AGENT_RUNS, 'readwrite');
    const store = transaction.objectStore(S.AGENT_RUNS);
    const cursorRequest = store.index('by_project_active').openCursor(IDBKeyRange.only([projectId, 1]));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.update({ ...cursor.value, active: 0, updatedAt: new Date().toISOString() });
      cursor.continue();
    };
    await transactionDone(transaction);
  }),
};

const agentEvents = {
  put: (projectId: number, data: any) => ready.then(() =>
    wrap(tx(S.AGENT_EVENTS, 'readwrite').objectStore(S.AGENT_EVENTS).put({ ...data, project_id: projectId }))
  ),
  getByProject: (projectId: number) => ready.then(() => {
    const index = tx(S.AGENT_EVENTS).objectStore(S.AGENT_EVENTS).index('by_project_created');
    return wrap(index.getAll(IDBKeyRange.bound([projectId, ""], [projectId, "\uffff"])));
  }),
  recordProjectMutation: (projectId: number, projectData: any, event: any) => ready.then(async () => {
    const transaction = tx([S.PROJECTS, S.AGENT_EVENTS], 'readwrite');
    const projectsStore = transaction.objectStore(S.PROJECTS);
    const existing = await wrap(projectsStore.get(projectId));
    if (!existing) throw new Error('[DB] project not found: ' + projectId);
    const now = new Date().toISOString();
    projectsStore.put({ ...existing, ...projectData, id: projectId, date_modified: now, cloudUpdatedAt: now, cloudSyncedAt: null });
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
    emitCloudChange(projectId, "project");
  }),
  recordReferenceMutation: (projectId: number, reference: any, event: any) => ready.then(async () => {
    const transaction = tx([S.REFERENCES, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.REFERENCES).put({
      ...reference,
      project_id: projectId,
      cloudUpdatedAt: new Date().toISOString(),
      cloudSyncedAt: null,
    });
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
    emitCloudChange(projectId, "reference");
  }),
  recordModuleMutation: (projectId: number, moduleData: any, event: any) => ready.then(async () => {
    const transaction = tx([S.MODULE_STATE, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.MODULE_STATE).put({
      ...moduleData,
      project_id: projectId,
      cloudUpdatedAt: new Date().toISOString(),
      cloudSyncedAt: null,
    });
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
    emitCloudChange(projectId, "folders");
  }),
  recordReferenceCreation: (projectId: number, reference: any, imageDataUrl: string, event: any) => ready.then(async () => {
    const transaction = tx([S.REFERENCES, S.IMAGES, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.REFERENCES).put({
      ...reference,
      project_id: projectId,
      cloudUpdatedAt: new Date().toISOString(),
      cloudSyncedAt: null,
    });
    if (reference.uuid && imageDataUrl) {
      transaction.objectStore(S.IMAGES).put({ uuid: reference.uuid, dataUrl: imageDataUrl, project_id: projectId });
    }
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
    emitCloudChange(projectId, "reference");
  }),
  recordReferenceDeletion: (projectId: number, referenceId: number, imageUuid: string, event: any) => ready.then(async () => {
    const project = await projects.get(projectId);
    const projectCloudId = project?.cloudId || project?.memoryCloudId;
    const transaction = tx([S.REFERENCES, S.IMAGES, S.AGENT_EVENTS, S.SYNC_TOMBSTONES], 'readwrite');
    transaction.objectStore(S.REFERENCES).delete(referenceId);
    if (imageUuid) transaction.objectStore(S.IMAGES).delete(imageUuid);
    if (projectCloudId && imageUuid) {
      const deletedAt = new Date().toISOString();
      transaction.objectStore(S.SYNC_TOMBSTONES).put({
        id: `reference:${projectCloudId}:${imageUuid}`,
        kind: "reference",
        projectCloudId,
        referenceCloudId: imageUuid,
        deletedAt,
      });
    }
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
    emitCloudChange(projectId, "reference-delete");
  }),
};

const agentMemories = {
  getAll: () => ready.then(() => wrap(tx(S.AGENT_MEMORIES).objectStore(S.AGENT_MEMORIES).getAll())),
  put: (data: any) => ready.then(() => (
    wrap(tx(S.AGENT_MEMORIES, 'readwrite').objectStore(S.AGENT_MEMORIES).put(data))
  )),
  delete: (id: string) => ready.then(() => (
    wrap(tx(S.AGENT_MEMORIES, 'readwrite').objectStore(S.AGENT_MEMORIES).delete(id))
  )),
  deleteMany: (ids: string[]) => ready.then(async () => {
    if (!ids.length) return;
    const transaction = tx(S.AGENT_MEMORIES, 'readwrite');
    const store = transaction.objectStore(S.AGENT_MEMORIES);
    ids.forEach((id) => store.delete(id));
    await transactionDone(transaction);
  }),
};

const agentInsights = {
  get: (id: string) => ready.then(() => (
    wrap(tx(S.AGENT_INSIGHTS).objectStore(S.AGENT_INSIGHTS).get(id))
  )),
  getByProject: (projectId: number) => ready.then(() => (
    wrap(tx(S.AGENT_INSIGHTS).objectStore(S.AGENT_INSIGHTS).index('by_project').getAll(projectId))
  )),
  put: (data: any) => ready.then(() => (
    wrap(tx(S.AGENT_INSIGHTS, 'readwrite').objectStore(S.AGENT_INSIGHTS).put(data))
  )),
};

const agentMessages = {
  putMany: (projectId: number, sessionId: string, messages: any[]) => ready.then(async () => {
    if (!messages.length) return;
    const transaction = tx(S.AGENT_MESSAGES, 'readwrite');
    const store = transaction.objectStore(S.AGENT_MESSAGES);
    messages.forEach((message) => store.put({
      ...message,
      project_id: projectId,
      session_id: sessionId,
      schemaVersion: 1,
    }));
    await transactionDone(transaction);
  }),
  getBySession: (projectId: number, sessionId: string) => ready.then(() => {
    const index = tx(S.AGENT_MESSAGES).objectStore(S.AGENT_MESSAGES).index('by_project_session_created');
    return wrap(index.getAll(IDBKeyRange.bound(
      [projectId, sessionId, ""],
      [projectId, sessionId, "\uffff"],
    )));
  }),
};

const agentCheckpoints = {
  put: (data: any) => ready.then(() => (
    wrap(tx(S.AGENT_CHECKPOINTS, 'readwrite').objectStore(S.AGENT_CHECKPOINTS).put(data))
  )),
  putMany: (records: any[]) => ready.then(async () => {
    if (!records.length) return;
    const transaction = tx(S.AGENT_CHECKPOINTS, 'readwrite');
    const store = transaction.objectStore(S.AGENT_CHECKPOINTS);
    records.forEach((record) => store.put(record));
    await transactionDone(transaction);
  }),
  getBySession: (projectId: number, sessionId: string) => ready.then(() => {
    const index = tx(S.AGENT_CHECKPOINTS).objectStore(S.AGENT_CHECKPOINTS).index('by_project_session_updated');
    return wrap(index.getAll(IDBKeyRange.bound(
      [projectId, sessionId, ""],
      [projectId, sessionId, "\uffff"],
    )));
  }),
};

const syncTombstones = {
  getAll: () => ready.then(() => wrap(tx(S.SYNC_TOMBSTONES).objectStore(S.SYNC_TOMBSTONES).getAll())),
  delete: (id: string) => ready.then(() => (
    wrap(tx(S.SYNC_TOMBSTONES, 'readwrite').objectStore(S.SYNC_TOMBSTONES).delete(id))
  )),
};

const DB = {
  ready,
  projects,
  images,
  videos,
  studioState,
  gallery,
  references,
  moduleState,
  descriptions,
  generationJobs,
  agentRuns,
  agentEvents,
  agentMemories,
  agentInsights,
  agentMessages,
  agentCheckpoints,
  syncTombstones,
};
export default DB;


