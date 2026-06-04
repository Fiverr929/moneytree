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
  DESCRIPTIONS: 'descriptions',
  STUDIO_STATE: 'studio-state'
};

const ready = new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof window === "undefined") return; // SSR check
  
  const reqCurrent = indexedDB.open(DB_NAME);
  reqCurrent.onsuccess = (e: any) => {
    const db = e.target.result as IDBDatabase;
    const currentVersion = db.version || 1;
    const needsUpgrade = !db.objectStoreNames.contains(S.PROJECTS) ||
                         !db.objectStoreNames.contains(S.SETTINGS) ||
                         !db.objectStoreNames.contains(S.MODULE_STATE) ||
                         !db.objectStoreNames.contains(S.STUDIO_STATE) ||
                         !db.objectStoreNames.contains(S.REFERENCES) ||
                         !db.objectStoreNames.contains(S.GALLERY) ||
                         !db.objectStoreNames.contains(S.IMAGES) ||
                         !db.objectStoreNames.contains(S.DESCRIPTIONS);
    db.close();

    const targetVersion = needsUpgrade ? currentVersion + 1 : currentVersion;

    const req = indexedDB.open(DB_NAME, targetVersion);
    req.onupgradeneeded = (e2: any) => {
      const db2 = e2.target.result as IDBDatabase;

      if (!db2.objectStoreNames.contains(S.PROJECTS)) {
        const ps = db2.createObjectStore(S.PROJECTS, { keyPath: 'id', autoIncrement: true });
        ps.createIndex('by_modified', 'date_modified');
      }
      if (!db2.objectStoreNames.contains(S.SETTINGS)) db2.createObjectStore(S.SETTINGS, { keyPath: 'project_id' });
      if (!db2.objectStoreNames.contains(S.MODULE_STATE)) db2.createObjectStore(S.MODULE_STATE, { keyPath: 'project_id' });
      if (!db2.objectStoreNames.contains(S.STUDIO_STATE)) db2.createObjectStore(S.STUDIO_STATE, { keyPath: 'project_id' });
      
      if (!db2.objectStoreNames.contains(S.REFERENCES)) {
        const rs = db2.createObjectStore(S.REFERENCES, { keyPath: 'id', autoIncrement: true });
        rs.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.GALLERY)) {
        const gs = db2.createObjectStore(S.GALLERY, { keyPath: 'id', autoIncrement: true });
        gs.createIndex('by_project', 'project_id');
      }
      if (!db2.objectStoreNames.contains(S.IMAGES)) db2.createObjectStore(S.IMAGES, { keyPath: 'uuid' });
      if (!db2.objectStoreNames.contains(S.DESCRIPTIONS)) db2.createObjectStore(S.DESCRIPTIONS, { keyPath: 'uuid' });
    };

    req.onsuccess = (e2: any) => {
      _db = e2.target.result;
      resolve(_db!);
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
  delete: (id: number) => ready.then(() => {
    const store = tx(S.PROJECTS, 'readwrite').objectStore(S.PROJECTS);
    return wrap(store.delete(id));
  })
};

const images = {
  get: (uuid: string) => ready.then(() => wrap(tx(S.IMAGES).objectStore(S.IMAGES).get(uuid))),
  put: (uuid: string, dataUrl: string, projectId: number) => ready.then(() => 
    wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).put({ uuid, dataUrl, project_id: projectId }))
  ),
  delete: (uuid: string) => ready.then(() => wrap(tx(S.IMAGES, 'readwrite').objectStore(S.IMAGES).delete(uuid)))
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

const descriptions = {
  get: (uuid: string) => ready.then(() => wrap(tx(S.DESCRIPTIONS).objectStore(S.DESCRIPTIONS).get(uuid))),
  put: (uuid: string, description: string) => ready.then(() => 
    wrap(tx(S.DESCRIPTIONS, 'readwrite').objectStore(S.DESCRIPTIONS).put({ uuid, description }))
  )
};

const DB = { ready, projects, images, studioState, gallery, references, descriptions };
export default DB;


