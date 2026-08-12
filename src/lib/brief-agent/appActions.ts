import type { ModuleFile } from "../../context/ModuleContext.tsx";
import type {
  AgentAppAction,
  AgentAppEvent,
  BriefReferenceRole,
  CafeWorkspaceSnapshot,
} from "./types";

const ROLE_VALUES = new Set<BriefReferenceRole>(["SUBJECT", "SCENE", "STYLE", "UNASSIGNED"]);
const MAX_ACTIONS_PER_TURN = 8;
const MAX_NAME_LENGTH = 120;

function normalizeStrength(value: unknown, fallback = 50) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) : "";
}

function targetExists(workspace: CafeWorkspaceSnapshot | null | undefined, imageId: string) {
  return Boolean(workspace?.references.some((reference) => reference.imageId === imageId));
}

export function parseAgentAppActions(value: unknown, workspace?: CafeWorkspaceSnapshot | null): AgentAppAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ACTIONS_PER_TURN).flatMap((candidate): AgentAppAction[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const action = candidate as Record<string, unknown>;
    const type = String(action.type || "");
    const imageId = cleanName(action.imageId);
    const id = crypto.randomUUID();

    if (type === "project.rename") {
      const name = cleanName(action.name);
      return name ? [{ id, type, name }] : [];
    }
    if (!imageId || !targetExists(workspace, imageId)) return [];
    if (type === "reference.rename") {
      const name = cleanName(action.name);
      return name ? [{ id, type, imageId, name }] : [];
    }
    if (type === "reference.set_role") {
      const role = String(action.role || "").toUpperCase() as BriefReferenceRole;
      return ROLE_VALUES.has(role) ? [{ id, type, imageId, role }] : [];
    }
    if (type === "reference.set_strength") {
      const strength = Number(action.strength);
      return Number.isFinite(strength) ? [{ id, type, imageId, strength: normalizeStrength(strength) }] : [];
    }
    if (type === "reference.set_visibility") {
      return typeof action.visible === "boolean" ? [{ id, type, imageId, visible: action.visible }] : [];
    }
    if (type === "reference.move") {
      const folder = action.folder === null ? null : cleanName(action.folder);
      const folderExists = folder === null || Boolean(workspace?.folders.some((item) => item.id === folder));
      return folderExists ? [{ id, type, imageId, folder }] : [];
    }
    return [];
  });
}

export function describeAgentAppAction(action: AgentAppAction) {
  switch (action.type) {
    case "project.rename": return `renamed project to ${action.name}`;
    case "reference.rename": return `renamed reference to ${action.name}`;
    case "reference.set_role": return `set ${action.imageId} role to ${action.role}`;
    case "reference.set_strength": return `set ${action.imageId} strength to ${action.strength}`;
    case "reference.set_visibility": return `${action.visible ? "showed" : "hid"} ${action.imageId}`;
    case "reference.move": return `moved ${action.imageId} ${action.folder ? `to ${action.folder}` : "to the root"}`;
  }
}

type ApplyActionInput = {
  action: AgentAppAction;
  projectName: string;
  files: ModuleFile[];
  runId: string;
};

export function applyAgentAppAction({ action, projectName, files, runId }: ApplyActionInput) {
  const createdAt = new Date().toISOString();
  let nextProjectName = projectName;
  let nextFiles = files;
  let inverse: AgentAppAction | null = null;

  if (action.type === "project.rename") {
    inverse = { id: crypto.randomUUID(), type: "project.rename", name: projectName };
    nextProjectName = action.name;
  } else {
    const index = files.findIndex((file) => file.uuid === action.imageId);
    if (index < 0) throw new Error(`Reference ${action.imageId} is no longer available.`);
    const current = files[index];
    let updated = current;
    switch (action.type) {
      case "reference.rename":
        inverse = { id: crypto.randomUUID(), type: action.type, imageId: action.imageId, name: current.name || current.label };
        updated = { ...current, name: action.name, label: action.name };
        break;
      case "reference.set_role":
        inverse = { id: crypto.randomUUID(), type: action.type, imageId: action.imageId, role: (current.mode || "UNASSIGNED").toUpperCase() as BriefReferenceRole };
        updated = { ...current, mode: action.role };
        break;
      case "reference.set_strength":
        inverse = { id: crypto.randomUUID(), type: action.type, imageId: action.imageId, strength: normalizeStrength(current.strength) };
        updated = { ...current, strength: normalizeStrength(action.strength) };
        break;
      case "reference.set_visibility":
        inverse = { id: crypto.randomUUID(), type: action.type, imageId: action.imageId, visible: current.eye !== false };
        updated = { ...current, eye: action.visible };
        break;
      case "reference.move":
        inverse = { id: crypto.randomUUID(), type: action.type, imageId: action.imageId, folder: current.folder || null };
        updated = { ...current, folder: action.folder };
        break;
    }
    nextFiles = files.map((file, fileIndex) => fileIndex === index ? updated : file);
  }

  const event: AgentAppEvent = {
    id: crypto.randomUUID(),
    runId,
    actor: "agent",
    action,
    inverse,
    status: "completed",
    summary: describeAgentAppAction(action),
    createdAt,
  };
  return { projectName: nextProjectName, files: nextFiles, event };
}
