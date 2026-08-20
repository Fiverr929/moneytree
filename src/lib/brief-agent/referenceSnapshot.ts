import type { ModuleFile } from "@/context/ModuleContext";
import { normalizeStrength } from "@/lib/pipeline/strength";
import type {
  BriefReferenceRole,
  BriefReferenceSnapshot,
  ReferenceObservation,
} from "./types";
import { getGenerationModuleImages } from "@/lib/pipeline/module-order";
import { fingerprintReferenceValues } from "./referenceFingerprint";
import { hasCurrentReferenceRead } from "./referenceFreshness";

function roleOf(file: ModuleFile): BriefReferenceRole {
  const role = String(file.mode || "").toUpperCase();
  if (role === "SUBJECT" || role === "SCENE" || role === "STYLE") return role;
  return "UNASSIGNED";
}

function visibleModuleFiles(files: ModuleFile[]) {
  return getGenerationModuleImages(files);
}

export function fingerprintModuleFiles(files: ModuleFile[]) {
  return fingerprintReferenceValues(
    visibleModuleFiles(files).map((file) => [
      file.uuid || file.id,
      file.url,
      file.mode,
      file.label || file.name,
      normalizeStrength(file.strength),
      file.eye === false ? "hidden" : "visible",
    ]),
  );
}

function observationForFile(file: ModuleFile): ReferenceObservation {
  const role = roleOf(file);
  const label = file.label || file.name || "UNLABELED";
  const strength = normalizeStrength(file.strength);

  const visualReadIsCurrent = hasCurrentReferenceRead(file);

  return {
    imageId: file.uuid || String(file.id),
    role,
    label,
    strength,
    visualRead: visualReadIsCurrent ? file.visualRead || "" : "",
    readSource: visualReadIsCurrent ? file.visualReadSource || "local" : "local",
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
