import { GenerationSettings } from './api';
import { describeReferenceStrength, type ReferenceRole } from './strength';
import { ModuleFile } from "@/context/ModuleContext";

function normalizeRole(mode: string): ReferenceRole {
  const role = String(mode || '').toUpperCase();
  if (role === 'SUBJECT' || role === 'SCENE' || role === 'STYLE') return role;
  return 'UNASSIGNED';
}

export function collectPayload(
  rawPrompt: string, 
  files: ModuleFile[], 
  settings: GenerationSettings
) {
  return {
    mode: "FRAME",
    userPrompt: rawPrompt,
    prompt: rawPrompt,
    settings,
    moduleSnapshot: { files },
    usedImages: files
      .filter(f => f.eye !== false && f.url && !f.folder && ['SUBJECT', 'SCENE', 'STYLE'].includes(String(f.mode || '').toUpperCase()))
      .map(f => {
        const role = normalizeRole(f.mode);
        const strength = describeReferenceStrength(f.strength, role);
        return {
          uuid: f.uuid,
          imgUrl: f.url,
          role,
          label: f.label,
          strength: strength.value,
          strengthBand: strength.band,
        };
      })
  };
}





