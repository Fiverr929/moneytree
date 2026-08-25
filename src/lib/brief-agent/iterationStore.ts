"use client";

import DB from "@/lib/db";
import type { IterationBrief } from "./types";
import { emptyIterationBrief } from "./iterationBrief";

export async function loadIterationBrief(projectId: number) {
  const state = await DB.moduleState.get(projectId) as { iterationBrief?: IterationBrief } | undefined;
  return state?.iterationBrief?.projectId === projectId ? state.iterationBrief : emptyIterationBrief(projectId);
}

export async function saveIterationBrief(brief: IterationBrief) {
  const state = await DB.moduleState.get(brief.projectId) as Record<string, unknown> | undefined;
  // Iteration briefs are local-first until the cloud workspace schema has an
  // explicit field for them; do not masquerade this write as a folder sync.
  await DB.moduleState.put(brief.projectId, { ...(state || {}), iterationBrief: brief }, true);
  return brief;
}
