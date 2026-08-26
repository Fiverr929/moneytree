import { mergeAgentInsight, mergeIterationBrief, stableStringify } from "../src/lib/cloudSyncMerge.ts";
import { isAgentInsight } from "../src/lib/brief-agent/insightPolicy.ts";

interface D1Result { meta?: { changes?: number } }
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}
interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  etag?: string;
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

export interface CloudWorkspaceEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
}

type ProjectInput = { id: string; name: string; mode: string; createdAt: string; updatedAt: string; deletedAt: string | null };
type StateInput = { projectId: string; folders: unknown[]; iterationBrief?: unknown; updatedAt: string };
type ReferenceInput = {
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
  visualRead?: string;
  visualReadSource?: string;
  visualReadFingerprint?: string;
  visualReadVersion?: string;
  updatedAt: string;
};
type GenerationInput = {
  id: string;
  projectId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
type InsightInput = {
  id: string;
  projectId: string;
  insight: Record<string, unknown>;
  updatedAt: string;
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
let schemaReady: Promise<void> | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validProject(value: unknown): value is ProjectInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return validId(item.id)
    && typeof item.name === "string" && item.name.length <= 160
    && typeof item.mode === "string" && item.mode.length <= 40
    && validDate(item.createdAt) && validDate(item.updatedAt)
    && (item.deletedAt === null || validDate(item.deletedAt));
}

function validState(value: unknown): value is StateInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!validId(item.projectId) || !Array.isArray(item.folders) || item.folders.length > 50 || !validDate(item.updatedAt)) return false;
  try { return item.iterationBrief === undefined || JSON.stringify(item.iterationBrief).length <= 50_000; } catch { return false; }
}

function validReference(value: unknown): value is ReferenceInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return validId(item.id) && validId(item.projectId)
    && typeof item.name === "string" && item.name.length <= 240
    && typeof item.label === "string" && item.label.length <= 240
    && (item.folder === null || (typeof item.folder === "string" && item.folder.length <= 120))
    && typeof item.kind === "string" && item.kind.length <= 20
    && typeof item.size === "string" && item.size.length <= 40
    && typeof item.dims === "string" && item.dims.length <= 40
    && typeof item.modified === "string" && item.modified.length <= 80
    && typeof item.eye === "boolean"
    && typeof item.strength === "number" && Number.isFinite(item.strength)
    && typeof item.mode === "string" && item.mode.length <= 40
    && (item.visualRead === undefined || (typeof item.visualRead === "string" && item.visualRead.length <= 4_000))
    && (item.visualReadSource === undefined || ["local", "vision"].includes(String(item.visualReadSource)))
    && (item.visualReadFingerprint === undefined || (typeof item.visualReadFingerprint === "string" && item.visualReadFingerprint.length <= 180))
    && (item.visualReadVersion === undefined || (typeof item.visualReadVersion === "string" && item.visualReadVersion.length <= 120))
    && validDate(item.updatedAt);
}

function validGeneration(value: unknown): value is GenerationInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!validId(item.id) || !validId(item.projectId) || !validDate(item.createdAt) || !validDate(item.updatedAt)) return false;
  if (!item.metadata || typeof item.metadata !== "object" || Array.isArray(item.metadata)) return false;
  try {
    return JSON.stringify(item.metadata).length <= 100_000;
  } catch {
    return false;
  }
}

function validInsight(value: unknown): value is InsightInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!validId(item.id) || !validId(item.projectId) || !validDate(item.updatedAt)) return false;
  if (!item.insight || typeof item.insight !== "object" || Array.isArray(item.insight)) return false;
  const insight = item.insight as Record<string, unknown>;
  if (insight.id !== item.id || !isAgentInsight(insight)) return false;
  if (typeof insight.referenceFingerprint !== "string" && insight.referenceFingerprint !== null) return false;
  if ((insight.statusHistory !== undefined && !Array.isArray(insight.statusHistory))
    || (Array.isArray(insight.statusHistory) && insight.statusHistory.length > 100)
    || (insight.activeReferences as unknown[]).length > 50
    || (insight.conversationEvidence as unknown[]).length > 50) return false;
  try { return JSON.stringify(insight).length <= 100_000; } catch { return false; }
}

async function readSyncBody(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 5_000_000) return null;
    const body = JSON.parse(raw) as Record<string, unknown>;
    const projects = Array.isArray(body.projects) ? body.projects : [];
    const states = Array.isArray(body.states) ? body.states : [];
    const references = Array.isArray(body.references) ? body.references : [];
    const generations = Array.isArray(body.generations) ? body.generations : [];
    const insights = Array.isArray(body.insights) ? body.insights : [];
    const insightProjectIds = Array.isArray(body.insightProjectIds) ? body.insightProjectIds : [];
    const referenceProjectId = body.referenceProjectId === null || body.referenceProjectId === undefined
      ? null
      : body.referenceProjectId;
    const generationProjectId = body.generationProjectId === null || body.generationProjectId === undefined
      ? null
      : body.generationProjectId;
    if (projects.length > 100 || states.length > 100 || references.length > 500 || generations.length > 500 || insights.length > 1_000 || insightProjectIds.length > 100) return null;
    if (!projects.every(validProject) || !states.every(validState) || !references.every(validReference) || !generations.every(validGeneration) || !insights.every(validInsight)) return null;
    if (referenceProjectId !== null && !validId(referenceProjectId)) return null;
    if (generationProjectId !== null && !validId(generationProjectId)) return null;
    if (!insightProjectIds.every(validId)) return null;
    return { projects, states, references, generations, insights, insightProjectIds, referenceProjectId, generationProjectId } as {
      projects: ProjectInput[];
      states: StateInput[];
      references: ReferenceInput[];
      generations: GenerationInput[];
      insights: InsightInput[];
      insightProjectIds: string[];
      referenceProjectId: string | null;
      generationProjectId: string | null;
    };
  } catch {
    return null;
  }
}

function ensureSchema(db: D1Database) {
  schemaReady ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cloud_project (
      owner_key TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, mode TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      PRIMARY KEY (owner_key, id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_cloud_project_owner_updated ON cloud_project (owner_key, updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS cloud_project_state (
      owner_key TEXT NOT NULL, project_id TEXT NOT NULL, folders_json TEXT NOT NULL, iteration_json TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, project_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cloud_reference (
      owner_key TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
      label TEXT NOT NULL, folder TEXT, kind TEXT NOT NULL, size TEXT NOT NULL, dims TEXT NOT NULL,
      modified TEXT NOT NULL, eye INTEGER NOT NULL, strength REAL NOT NULL, mode TEXT NOT NULL,
      visual_read TEXT, visual_read_source TEXT, visual_read_fingerprint TEXT, visual_read_version TEXT,
      updated_at TEXT NOT NULL, deleted_at TEXT,
      PRIMARY KEY (owner_key, id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_cloud_reference_owner_project ON cloud_reference (owner_key, project_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_cloud_reference_owner_updated ON cloud_reference (owner_key, updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS cloud_generation (
      owner_key TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL, metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      PRIMARY KEY (owner_key, id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_cloud_generation_owner_project_updated ON cloud_generation (owner_key, project_id, updated_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS cloud_agent_insight (
      owner_key TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL,
      insight_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_cloud_agent_insight_owner_project_updated ON cloud_agent_insight (owner_key, project_id, updated_at)"),
    db.prepare("PRAGMA optimize"),
  ]).then(async () => {
    const columns = await db.prepare("PRAGMA table_info(cloud_project_state)").all<{ name: string }>();
    if (!columns.results.some((column) => column.name === "iteration_json")) {
      await db.prepare("ALTER TABLE cloud_project_state ADD COLUMN iteration_json TEXT").run();
    }
  }).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function runBatches(db: D1Database, statements: D1Statement[]) {
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

function objectKey(ownerKey: string, projectId: string, referenceId: string) {
  return `${encodeURIComponent(ownerKey)}/${encodeURIComponent(projectId)}/${encodeURIComponent(referenceId)}`;
}

function generationObjectKey(ownerKey: string, projectId: string, generationId: string) {
  return `${encodeURIComponent(ownerKey)}/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`;
}

async function syncWorkspace(request: Request, env: CloudWorkspaceEnv, ownerKey: string) {
  const body = await readSyncBody(request);
  if (!body) return json({ error: "Invalid cloud workspace payload." }, 400);

  const [existingStateRows, existingInsightRows] = await Promise.all([
    env.DB.prepare("SELECT project_id, folders_json, iteration_json, updated_at FROM cloud_project_state WHERE owner_key = ? LIMIT 100")
      .bind(ownerKey).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, project_id, insight_json, updated_at FROM cloud_agent_insight WHERE owner_key = ? LIMIT 1000")
      .bind(ownerKey).all<Record<string, unknown>>(),
  ]);
  const existingStateByProject = new Map(existingStateRows.results.map((row) => [String(row.project_id), row]));
  const states = body.states.map((state) => {
    const existing = existingStateByProject.get(state.projectId);
    if (!existing) return state;
    let remoteFolders: unknown[] = [];
    let remoteBrief: unknown = null;
    try { remoteFolders = JSON.parse(String(existing.folders_json)); } catch { /* use safe empty folders */ }
    try { remoteBrief = existing.iteration_json ? JSON.parse(String(existing.iteration_json)) : null; } catch { /* use safe empty brief */ }
    const existingUpdatedAt = String(existing.updated_at || "");
    const folders = state.updatedAt > existingUpdatedAt
      ? state.folders
      : state.updatedAt < existingUpdatedAt
        ? remoteFolders
        : stableStringify(state.folders) >= stableStringify(remoteFolders) ? state.folders : remoteFolders;
    return {
      ...state,
      folders,
      iterationBrief: mergeIterationBrief(remoteBrief, state.iterationBrief),
      updatedAt: state.updatedAt >= existingUpdatedAt ? state.updatedAt : existingUpdatedAt,
    };
  });
  const existingInsightById = new Map(existingInsightRows.results.map((row) => [String(row.id), row]));
  const insights = body.insights.map((input) => {
    const existing = existingInsightById.get(input.id);
    let remoteInsight: unknown = null;
    try { remoteInsight = existing ? JSON.parse(String(existing.insight_json)) : null; } catch { /* merge with incoming only */ }
    const insight = mergeAgentInsight(remoteInsight, input.insight) || input.insight;
    const existingUpdatedAt = String(existing?.updated_at || "");
    return { ...input, insight, updatedAt: input.updatedAt >= existingUpdatedAt ? input.updatedAt : existingUpdatedAt };
  });

  const statements: D1Statement[] = [];
  body.projects.forEach((project) => statements.push(env.DB.prepare(`INSERT INTO cloud_project
    (owner_key, id, name, mode, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, id) DO UPDATE SET
      name = excluded.name, mode = excluded.mode, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    WHERE cloud_project.mode != '__PURGED__' AND (
      (cloud_project.deleted_at IS NULL AND excluded.updated_at >= cloud_project.updated_at)
      OR (cloud_project.deleted_at IS NOT NULL AND excluded.updated_at > cloud_project.deleted_at)
    )`)
    .bind(ownerKey, project.id, project.name, project.mode, project.createdAt, project.updatedAt, project.deletedAt)));
  states.forEach((state) => statements.push(env.DB.prepare(`INSERT INTO cloud_project_state
    (owner_key, project_id, folders_json, iteration_json, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, project_id) DO UPDATE SET
      folders_json = excluded.folders_json, iteration_json = excluded.iteration_json, updated_at = excluded.updated_at
    WHERE excluded.updated_at >= cloud_project_state.updated_at`)
    .bind(ownerKey, state.projectId, JSON.stringify(state.folders), state.iterationBrief === undefined ? null : JSON.stringify(state.iterationBrief), state.updatedAt)));
  body.references.forEach((reference) => statements.push(env.DB.prepare(`INSERT INTO cloud_reference
    (owner_key, id, project_id, name, label, folder, kind, size, dims, modified, eye, strength,
      mode, visual_read, visual_read_source, visual_read_fingerprint, visual_read_version, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(owner_key, id) DO UPDATE SET
      project_id = excluded.project_id, name = excluded.name, label = excluded.label,
      folder = excluded.folder, kind = excluded.kind, size = excluded.size, dims = excluded.dims,
      modified = excluded.modified, eye = excluded.eye, strength = excluded.strength, mode = excluded.mode,
      visual_read = excluded.visual_read, visual_read_source = excluded.visual_read_source,
      visual_read_fingerprint = excluded.visual_read_fingerprint, visual_read_version = excluded.visual_read_version,
      updated_at = excluded.updated_at, deleted_at = NULL
    WHERE (cloud_reference.deleted_at IS NULL AND excluded.updated_at >= cloud_reference.updated_at)
      OR (cloud_reference.deleted_at IS NOT NULL AND excluded.updated_at > cloud_reference.deleted_at)`)
    .bind(
      ownerKey, reference.id, reference.projectId, reference.name, reference.label, reference.folder,
      reference.kind, reference.size, reference.dims, reference.modified, reference.eye ? 1 : 0,
      Math.max(0, Math.min(100, reference.strength)), reference.mode, reference.visualRead || null,
      reference.visualReadSource || null, reference.visualReadFingerprint || null,
      reference.visualReadVersion || null, reference.updatedAt,
    )));
  body.generations.forEach((generation) => statements.push(env.DB.prepare(`INSERT INTO cloud_generation
    (owner_key, id, project_id, metadata_json, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(owner_key, id) DO UPDATE SET
      project_id = excluded.project_id, metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at, deleted_at = NULL
    WHERE (cloud_generation.deleted_at IS NULL AND excluded.updated_at >= cloud_generation.updated_at)
      OR (cloud_generation.deleted_at IS NOT NULL AND excluded.updated_at > cloud_generation.deleted_at)`)
    .bind(
      ownerKey, generation.id, generation.projectId, JSON.stringify(generation.metadata),
      generation.createdAt, generation.updatedAt,
    )));
  insights.forEach((input) => statements.push(env.DB.prepare(`INSERT INTO cloud_agent_insight
    (owner_key, id, project_id, insight_json, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_key, id) DO UPDATE SET
      project_id = excluded.project_id, insight_json = excluded.insight_json, updated_at = excluded.updated_at
    WHERE excluded.updated_at >= cloud_agent_insight.updated_at`)
    .bind(ownerKey, input.id, input.projectId, JSON.stringify(input.insight), input.updatedAt)));
  await runBatches(env.DB, statements);

  const [projectRows, stateRows, deletedProjectRows, purgedProjectRows] = await Promise.all([
    env.DB.prepare("SELECT * FROM cloud_project WHERE owner_key = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100")
      .bind(ownerKey).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT state.* FROM cloud_project_state state
      JOIN cloud_project project ON project.owner_key = state.owner_key AND project.id = state.project_id
      WHERE state.owner_key = ? AND project.deleted_at IS NULL LIMIT 100`)
      .bind(ownerKey).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, deleted_at FROM cloud_project WHERE owner_key = ? AND deleted_at IS NOT NULL AND mode != '__PURGED__' LIMIT 100")
      .bind(ownerKey).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, deleted_at FROM cloud_project WHERE owner_key = ? AND mode = '__PURGED__' LIMIT 100")
      .bind(ownerKey).all<Record<string, unknown>>(),
  ]);

  let references: Record<string, unknown>[] = [];
  let deletedReferences: Record<string, unknown>[] = [];
  if (body.referenceProjectId) {
    const [activeRows, deletedRows] = await Promise.all([
      env.DB.prepare("SELECT * FROM cloud_reference WHERE owner_key = ? AND project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500")
        .bind(ownerKey, body.referenceProjectId).all<Record<string, unknown>>(),
      env.DB.prepare("SELECT id, project_id, deleted_at FROM cloud_reference WHERE owner_key = ? AND project_id = ? AND deleted_at IS NOT NULL LIMIT 500")
        .bind(ownerKey, body.referenceProjectId).all<Record<string, unknown>>(),
    ]);
    references = activeRows.results;
    deletedReferences = deletedRows.results;
  }
  let generations: Record<string, unknown>[] = [];
  let deletedGenerations: Record<string, unknown>[] = [];
  if (body.generationProjectId) {
    const [activeRows, deletedRows] = await Promise.all([
      env.DB.prepare("SELECT * FROM cloud_generation WHERE owner_key = ? AND project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500")
        .bind(ownerKey, body.generationProjectId).all<Record<string, unknown>>(),
      env.DB.prepare("SELECT id, project_id, deleted_at FROM cloud_generation WHERE owner_key = ? AND project_id = ? AND deleted_at IS NOT NULL LIMIT 500")
        .bind(ownerKey, body.generationProjectId).all<Record<string, unknown>>(),
    ]);
    generations = activeRows.results;
    deletedGenerations = deletedRows.results;
  }
  const requestedInsightProjects = new Set(body.insightProjectIds);
  const insightRows = requestedInsightProjects.size
    ? (await env.DB.prepare("SELECT id, project_id, insight_json, updated_at FROM cloud_agent_insight WHERE owner_key = ? ORDER BY updated_at DESC LIMIT 1000")
      .bind(ownerKey).all<Record<string, unknown>>()).results
      .filter((row) => requestedInsightProjects.has(String(row.project_id)))
    : [];

  return json({
    projects: projectRows.results.map((row) => ({
      id: row.id, name: row.name, mode: row.mode, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    states: stateRows.results.map((row) => ({
      projectId: row.project_id,
      folders: (() => { try { return JSON.parse(String(row.folders_json)); } catch { return []; } })(),
      iterationBrief: (() => { try { return row.iteration_json ? JSON.parse(String(row.iteration_json)) : null; } catch { return null; } })(),
      updatedAt: row.updated_at,
    })),
    deletedProjects: deletedProjectRows.results.map((row) => ({ id: row.id, deletedAt: row.deleted_at })),
    purgedProjects: purgedProjectRows.results.map((row) => ({ id: row.id, deletedAt: row.deleted_at })),
    references: references.map((row) => ({
      id: row.id, projectId: row.project_id, name: row.name, label: row.label, folder: row.folder,
      kind: row.kind, size: row.size, dims: row.dims, modified: row.modified, eye: Boolean(row.eye),
      strength: row.strength, mode: row.mode, visualRead: row.visual_read,
      visualReadSource: row.visual_read_source, visualReadFingerprint: row.visual_read_fingerprint,
      visualReadVersion: row.visual_read_version, updatedAt: row.updated_at,
    })),
    deletedReferences: deletedReferences.map((row) => ({ id: row.id, projectId: row.project_id, deletedAt: row.deleted_at })),
    generations: generations.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      metadata: (() => { try { return JSON.parse(String(row.metadata_json)); } catch { return {}; } })(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    deletedGenerations: deletedGenerations.map((row) => ({ id: row.id, projectId: row.project_id, deletedAt: row.deleted_at })),
    insights: insightRows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      insight: (() => { try { return JSON.parse(String(row.insight_json)); } catch { return {}; } })(),
      updatedAt: row.updated_at,
    })),
  });
}

async function deleteGeneration(request: Request, env: CloudWorkspaceEnv, ownerKey: string) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  const generationId = url.searchParams.get("generation_id");
  const deletedAt = url.searchParams.get("deleted_at");
  if (!validId(projectId) || !validId(generationId) || !validDate(deletedAt)) return json({ error: "Invalid generation deletion." }, 400);
  await env.DB.prepare(`UPDATE cloud_generation SET deleted_at = ?, updated_at = ?
    WHERE owner_key = ? AND id = ? AND (deleted_at IS NULL OR deleted_at < ?)`)
    .bind(deletedAt, deletedAt, ownerKey, generationId, deletedAt).run();
  await env.MEDIA.delete(generationObjectKey(ownerKey, projectId, generationId));
  return json({ ok: true });
}

async function deleteReference(request: Request, env: CloudWorkspaceEnv, ownerKey: string) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  const referenceId = url.searchParams.get("reference_id");
  const deletedAt = url.searchParams.get("deleted_at");
  if (!validId(projectId) || !validId(referenceId) || !validDate(deletedAt)) return json({ error: "Invalid reference deletion." }, 400);
  await env.DB.prepare(`UPDATE cloud_reference SET deleted_at = ?, updated_at = ?
    WHERE owner_key = ? AND id = ? AND (deleted_at IS NULL OR deleted_at < ?)`)
    .bind(deletedAt, deletedAt, ownerKey, referenceId, deletedAt).run();
  await env.MEDIA.delete(objectKey(ownerKey, projectId, referenceId));
  return json({ ok: true });
}

async function deleteProject(request: Request, env: CloudWorkspaceEnv, ownerKey: string) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  const deletedAt = url.searchParams.get("deleted_at");
  if (!validId(projectId) || !validDate(deletedAt)) return json({ error: "Invalid project deletion." }, 400);
  const rows = await env.DB.prepare("SELECT id FROM cloud_reference WHERE owner_key = ? AND project_id = ? AND deleted_at IS NULL")
    .bind(ownerKey, projectId).all<{ id: string }>();
  const generationRows = await env.DB.prepare("SELECT id FROM cloud_generation WHERE owner_key = ? AND project_id = ? AND deleted_at IS NULL")
    .bind(ownerKey, projectId).all<{ id: string }>();
  if (rows.results.length) {
    await env.MEDIA.delete(rows.results.map((row) => objectKey(ownerKey, projectId, row.id)));
  }
  if (generationRows.results.length) {
    await env.MEDIA.delete(generationRows.results.map((row) => generationObjectKey(ownerKey, projectId, row.id)));
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM cloud_reference WHERE owner_key = ? AND project_id = ?").bind(ownerKey, projectId),
    env.DB.prepare("DELETE FROM cloud_generation WHERE owner_key = ? AND project_id = ?").bind(ownerKey, projectId),
    env.DB.prepare("DELETE FROM cloud_project_state WHERE owner_key = ? AND project_id = ?").bind(ownerKey, projectId),
    env.DB.prepare("DELETE FROM cloud_agent_insight WHERE owner_key = ? AND project_id = ?").bind(ownerKey, projectId),
    env.DB.prepare("DELETE FROM agent_memory WHERE owner_key = ? AND scope = 'project' AND project_key = ?").bind(ownerKey, projectId),
    env.DB.prepare("DELETE FROM agent_message WHERE owner_key = ? AND project_key = ?").bind(ownerKey, projectId),
    env.DB.prepare("DELETE FROM agent_checkpoint WHERE owner_key = ? AND project_key = ?").bind(ownerKey, projectId),
    env.DB.prepare(`UPDATE cloud_project SET deleted_at = ?, updated_at = ?, mode = '__PURGED__'
      WHERE owner_key = ? AND id = ? AND (deleted_at IS NULL OR deleted_at < ?)`)
      .bind(deletedAt, deletedAt, ownerKey, projectId, deletedAt),
  ]);
  return json({ ok: true });
}

async function generationImageRequest(request: Request, env: CloudWorkspaceEnv, ownerKey: string) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  const generationId = url.searchParams.get("generation_id");
  if (!validId(projectId) || !validId(generationId)) return json({ error: "Invalid generation image key." }, 400);
  const key = generationObjectKey(ownerKey, projectId, generationId);
  if (request.method === "GET") {
    const object = await env.MEDIA.get(key);
    if (!object) return json({ error: "Image not found." }, 404);
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "private, no-cache",
        ...(object.etag ? { etag: object.etag } : {}),
      },
    });
  }
  if (request.method === "PUT") {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return json({ error: "Only image uploads are allowed." }, 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image is too large." }, 413);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function imageRequest(request: Request, env: CloudWorkspaceEnv, ownerKey: string) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  const referenceId = url.searchParams.get("reference_id");
  if (!validId(projectId) || !validId(referenceId)) return json({ error: "Invalid image key." }, 400);
  const key = objectKey(ownerKey, projectId, referenceId);
  if (request.method === "GET") {
    const object = await env.MEDIA.get(key);
    if (!object) return json({ error: "Image not found." }, 404);
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "private, no-cache",
        ...(object.etag ? { etag: object.etag } : {}),
      },
    });
  }
  if (request.method === "PUT") {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return json({ error: "Only image uploads are allowed." }, 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "Image is too large." }, 413);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}

export async function handleCloudWorkspace(
  request: Request,
  env: CloudWorkspaceEnv,
  ownerKey: string,
  sameOrigin: boolean,
) {
  await ensureSchema(env.DB);
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/cloud-workspace/status" && request.method === "GET") return json({ ok: true });
  if (request.method !== "GET" && !sameOrigin) return json({ error: "Invalid request origin." }, 403);
  if (pathname === "/api/cloud-workspace/sync" && request.method === "POST") return syncWorkspace(request, env, ownerKey);
  if (pathname === "/api/cloud-workspace/reference" && request.method === "DELETE") return deleteReference(request, env, ownerKey);
  if (pathname === "/api/cloud-workspace/generation" && request.method === "DELETE") return deleteGeneration(request, env, ownerKey);
  if (pathname === "/api/cloud-workspace/project" && request.method === "DELETE") return deleteProject(request, env, ownerKey);
  if (pathname === "/api/cloud-workspace/image") return imageRequest(request, env, ownerKey);
  if (pathname === "/api/cloud-workspace/generation-image") return generationImageRequest(request, env, ownerKey);
  return json({ error: "Not found." }, 404);
}
