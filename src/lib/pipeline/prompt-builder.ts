import { GenerationSettings } from './api';
import { describeReferenceStrength, type ReferenceRole } from './strength';
import { ModuleFile } from "@/context/ModuleContext";
import { getGenerationModuleImages } from "./module-order";

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
  const activeReferences = getGenerationModuleImages(files);
  return {
    mode: "FRAME",
    userPrompt: rawPrompt,
    prompt: rawPrompt,
    settings,
    moduleSnapshot: { files: activeReferences },
    usedImages: activeReferences
      .map(f => {
        const role = normalizeRole(f.mode);
        const strength = describeReferenceStrength(f.strength, role, f.label || f.name || 'UNASSIGNED');
        return {
          uuid: f.uuid,
          imgUrl: f.url,
          role,
          label: f.label,
          strength: strength.value,
          strengthBand: strength.band,
          strengthAxis: strength.controlAxis,
        };
      })
  };
}


