import { GenerationSettings } from './api';
import { ModuleFile } from "@/context/ModuleContext";

export function collectPayload(
  mode: string, 
  rawPrompt: string, 
  files: ModuleFile[], 
  settings: GenerationSettings
) {
  const fileToLayer = (file: ModuleFile) => ({
    name: file.label || 'UNLABELED',
    visible: file.eye !== false,
    children: [{
      type: 'image',
      visible: file.eye !== false,
      imgUrl: file.url || null,
      visionDesc: (settings.keepDescriptions ? file.visionDesc : null) || null,
      uuid: file.uuid || null,
      strength: file.strength == null ? 50 : file.strength
    }]
  });

  const collectSection = (sectionKey: string) => {
    const sectionFiles = files.filter(f => f.folder !== null && f.mode.toUpperCase() === sectionKey.toUpperCase());
    const layers = sectionFiles.map(fileToLayer);

    return {
      slots: [{
        label: 'A',
        active: true,
        layers: layers,
        section: sectionKey
      }],
      selected: 0,
      source: 'cafeModule'
    };
  };

  const refs = files.filter(f => f.folder === null && f.eye !== false && f.url).map(f => ({
    type: 'image',
    role: f.label || 'REFERENCE',
    imgUrl: f.url,
    uuid: f.uuid || null,
    visionDesc: f.visionDesc || null,
    strength: f.strength == null ? 50 : f.strength
  }));

  return {
    mode,
    prompt: rawPrompt,
    refs,
    subject: collectSection('SUBJECT'),
    stage: collectSection('STAGE'),
    style: collectSection('STYLE'),
    settings,
    moduleSnapshot: { files },
    usedImages: files.filter(f => f.eye !== false && f.url).map(f => ({ imgUrl: f.url }))
  };
}





