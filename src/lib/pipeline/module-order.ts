type OrderedModuleFile = {
  url?: string;
  eye?: boolean;
  folder?: string | null;
  mode?: string;
  modified?: string;
};

const GENERATION_ROLES = new Set(["SUBJECT", "SCENE", "STYLE"]);

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
  });
}
