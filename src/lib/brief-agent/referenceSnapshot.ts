import type { ModuleFile } from "@/context/ModuleContext";
import { normalizeStrength } from "@/lib/pipeline/strength";
import type {
  BriefReferenceRole,
  BriefReferenceSnapshot,
  ReferenceObservation,
} from "./types";

function roleOf(file: ModuleFile): BriefReferenceRole {
  const role = String(file.mode || "").toUpperCase();
  if (role === "SUBJECT" || role === "SCENE" || role === "STYLE") return role;
  return "UNASSIGNED";
}

function visibleModuleFiles(files: ModuleFile[]) {
  return files.filter((file) => file.eye !== false && file.url && !file.folder);
}

export function fingerprintModuleFiles(files: ModuleFile[]) {
  return visibleModuleFiles(files)
    .map((file) => [
      file.uuid || file.id,
      file.url,
      file.mode,
      file.label || file.name,
      file.eye === false ? "hidden" : "visible",
    ].join(":"))
    .join("|");
}

function observationForFile(file: ModuleFile): ReferenceObservation {
  const role = roleOf(file);
  const label = file.label || file.name || "UNLABELED";
  const strength = normalizeStrength(file.strength);

  return {
    imageId: file.uuid || String(file.id),
    role,
    label,
    strength,
    visualRead: "",
    readSource: "local",
  };
}

export function createReferenceSnapshot(files: ModuleFile[]): BriefReferenceSnapshot {
  const observations = visibleModuleFiles(files).map(observationForFile);
  const createdAt = new Date().toISOString();
  return {
    id: `ref-snapshot-${createdAt}`,
    createdAt,
    sourceFingerprint: fingerprintModuleFiles(files),
    observations,
  };
}
