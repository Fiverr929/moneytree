import type { ModuleFile, ModuleFolder } from "@/context/ModuleContext";
import { fingerprintReferenceValues } from "./referenceFingerprint";
import { hasCurrentReferenceRead } from "./referenceFreshness";
import type { BriefBoardContext, BriefBoardType } from "./types";

export type { BriefBoardContext, BriefBoardType } from "./types";

const BOARD_TYPES = new Set<BriefBoardType>([
  "MOOD", "LOOKBOOK", "WORLD", "CUSTOM", "CHARACTER", "SETTING",
  "OBJECT", "CREATURE", "WARDROBE", "TREATMENT",
]);

export function inferBriefBoardType(folder: Pick<ModuleFolder, "id" | "name" | "briefType">): BriefBoardType {
  const explicit = String(folder.briefType || "").toUpperCase() as BriefBoardType;
  if (BOARD_TYPES.has(explicit)) return explicit;
  const legacy = String(folder.id || folder.name || "").toUpperCase() as BriefBoardType;
  return BOARD_TYPES.has(legacy) ? legacy : "CUSTOM";
}

export function normalizeBriefBoard(folder: ModuleFolder): ModuleFolder {
  return {
    ...folder,
    briefType: inferBriefBoardType(folder),
    purpose: typeof folder.purpose === "string" ? folder.purpose : "",
    active: folder.active !== false,
  };
}

export function filesForBriefBoard(files: ModuleFile[], boardId: string) {
  return files.filter((file) => file.folder === boardId);
}

export function fingerprintBriefBoard(folder: ModuleFolder, files: ModuleFile[]) {
  return fingerprintReferenceValues([
    [folder.id, inferBriefBoardType(folder), folder.name, folder.purpose || "", folder.active === false ? "inactive" : "active"],
    ...filesForBriefBoard(files, folder.id).map((file) => [
      file.uuid || file.id,
      file.url,
      file.label || file.name,
      file.visualReadFingerprint || "",
    ]),
  ]);
}

export function compileBriefBoardContext(folders: ModuleFolder[], files: ModuleFile[]): BriefBoardContext[] {
  return folders
    .map(normalizeBriefBoard)
    .filter((folder) => folder.active !== false)
    .map((folder) => {
      const boardFiles = filesForBriefBoard(files, folder.id);
      return {
        id: folder.id,
        type: inferBriefBoardType(folder),
        name: folder.name,
        purpose: folder.purpose || "",
        active: true,
        sourceFingerprint: fingerprintBriefBoard(folder, files),
        images: boardFiles.map((file) => ({
          imageId: file.uuid || String(file.id),
          label: file.label || file.name || "UNLABELED",
          visualRead: hasCurrentReferenceRead(file) ? file.visualRead || "" : "",
        })),
        ...(folder.visualBible?.status === "approved"
          && folder.visualBible.sourceFingerprint === fingerprintBriefBoard(folder, files)
          ? { visualBible: folder.visualBible }
          : {}),
      };
    });
}

export function briefBoardVisionQueue(folders: ModuleFolder[], files: ModuleFile[]) {
  const activeIds = new Set(folders.filter((folder) => folder.active !== false).map((folder) => folder.id));
  return files.filter((file) => file.folder && activeIds.has(file.folder) && file.url && file.eye !== false && !hasCurrentReferenceRead(file));
}
