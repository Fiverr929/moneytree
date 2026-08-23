"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";

type DraftState = {
  projectId: number | null;
  value: string;
  hydrated: boolean;
};

export function useProjectDraft(
  storageKey: string,
  projectId: number | null,
): [string, Dispatch<SetStateAction<string>>, boolean] {
  const [draft, setDraft] = useState<DraftState>({
    projectId: null,
    value: "",
    hydrated: false,
  });

  useEffect(() => {
    let value = "";
    if (projectId) {
      try {
        value = window.localStorage.getItem(`${storageKey}:${projectId}`) || "";
      } catch {
        // Keep an empty draft when storage is unavailable.
      }
    }
    setDraft({ projectId, value, hydrated: true });
  }, [projectId, storageKey]);

  useEffect(() => {
    if (!projectId || !draft.hydrated || draft.projectId !== projectId) return;
    try {
      window.localStorage.setItem(`${storageKey}:${projectId}`, draft.value);
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [draft, projectId, storageKey]);

  const setValue = useCallback<Dispatch<SetStateAction<string>>>((action) => {
    setDraft((current) => {
      if (!current.hydrated || current.projectId !== projectId) return current;
      const value = typeof action === "function" ? action(current.value) : action;
      return value === current.value ? current : { ...current, value };
    });
  }, [projectId]);

  const isHydrated = draft.hydrated && draft.projectId === projectId;
  return [isHydrated ? draft.value : "", setValue, isHydrated];
}
