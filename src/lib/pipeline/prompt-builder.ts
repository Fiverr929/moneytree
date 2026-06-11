import { GenerationSettings } from './api';
import { ModuleFile } from "@/context/ModuleContext";

export function collectPayload(
  mode: string, 
  rawPrompt: string, 
  files: ModuleFile[], 
  settings: GenerationSettings
) {
  return {
    mode,
    prompt: rawPrompt,
    settings,
    moduleSnapshot: { files },
    usedImages: files
      .filter(f => f.eye !== false && f.url && !f.folder && ['SUBJECT', 'SCENE', 'STYLE'].includes(String(f.mode || '').toUpperCase()))
      .map(f => ({ imgUrl: f.url }))
  };
}





