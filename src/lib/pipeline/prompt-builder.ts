import { GenerationSettings } from './api';
import { ModuleFile } from "@/context/ModuleContext";

export function collectPayload(
  rawPrompt: string, 
  files: ModuleFile[], 
  settings: GenerationSettings
) {
  return {
    mode: "FRAME",
    prompt: rawPrompt,
    settings,
    moduleSnapshot: { files },
    usedImages: files
      .filter(f => f.eye !== false && f.url && !f.folder && ['SUBJECT', 'SCENE', 'STYLE'].includes(String(f.mode || '').toUpperCase()))
      .map(f => ({
        uuid: f.uuid,
        imgUrl: f.url,
        role: String(f.mode || '').toUpperCase(),
        label: f.label,
      }))
  };
}





