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
  await DB.moduleState.put(brief.projectId, { ...(state || {}), iterationBrief: brief });
  return brief;
}
