import type { ScenePlan } from "./types";

export function replaceSceneShotPrompt(plan: ScenePlan, shotIndex: number, prompt: string): ScenePlan {
  return {
    ...plan,
    shots: plan.shots.map((shot) => shot.index === shotIndex ? { ...shot, prompt } : shot),
  };
}

export function moveScenePlanShot(plan: ScenePlan, shotIndex: number, direction: -1 | 1): ScenePlan {
  const shots = [...plan.shots];
  const from = shots.findIndex((shot) => shot.index === shotIndex);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= shots.length) return plan;
  [shots[from], shots[to]] = [shots[to], shots[from]];
  const reordered = shots.map((shot, index) => ({ ...shot, index: index + 1 }));
  return { ...plan, shots: reordered };
}

export function scenePlanCanExecute(status: string, plannedFingerprint: string, currentFingerprint: string) {
  return status === "pending" && Boolean(plannedFingerprint) && plannedFingerprint === currentFingerprint;
}
