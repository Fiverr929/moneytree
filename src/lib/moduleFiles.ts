import type { ModuleFile } from "@/context/ModuleContext";

export function moduleFileForStorage(file: ModuleFile): ModuleFile {
  return { ...file, url: "" };
}
