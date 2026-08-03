import type { LyriaPrompt } from "./lyriaRealtime";

export type MusicRole = "drums" | "bass" | "other";
export type CharacterValue = 0 | 1 | 2;

export type MusicScene = {
  id: string;
  name: string;
  createdAt: number;
  prompts: LyriaPrompt[];
  density: CharacterValue;
  brightness: CharacterValue;
  diversity: CharacterValue;
  roles: Record<MusicRole, boolean>;
  bpm: number | "Auto";
  musicKey: string;
};

export type TakeEvent = {
  at: number;
  type: string;
  detail: string;
};

export type MusicTake = {
  id: string;
  name: string;
  startedAt: number;
  durationMs: number;
  events: TakeEvent[];
  audioUrl?: string;
};

export function clonePrompts<T extends LyriaPrompt>(prompts: T[]): T[] {
  return prompts.map((prompt) => ({ ...prompt }));
}

export function sceneFromState(
  name: string,
  state: Omit<MusicScene, "id" | "name" | "createdAt">,
): MusicScene {
  return {
    ...state,
    id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: Date.now(),
    prompts: clonePrompts(state.prompts),
    roles: { ...state.roles },
  };
}

export function interpolatePrompts<T extends LyriaPrompt>(
  from: T[],
  to: T[],
  progress: number,
): T[] {
  const clamped = Math.max(0, Math.min(1, progress));
  const fromByText = new Map(from.map((prompt) => [prompt.text, prompt]));
  const toByText = new Map(to.map((prompt) => [prompt.text, prompt]));
  const texts = [...new Set([...fromByText.keys(), ...toByText.keys()])];

  return texts.map((text, index) => {
    const source = fromByText.get(text);
    const target = toByText.get(text);
    const startWeight = source && !source.muted ? source.weight : 0.05;
    const endWeight = target && !target.muted ? target.weight : 0.05;
    const template = target ?? source!;

    return {
      ...template,
      id: template.id || `morph-${index}-${text.replace(/[^a-z0-9]+/gi, "-")}`,
      weight: startWeight + (endWeight - startWeight) * clamped,
      muted: false,
    };
  });
}

export function barDurationMs(bpm: number | "Auto") {
  return (60_000 / (bpm === "Auto" ? 120 : bpm)) * 4;
}

export function millisecondsUntilNextBar(startedAt: number, bpm: number | "Auto", now = performance.now()) {
  const barMs = barDurationMs(bpm);
  const position = Math.max(0, now - startedAt) % barMs;
  return position < 24 ? 0 : barMs - position;
}
