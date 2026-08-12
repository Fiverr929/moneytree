/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

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
  AGENT_EVENTS: 'agent-events'
};

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
                          !hasIndex(S.AGENT_EVENTS, 'by_project_created');
    db.close();

    const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;

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

const projects = {
  getAll: () => ready.then(() => wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).getAll())),
  get: (id: number) => ready.then(() => wrap(tx(S.PROJECTS).objectStore(S.PROJECTS).get(id))),
  create: (data: any) => ready.then(() => {
    const now = new Date().toISOString();
    const record = { mode: 'FRAME', thumbnail: null, ...data, date_created: now, date_modified: now };
    return wrap(tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS).add(record));
  }),
  update: (id: number, data: any) => ready.then(() => {
    const store = tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS);
    return wrap(store.get(id)).then(existing => {
      if (!existing) throw new Error('[DB] project not found: ' + id);
      return wrap(store.put({ ...existing, ...data, id, date_modified: new Date().toISOString() }));
    });
  }),
  delete: deleteProjectCascade,
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
  put: (uuid: string, dataUrl: string, projectId: number) => ready.then(() => 
    wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).put({ uuid, dataUrl, project_id: projectId }))
  ),
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
  put: (data: any) => ready.then(() => wrap(tx(S.GALLERY, 'readwrite').objectStore(S.GALLERY).put(data))),
  delete: (id: number) => ready.then(() => wrap(tx(S.GALLERY, 'readwrite').objectStore(S.GALLERY).delete(id)))
};

const references = {
  getByProject: (projectId: number) => ready.then(() => {
    const idx = tx(S.REFERENCES).objectStore(S.REFERENCES).index('by_project');
    return wrap(idx.getAll(projectId));
  }),
  put: (data: any) => ready.then(() => wrap(tx(S.REFERENCES, 'readwrite').objectStore(S.REFERENCES).put(data))),
  delete: (id: number) => ready.then(() => wrap(tx(S.REFERENCES, 'readwrite').objectStore(S.REFERENCES).delete(id)))
};

const moduleState = {
  get: (projectId: number) => ready.then(() =>
    wrap(tx(S.MODULE_STATE).objectStore(S.MODULE_STATE).get(projectId))
  ),
  put: (projectId: number, data: any) => ready.then(() =>
    wrap(tx(S.MODULE_STATE, 'readwrite').objectStore(S.MODULE_STATE).put({ ...data, project_id: projectId }))
  ),
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
    projectsStore.put({ ...existing, ...projectData, id: projectId, date_modified: new Date().toISOString() });
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
  }),
  recordReferenceMutation: (projectId: number, reference: any, event: any) => ready.then(async () => {
    const transaction = tx([S.REFERENCES, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.REFERENCES).put({ ...reference, project_id: projectId });
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
  }),
  recordModuleMutation: (projectId: number, moduleData: any, event: any) => ready.then(async () => {
    const transaction = tx([S.MODULE_STATE, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.MODULE_STATE).put({ ...moduleData, project_id: projectId });
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
  }),
  recordReferenceCreation: (projectId: number, reference: any, imageDataUrl: string, event: any) => ready.then(async () => {
    const transaction = tx([S.REFERENCES, S.IMAGES, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.REFERENCES).put({ ...reference, project_id: projectId });
    if (reference.uuid && imageDataUrl) {
      transaction.objectStore(S.IMAGES).put({ uuid: reference.uuid, dataUrl: imageDataUrl, project_id: projectId });
    }
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
  }),
  recordReferenceDeletion: (projectId: number, referenceId: number, imageUuid: string, event: any) => ready.then(async () => {
    const transaction = tx([S.REFERENCES, S.IMAGES, S.AGENT_EVENTS], 'readwrite');
    transaction.objectStore(S.REFERENCES).delete(referenceId);
    if (imageUuid) transaction.objectStore(S.IMAGES).delete(imageUuid);
    transaction.objectStore(S.AGENT_EVENTS).put({ ...event, project_id: projectId });
    await transactionDone(transaction);
  }),
};

const DB = { ready, projects, images, videos, studioState, gallery, references, moduleState, descriptions, generationJobs, agentRuns, agentEvents };
export default DB;


