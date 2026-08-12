export const MODULE_FOLDER_PRESETS = [
  { id: "MOOD", name: "MOOD", accent: "#a352ff" },
  { id: "LOOKBOOK", name: "LOOKBOOK", accent: "#ea3a8a" },
  { id: "WORLD", name: "WORLD", accent: "#3a8a7a" },
] as const;

export function getModuleFolderPreset(id: string) {
  return MODULE_FOLDER_PRESETS.find((preset) => preset.id === id);
}
