"use client";

import DB from "@/lib/db";

type LocalProject = {
  id: number;
  name?: string;
  mode?: string;
  cloudId?: string;
  memoryCloudId?: string;
  date_created: string;
  date_modified: string;
  cloudUpdatedAt?: string;
  cloudSyncedAt?: string | null;
};

type LocalReference = {
  id: number;
  uuid: string;
  project_id: number;
  name: string;
  label: string;
  folder: string | null;
  kind: string;
  size: string;
  dims: string;
  modified: string;
  eye: boolean;
  strength: number;
  mode: string;
  visualRead?: string;
  visualReadSource?: "local" | "vision";
  cloudUpdatedAt?: string;
  cloudSyncedAt?: string | null;
};

type CloudProject = { id: string; name: string; mode: string; createdAt: string; updatedAt: string };
type CloudState = { projectId: string; folders: unknown[]; updatedAt: string };
type CloudReference = {
  id: string;
  projectId: string;
  name: string;
  label: string;
  folder: string | null;
  kind: string;
  size: string;
  dims: string;
  modified: string;
  eye: boolean;
  strength: number;
  mode: string;
  visualRead?: string | null;
  visualReadSource?: "local" | "vision" | null;
  updatedAt: string;
};

type SyncResponse = {
  projects: CloudProject[];
  states: CloudState[];
  deletedProjects: Array<{ id: string; deletedAt: string }>;
  references: CloudReference[];
  deletedReferences: Array<{ id: string; projectId: string; deletedAt: string }>;
};

type SyncTombstone = {
  id: string;
  kind: "project" | "reference";
  projectCloudId: string;
  referenceCloudId?: string;
  deletedAt: string;
};

const uploadedImageFingerprints = new Map<string, string>();
const projectSyncs = new Map<number, Promise<void>>();
let workspaceSync: Promise<void> | null = null;
let listenerInstalled = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function validSyncResponse(value: unknown): value is SyncResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<SyncResponse>;
  return Array.isArray(body.projects)
    && Array.isArray(body.states)
    && Array.isArray(body.deletedProjects)
    && Array.isArray(body.references)
    && Array.isArray(body.deletedReferences);
}

async function postSync(payload: Record<string, unknown>) {
  const response = await fetch("/api/cloud-workspace/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Cloud workspace sync failed.");
  const body = await response.json();
  if (!validSyncResponse(body)) throw new Error("Cloud workspace sync returned invalid data.");
  return body;
}

async function ensureProjectIdentity(project: LocalProject) {
  const cloudId = project.cloudId || project.memoryCloudId || crypto.randomUUID();
  if (project.cloudId === cloudId && project.memoryCloudId === cloudId) return { ...project, cloudId };
  const cloudUpdatedAt = project.cloudUpdatedAt || project.date_modified;
  await DB.projects.update(project.id, { cloudId, memoryCloudId: cloudId, cloudUpdatedAt }, true);
  return { ...project, cloudId, memoryCloudId: cloudId, cloudUpdatedAt };
}

async function processTombstones() {
  const tombstones = await DB.syncTombstones.getAll() as SyncTombstone[];
  for (const tombstone of tombstones) {
    const params = new URLSearchParams({
      project_id: tombstone.projectCloudId,
      deleted_at: tombstone.deletedAt,
    });
    let path = "/api/cloud-workspace/project";
    if (tombstone.kind === "reference" && tombstone.referenceCloudId) {
      path = "/api/cloud-workspace/reference";
      params.set("reference_id", tombstone.referenceCloudId);
    }
    const response = await fetch(`${path}?${params}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sync a workspace deletion.");
    await DB.syncTombstones.delete(tombstone.id);
  }
  return tombstones.length;
}

async function applyWorkspaceResponse(body: SyncResponse, localProjects: LocalProject[]) {
  const syncedAt = new Date().toISOString();
  const localByCloudId = new Map(localProjects
    .map((project) => [project.cloudId || project.memoryCloudId, project] as const)
    .filter((entry): entry is [string, LocalProject] => Boolean(entry[0])));

  for (const deletion of body.deletedProjects) {
    const local = localByCloudId.get(deletion.id);
    if (local) {
      await DB.projects.deleteLocal(local.id);
      localByCloudId.delete(deletion.id);
    }
  }

  for (const remote of body.projects) {
    const existing = localByCloudId.get(remote.id);
    if (!existing) {
      const id = await DB.projects.create({
        name: remote.name,
        mode: remote.mode,
        cloudId: remote.id,
        memoryCloudId: remote.id,
        date_created: remote.createdAt,
        date_modified: remote.updatedAt,
        cloudUpdatedAt: remote.updatedAt,
        cloudSyncedAt: syncedAt,
      }, true) as number;
      localByCloudId.set(remote.id, {
        id,
        name: remote.name,
        mode: remote.mode,
        cloudId: remote.id,
        memoryCloudId: remote.id,
        date_created: remote.createdAt,
        date_modified: remote.updatedAt,
        cloudUpdatedAt: remote.updatedAt,
        cloudSyncedAt: syncedAt,
      });
      continue;
    }
    await DB.projects.update(existing.id, {
      name: remote.name,
      mode: remote.mode,
      cloudId: remote.id,
      memoryCloudId: remote.id,
      date_created: remote.createdAt,
      date_modified: remote.updatedAt,
      cloudUpdatedAt: remote.updatedAt,
      cloudSyncedAt: syncedAt,
    }, true);
  }

  for (const state of body.states) {
    const project = localByCloudId.get(state.projectId);
    if (!project) continue;
    await DB.moduleState.put(project.id, {
      folders: state.folders,
      cloudUpdatedAt: state.updatedAt,
      cloudSyncedAt: syncedAt,
    }, true);
  }
}

async function syncWorkspaceProjectsNow() {
  const deletionCount = await processTombstones();
  const projects = await Promise.all(((await DB.projects.getAll()) as LocalProject[]).map(ensureProjectIdentity));
  const states = await Promise.all(projects.map(async (project) => ({
    project,
    state: await DB.moduleState.get(project.id) as { folders?: unknown[]; cloudUpdatedAt?: string; cloudSyncedAt?: string | null } | undefined,
  })));
  const pendingProjects = projects.filter((project) => (
    !project.cloudSyncedAt || (project.cloudUpdatedAt || project.date_modified) > project.cloudSyncedAt
  ));
  const pendingStates = states.filter(({ state }) => (
    state && (!state.cloudSyncedAt || (state.cloudUpdatedAt || "") > state.cloudSyncedAt)
  ));
  const body = await postSync({
    projects: pendingProjects.map((project) => ({
      id: project.cloudId,
      name: project.name || "Untitled Project",
      mode: project.mode || "FRAME",
      createdAt: project.date_created,
      updatedAt: project.cloudUpdatedAt || project.date_modified,
    })),
    states: pendingStates.map(({ project, state }) => ({
      projectId: project.cloudId,
      folders: state?.folders || [],
      updatedAt: state?.cloudUpdatedAt || project.cloudUpdatedAt || project.date_modified,
    })),
    references: [],
    referenceProjectId: null,
  });
  await applyWorkspaceResponse(body, projects);
  console.info("[cloud-sync]", {
    projectsUp: pendingProjects.length,
    statesUp: pendingStates.length,
    deletions: deletionCount,
    projectsDown: body.projects.length,
  });
}

export async function syncWorkspaceProjects() {
  if (workspaceSync) return workspaceSync;
  workspaceSync = syncWorkspaceProjectsNow().finally(() => { workspaceSync = null; });
  return workspaceSync;
}

function numericReferenceId(uuid: string) {
  return Number.parseInt(uuid.replace(/[^a-fA-F0-9]/g, "").slice(0, 12), 16) || Date.now();
}

function imageFingerprint(dataUrl: string) {
  return `${dataUrl.length}:${dataUrl.slice(0, 48)}:${dataUrl.slice(-48)}`;
}

async function uploadReferenceImage(
  projectCloudId: string,
  reference: LocalReference,
  dataUrl: string,
  storedFingerprint?: string | null,
) {
  const fingerprint = imageFingerprint(dataUrl);
  if (storedFingerprint === fingerprint || uploadedImageFingerprints.get(reference.uuid) === fingerprint) return false;
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const params = new URLSearchParams({ project_id: projectCloudId, reference_id: reference.uuid });
  const response = await fetch(`/api/cloud-workspace/image?${params}`, {
    method: "PUT",
    headers: { "content-type": blob.type || "image/png" },
    body: blob,
  });
  if (!response.ok) throw new Error("Reference image upload failed.");
  uploadedImageFingerprints.set(reference.uuid, fingerprint);
  await DB.images.markCloudSynced(reference.uuid, fingerprint);
  return true;
}

async function downloadReferenceImage(projectCloudId: string, referenceId: string) {
  const params = new URLSearchParams({ project_id: projectCloudId, reference_id: referenceId });
  const response = await fetch(`/api/cloud-workspace/image?${params}`);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read synced image."));
    reader.readAsDataURL(blob);
  });
}

async function syncCloudProjectNow(projectId: number) {
  await syncWorkspaceProjects();
  const project = await DB.projects.get(projectId) as LocalProject | undefined;
  if (!project) return;
  const identified = await ensureProjectIdentity(project);
  const references = await DB.references.getByProject(projectId) as LocalReference[];
  const images = await DB.images.getMany(references.map((reference) => reference.uuid)) as Array<{
    uuid: string;
    dataUrl: string;
    cloudFingerprint?: string | null;
  }>;
  const imageByUuid = new Map(images.filter(Boolean).map((image) => [image.uuid, image]));
  const pendingReferences = references.filter((reference) => (
    !reference.cloudSyncedAt || (reference.cloudUpdatedAt || "") > reference.cloudSyncedAt
  ));

  const body = await postSync({
    projects: [],
    states: [],
    references: pendingReferences.map((reference) => ({
      id: reference.uuid,
      projectId: identified.cloudId,
      name: reference.name || reference.label || "REFERENCE",
      label: reference.label || reference.name || "REFERENCE",
      folder: reference.folder || null,
      kind: reference.kind || "IMG",
      size: reference.size || "",
      dims: reference.dims || "IMAGE",
      modified: reference.modified || "",
      eye: reference.eye !== false,
      strength: reference.strength ?? 50,
      mode: reference.mode || "REFERENCE",
      visualRead: reference.visualRead,
      visualReadSource: reference.visualReadSource,
      updatedAt: reference.cloudUpdatedAt || new Date().toISOString(),
    })),
    referenceProjectId: identified.cloudId,
  });

  for (const deletion of body.deletedReferences) {
    const local = references.find((reference) => reference.uuid === deletion.id);
    if (!local) continue;
    await DB.references.delete(local.id, true);
    await DB.images.delete(local.uuid);
  }

  const activeRemoteIds = new Set(body.references.map((reference) => reference.id));
  const uploadableReferences = references.filter((reference) => activeRemoteIds.has(reference.uuid));
  let imagesUp = 0;
  for (let index = 0; index < uploadableReferences.length; index += 3) {
    const uploaded = await Promise.all(uploadableReferences.slice(index, index + 3).map(async (reference) => {
      const image = imageByUuid.get(reference.uuid);
      return image?.dataUrl
        ? uploadReferenceImage(identified.cloudId!, reference, image.dataUrl, image.cloudFingerprint)
        : false;
    }));
    imagesUp += uploaded.filter(Boolean).length;
  }

  const syncedAt = new Date().toISOString();
  let imagesDown = 0;
  for (const remote of body.references) {
    const existing = references.find((reference) => reference.uuid === remote.id);
    let localId = existing?.id || numericReferenceId(remote.id);
    if (!existing) {
      const collision = references.find((reference) => reference.id === localId && reference.uuid !== remote.id);
      if (collision) localId = Date.now() + Math.floor(Math.random() * 10_000);
    }
    const existingImage = await DB.images.get(remote.id) as { dataUrl?: string } | undefined;
    if (!existingImage?.dataUrl) {
      const dataUrl = await downloadReferenceImage(identified.cloudId!, remote.id);
      if (dataUrl) {
        await DB.images.put(remote.id, dataUrl, projectId, true);
        const fingerprint = imageFingerprint(dataUrl);
        uploadedImageFingerprints.set(remote.id, fingerprint);
        await DB.images.markCloudSynced(remote.id, fingerprint);
        imagesDown += 1;
      }
    }
    await DB.references.put({
      id: localId,
      uuid: remote.id,
      project_id: projectId,
      name: remote.name,
      label: remote.label,
      folder: remote.folder,
      kind: remote.kind || "IMG",
      size: remote.size,
      dims: remote.dims,
      modified: remote.modified,
      eye: remote.eye,
      strength: remote.strength,
      mode: remote.mode,
      visualRead: remote.visualRead || undefined,
      visualReadSource: remote.visualReadSource || undefined,
      url: "",
      cloudUpdatedAt: remote.updatedAt,
      cloudSyncedAt: syncedAt,
    }, true);
  }

  console.info("[cloud-sync]", {
    project: identified.cloudId,
    referencesUp: pendingReferences.length,
    referencesDown: body.references.length,
    imagesUp,
    imagesDown,
  });
}

export async function syncCloudProject(projectId: number) {
  const active = projectSyncs.get(projectId);
  if (active) return active;
  const promise = syncCloudProjectNow(projectId).finally(() => projectSyncs.delete(projectId));
  projectSyncs.set(projectId, promise);
  return promise;
}

export function installCloudSyncListener() {
  if (listenerInstalled || typeof window === "undefined") return () => undefined;
  listenerInstalled = true;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ projectId?: number }>).detail;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (detail?.projectId) {
        void syncCloudProject(detail.projectId).catch((error) => console.warn("Cloud project sync deferred", error));
      } else {
        void syncWorkspaceProjects().catch((error) => console.warn("Cloud workspace sync deferred", error));
      }
    }, 800);
  };
  window.addEventListener("cafehtml:cloud-sync", listener);
  return () => {
    window.removeEventListener("cafehtml:cloud-sync", listener);
    listenerInstalled = false;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
  };
}
