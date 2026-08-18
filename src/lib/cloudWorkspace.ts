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
type LocalGeneration = Record<string, unknown> & {
  id: number;
  uuid: string;
  project_id: number;
  createdAt?: string;
  date?: string;
  updatedAt?: string;
  cloudUpdatedAt?: string;
  cloudSyncedAt?: string | null;
};
type CloudGeneration = {
  id: string;
  projectId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type SyncResponse = {
  projects: CloudProject[];
  states: CloudState[];
  deletedProjects: Array<{ id: string; deletedAt: string }>;
  references: CloudReference[];
  deletedReferences: Array<{ id: string; projectId: string; deletedAt: string }>;
  generations: CloudGeneration[];
  deletedGenerations: Array<{ id: string; projectId: string; deletedAt: string }>;
};

type SyncTombstone = {
  id: string;
  kind: "project" | "reference" | "generation";
  projectCloudId: string;
  referenceCloudId?: string;
  generationCloudId?: string;
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
    && Array.isArray(body.deletedReferences)
    && Array.isArray(body.generations)
    && Array.isArray(body.deletedGenerations);
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
    } else if (tombstone.kind === "generation" && tombstone.generationCloudId) {
      path = "/api/cloud-workspace/generation";
      params.set("generation_id", tombstone.generationCloudId);
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
    generations: [],
    generationProjectId: null,
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

function generationMetadataForCloud(generation: LocalGeneration) {
  const metadata = { ...generation };
  [
    "id", "uuid", "project_id", "imgUrl", "loadingId", "retryFn", "blocked", "error", "phClass",
    "_imgUuid", "_dbId", "cloudUpdatedAt", "cloudSyncedAt",
  ].forEach((key) => delete metadata[key]);
  if (Array.isArray(metadata.usedImages)) {
    metadata.usedImages = metadata.usedImages.map((image) => {
      if (!image || typeof image !== "object") return image;
      const compact = { ...(image as Record<string, unknown>) };
      delete compact.imgUrl;
      return compact;
    });
  }
  const moduleSnapshot = metadata.moduleSnapshot;
  if (moduleSnapshot && typeof moduleSnapshot === "object" && Array.isArray((moduleSnapshot as { files?: unknown[] }).files)) {
    metadata.moduleSnapshot = {
      ...(moduleSnapshot as Record<string, unknown>),
      files: (moduleSnapshot as { files: unknown[] }).files.map((file) => {
        if (!file || typeof file !== "object") return file;
        return { ...(file as Record<string, unknown>), url: "" };
      }),
    };
  }
  return metadata;
}

function hydrateGenerationMetadata(metadata: Record<string, unknown>) {
  const hydrated = { ...metadata };
  if (Array.isArray(hydrated.usedImages)) {
    hydrated.usedImages = hydrated.usedImages.map((image) => (
      image && typeof image === "object" ? { ...(image as Record<string, unknown>), imgUrl: "" } : image
    ));
  }
  return hydrated;
}

async function uploadGenerationImage(
  projectCloudId: string,
  generationId: string,
  dataUrl: string,
  storedFingerprint?: string | null,
) {
  const fingerprint = imageFingerprint(dataUrl);
  const cacheKey = `generation:${generationId}`;
  if (storedFingerprint === fingerprint || uploadedImageFingerprints.get(cacheKey) === fingerprint) return false;
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const params = new URLSearchParams({ project_id: projectCloudId, generation_id: generationId });
  const response = await fetch(`/api/cloud-workspace/generation-image?${params}`, {
    method: "PUT",
    headers: { "content-type": blob.type || "image/png" },
    body: blob,
  });
  if (!response.ok) throw new Error("Generated image upload failed.");
  uploadedImageFingerprints.set(cacheKey, fingerprint);
  await DB.images.markGenerationCloudSynced(generationId, fingerprint);
  return true;
}

async function downloadGenerationImage(projectCloudId: string, generationId: string) {
  const params = new URLSearchParams({ project_id: projectCloudId, generation_id: generationId });
  const response = await fetch(`/api/cloud-workspace/generation-image?${params}`);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read synced generation image."));
    reader.readAsDataURL(blob);
  });
}

async function syncCloudProjectNow(projectId: number) {
  await syncWorkspaceProjects();
  const project = await DB.projects.get(projectId) as LocalProject | undefined;
  if (!project) return;
  const identified = await ensureProjectIdentity(project);
  const references = await DB.references.getByProject(projectId) as LocalReference[];
  const generations = (await DB.gallery.getByProject(projectId) as LocalGeneration[])
    .filter((generation) => Boolean(generation.uuid));
  const images = await DB.images.getMany([
    ...references.map((reference) => reference.uuid),
    ...generations.map((generation) => generation.uuid),
  ]) as Array<{
    uuid: string;
    dataUrl: string;
    cloudFingerprint?: string | null;
    generationCloudFingerprint?: string | null;
  }>;
  const imageByUuid = new Map(images.filter(Boolean).map((image) => [image.uuid, image]));
  const pendingReferences = references.filter((reference) => (
    !reference.cloudSyncedAt || (reference.cloudUpdatedAt || "") > reference.cloudSyncedAt
  ));
  const pendingGenerations = generations.filter((generation) => (
    !generation.cloudSyncedAt || (generation.cloudUpdatedAt || generation.updatedAt || "") > generation.cloudSyncedAt
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
    generations: pendingGenerations.map((generation) => {
      const createdAt = generation.createdAt
        || (typeof generation.date === "string" && !Number.isNaN(Date.parse(generation.date)) ? generation.date : new Date().toISOString());
      return {
        id: generation.uuid,
        projectId: identified.cloudId,
        metadata: generationMetadataForCloud(generation),
        createdAt,
        updatedAt: generation.cloudUpdatedAt || generation.updatedAt || createdAt,
      };
    }),
    generationProjectId: identified.cloudId,
  });

  for (const deletion of body.deletedReferences) {
    const local = references.find((reference) => reference.uuid === deletion.id);
    if (!local) continue;
    await DB.references.delete(local.id, true);
    await DB.images.delete(local.uuid);
  }
  for (const deletion of body.deletedGenerations) {
    const local = generations.find((generation) => generation.uuid === deletion.id);
    if (!local) continue;
    await DB.gallery.delete(local.id, true);
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
  const activeRemoteGenerationIds = new Set(body.generations.map((generation) => generation.id));
  const uploadableGenerations = generations.filter((generation) => activeRemoteGenerationIds.has(generation.uuid));
  const generationImagesQueued = uploadableGenerations.filter((generation) => {
    const image = imageByUuid.get(generation.uuid);
    return Boolean(image?.dataUrl && image.generationCloudFingerprint !== imageFingerprint(image.dataUrl));
  }).length;
  void (async () => {
    for (let index = 0; index < uploadableGenerations.length; index += 3) {
      await Promise.all(uploadableGenerations.slice(index, index + 3).map(async (generation) => {
        const image = imageByUuid.get(generation.uuid);
        if (image?.dataUrl) {
          await uploadGenerationImage(identified.cloudId!, generation.uuid, image.dataUrl, image.generationCloudFingerprint);
        }
      }));
    }
  })().catch((error) => console.warn("Generated image upload deferred", error));

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

  let generationImagesDown = 0;
  for (const remote of body.generations) {
    const existing = generations.find((generation) => generation.uuid === remote.id);
    let localId = existing?.id || numericReferenceId(remote.id);
    if (!existing) {
      const collision = generations.find((generation) => generation.id === localId && generation.uuid !== remote.id);
      if (collision) localId = Date.now() + Math.floor(Math.random() * 10_000);
    }
    const existingImage = await DB.images.get(remote.id) as { dataUrl?: string } | undefined;
    if (!existingImage?.dataUrl) {
      const dataUrl = await downloadGenerationImage(identified.cloudId!, remote.id);
      if (dataUrl) {
        await DB.images.put(remote.id, dataUrl, projectId, true);
        const fingerprint = imageFingerprint(dataUrl);
        uploadedImageFingerprints.set(`generation:${remote.id}`, fingerprint);
        await DB.images.markGenerationCloudSynced(remote.id, fingerprint);
        generationImagesDown += 1;
      }
    }
    await DB.gallery.put({
      ...hydrateGenerationMetadata(remote.metadata),
      id: localId,
      uuid: remote.id,
      project_id: projectId,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
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
    generationsUp: pendingGenerations.length,
    generationsDown: body.generations.length,
    generationImagesQueued,
    generationImagesDown,
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
