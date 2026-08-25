type OrderedModuleFile = {
  url?: string;
  eye?: boolean;
  folder?: string | null;
  mode?: string;
  modified?: string;
};

const GENERATION_ROLES = new Set(["SUBJECT", "SCENE", "STYLE"]);
export const MAX_ACTIVE_GENERATION_REFERENCES = 6;

export function multiSubjectCompositionRule(files: OrderedModuleFile[]) {
  const subjectCount = files.filter((file) => String(file.mode || "").toUpperCase() === "SUBJECT").length;
  return subjectCount > 1
    ? "Include every active Subject as a separately visible subject unless the Task explicitly says that the Subject images are alternate views of the same entity."
    : null;
}

function modifiedValue(file: OrderedModuleFile) {
  return String(file.modified || "");
}

export function sortModuleFilesByLayerOrder<T extends OrderedModuleFile>(files: T[]): T[] {
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => {
      const byLayerOrder = modifiedValue(b.file).localeCompare(modifiedValue(a.file));
      return byLayerOrder || a.index - b.index;
    })
    .map(({ file }) => file);
}

export function getGenerationModuleImages<T extends OrderedModuleFile>(files?: T[]): T[] {
  return sortModuleFilesByLayerOrder(files || []).filter((file) => {
    if (!file?.url || file.eye === false || file.folder) return false;
    return GENERATION_ROLES.has(String(file.mode || "").toUpperCase());
  }).slice(0, MAX_ACTIVE_GENERATION_REFERENCES);
}

export function resolveGenerationModuleImages<T extends OrderedModuleFile>(
  files: T[] | undefined,
  snapshotFiles: T[] | undefined,
) {
  return getGenerationModuleImages(files || snapshotFiles);
}
