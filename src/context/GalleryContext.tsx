"use client";

import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode, useEffect } from "react";
import DB from "@/lib/db";
import { useApp } from "@/context/AppContext";
import { galleryCellForStorage } from "@/lib/galleryCells";
import type { ModuleFile } from "@/context/ModuleContext";
import type { StrengthBand } from "@/lib/pipeline/strength";
export type GalleryImageUse = { uuid?: string; imgUrl: string; role?: string; label?: string; strength?: number; strengthBand?: StrengthBand };
export type EvaluationScore = 1 | 2 | 3 | 4 | 5;
export type GenerationEvaluation = {
  promptMatch: EvaluationScore;
  subjectMatch: EvaluationScore;
  sceneMatch: EvaluationScore;
  styleMatch: EvaluationScore;
  qualityMatch: EvaluationScore;
  comment: string;
  evaluatedAt: string;
};
export type GalleryCell = {
  id: number;
  project_id?: number;
  uuid?: string;
  _imgUuid?: string;
  _dbId?: number;
  ratio: string;
  imgUrl?: string;
  phClass?: string;
  userPrompt?: string;
  effectivePrompt?: string;
  prompt?: string;
  executionSource?: "agent-final-prompt" | "generate-command" | "prompt-bar" | string;
  agentDraft?: {
    id?: string | null;
    promptArtifactId?: string;
    sourceFingerprint?: string | null;
    refCount?: number | null;
    brain?: "model" | "mock";
    model?: string | null;
    skillChecks?: unknown[];
    warnings?: string[];
  } | null;
  date?: string;
  type?: string;
  kind?: "image";
  origin?: "generation" | "studio-edit" | "duplicate";
  createdAt?: string;
  updatedAt?: string;
  sourceUuid?: string;
  dims?: string;
  generated?: boolean;
  mode?: string;
  moduleSnapshot?: { files: ModuleFile[] };
  usedImages?: GalleryImageUse[];
  pipelineVersion?: string;
  model?: string;
  modelId?: string;
  generationSettings?: {
    aspectRatio?: string;
    imageSize?: string;
    thinkingLevel?: string | null;
  };
  evaluation?: GenerationEvaluation;
  generationTimeMs?: number;
  // Internal state for pending loads
  loadingId?: string;
  blocked?: boolean;
  error?: boolean;
  statusLabel?: string;
  retryFn?: (newId: string) => void;
};

type StoredGenerationJob = {
  id: string;
  project_id: number;
  kind: "image" | "video";
  status: "running" | "interrupted";
  loadingIds?: string[];
  prompt?: string;
  ratio?: string;
  mode?: string;
  createdAt: string;
};

interface GalleryContextType {
  cells: GalleryCell[];
  setCells: React.Dispatch<React.SetStateAction<GalleryCell[]>>;
  isGalleryLoading: boolean;
  
  selectMode: boolean;
  setSelectMode: (val: boolean) => void;
  selectedIds: Set<number>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  
  currentView: "small" | "medium" | "large";
  setCurrentView: (val: "small" | "medium" | "large") => void;
  
  // Filters
  sortOrder: "newest" | "oldest";
  setSortOrder: (val: "newest" | "oldest") => void;
  ratioFilter: "all" | "landscape" | "portrait" | "square";
  setRatioFilter: (val: "all" | "landscape" | "portrait" | "square") => void;

  // HUD
  hudOpen: boolean;
  setHudOpen: (val: boolean) => void;
  hudIndex: number;
  setHudIndex: (val: number) => void;
  infoPanelOpen: boolean;
  setInfoPanelOpen: (val: boolean) => void;
  // Mutations
  addLoading: (id: string, ratio: string, mode: string, projectId?: number | null) => void;
  resolveLoading: (id: string, cell: GalleryCell) => void;
  failLoading: (id: string, retryFn?: (newId: string) => void, statusLabel?: string) => void;
  blockLoading: (id: string, statusLabel?: string) => void;
  addCell: (cell: GalleryCell) => void;
  evaluationTargetId: number | null;
  evaluationQueueLength: number;
  openEvaluation: (cellId: number) => void;
  closeEvaluationQueue: () => void;
  skipEvaluation: (cellId: number) => void;
  saveEvaluation: (cellId: number, evaluation: GenerationEvaluation) => Promise<void>;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);
const GALLERY_HYDRATION_BATCH_SIZE = 10;

const nextPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

export function GalleryProvider({ children }: { children: ReactNode }) {
  const [cells, setCells] = useState<GalleryCell[]>([]);
  const [isGalleryLoading, setIsGalleryLoading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentView, setCurrentView] = useState<"small" | "medium" | "large">("medium");
  
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [ratioFilter, setRatioFilter] = useState<"all" | "landscape" | "portrait" | "square">("all");
  
  const [hudOpen, setHudOpen] = useState(false);
  const [hudIndex, setHudIndex] = useState(0);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [evaluationQueue, setEvaluationQueue] = useState<number[]>([]);
  const [evaluationTargetId, setEvaluationTargetId] = useState<number | null>(null);
  const evaluationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const { activeProjectId } = useApp();

  const scheduleEvaluation = useCallback((cellId: number) => {
    setEvaluationQueue((current) => current.includes(cellId) ? current : [...current, cellId]);
  }, []);

  const normalizeCell = useCallback((cell: GalleryCell): GalleryCell => {
    const effectivePrompt = cell.effectivePrompt || cell.prompt;
    const userPrompt = cell.userPrompt;
    const createdAt = cell.createdAt || (cell.date && cell.date.includes("T") ? cell.date : undefined);
    const updatedAt = cell.updatedAt || (!createdAt ? cell.date : undefined);
    const origin =
      cell.origin ||
      (cell.mode === "STUDIO REFINE" ? "studio-edit" : "generation");
    const type =
      cell.type ||
      (origin === "studio-edit" ? "Studio Edit" : origin === "duplicate" ? "Duplicate" : "Generation");

    return {
      ...cell,
      kind: cell.kind || "image",
      origin,
      type,
      userPrompt,
      effectivePrompt,
      prompt: effectivePrompt,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt,
      generationTimeMs: cell.generationTimeMs,
      usedImages: (cell.usedImages || []).map((img) => ({
        imgUrl: img.imgUrl,
        uuid: img.uuid,
        role: img.role,
        label: img.label,
        strength: img.strength,
        strengthBand: img.strengthBand
      })),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (activeProjectId) {
      setIsGalleryLoading(true);
      DB.gallery.getByProject(activeProjectId).then(async data => {
        const storedCells = data as GalleryCell[];
        const visibleCells = storedCells
          .map((cell) => normalizeCell({ ...cell, imgUrl: undefined }))
          .reverse();

        if (!cancelled) {
          setCells(visibleCells);
          setIsGalleryLoading(visibleCells.length > 0);
        }

        const originalsById = new Map(storedCells.map((cell) => [cell.id, cell]));
        const images = await DB.images.getMany(
          visibleCells.map((cell) => cell.uuid).filter((uuid): uuid is string => Boolean(uuid)),
        );
        const imageUrlsByUuid = new Map(
          images
            .filter((image): image is { uuid: string; dataUrl: string } => Boolean(image?.uuid && image?.dataUrl))
            .map((image) => [image.uuid, image.dataUrl]),
        );
        const hydratedCells = visibleCells.map((cell) => {
          const imgUrl = (cell.uuid && imageUrlsByUuid.get(cell.uuid)) || originalsById.get(cell.id)?.imgUrl;
          return imgUrl ? normalizeCell({ ...cell, imgUrl }) : cell;
        });

        for (let index = 0; index < hydratedCells.length && !cancelled; index += GALLERY_HYDRATION_BATCH_SIZE) {
          const batch = hydratedCells.slice(index, index + GALLERY_HYDRATION_BATCH_SIZE);
          const batchById = new Map(batch.map((cell) => [cell.id, cell]));
          setCells((current) => current.map((cell) => batchById.get(cell.id) || cell));
          await nextPaint();
        }

        if (!cancelled) setIsGalleryLoading(false);

        window.setTimeout(() => {
          for (const hydrated of hydratedCells) {
            const original = originalsById.get(hydrated.id);
            if (!activeProjectId || !hydrated.uuid || !hydrated.imgUrl || !original?.imgUrl) continue;
            void Promise.all([
              DB.images.put(hydrated.uuid, hydrated.imgUrl, activeProjectId),
              DB.gallery.put(galleryCellForStorage({ ...hydrated, project_id: activeProjectId })),
            ]).catch((error) => console.error("Failed to compact gallery image record", error));
          }
        }, 250);

        const jobs = await DB.generationJobs.getByProject(activeProjectId) as StoredGenerationJob[];
        if (cancelled) return;
        const interruptedImageJobs = jobs.filter((job) => job.kind === "image" && job.status === "running");
        if (interruptedImageJobs.length) {
          setCells((current) => {
            const existingLoadingIds = new Set(current.map((cell) => cell.loadingId).filter(Boolean));
            const restoredCells = interruptedImageJobs.flatMap((job) => (
              (job.loadingIds?.length ? job.loadingIds : [job.id]).map((loadingId) => ({
                id: Date.now() + Math.random(),
                project_id: activeProjectId,
                loadingId,
                ratio: job.ratio || "1:1",
                mode: job.mode || "FRAME",
                kind: "image" as const,
                origin: "generation" as const,
                type: "Generation",
                createdAt: job.createdAt,
                generated: true,
                error: true,
                statusLabel: "INTERRUPTED",
                prompt: job.prompt,
                userPrompt: job.prompt,
                effectivePrompt: job.prompt,
              }))
            )).filter((cell) => !existingLoadingIds.has(cell.loadingId));
            return restoredCells.length ? [...restoredCells, ...current] : current;
          });
          await Promise.all(interruptedImageJobs.map((job) => (
            DB.generationJobs.put({ ...job, status: "interrupted" })
          )));
        }
      }).catch((error) => {
        console.error(error);
        if (!cancelled) setIsGalleryLoading(false);
      });
    } else {
      setCells([]);
      setIsGalleryLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, normalizeCell]);

  useEffect(() => () => {
    if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
  }, []);

  useEffect(() => {
    if (evaluationTargetId !== null || !evaluationQueue.length) return;
    if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
    evaluationTimerRef.current = setTimeout(() => {
      setEvaluationTargetId(evaluationQueue[0]);
    }, 900);
    return () => {
      if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
    };
  }, [evaluationQueue, evaluationTargetId]);

  useEffect(() => {
    setEvaluationQueue([]);
    setEvaluationTargetId(null);
    if (evaluationTimerRef.current) clearTimeout(evaluationTimerRef.current);
  }, [activeProjectId]);

  const persistCell = useCallback(async (cell: GalleryCell) => {
    const projectId = cell.project_id || activeProjectId;
    if (!projectId || !cell.uuid || !cell.imgUrl) return;
    const project = await DB.projects.get(projectId);
    if (!project) return;
    const dbCell = {
      ...galleryCellForStorage(cell),
      project_id: projectId,
    };
    await DB.images.put(cell.uuid, cell.imgUrl, projectId);
    await DB.gallery.put(dbCell);
    await DB.projects.update(projectId, { thumbnail: cell.imgUrl });
  }, [activeProjectId]);

  const addLoading = useCallback((id: string, ratio: string, mode: string, projectId?: number | null) => {
    setCells(prev => [{
      id: Date.now() + Math.random(),
      project_id: projectId || undefined,
      loadingId: id,
      ratio,
      mode,
      kind: "image",
      origin: "generation",
      type: "Generation",
      createdAt: new Date().toISOString(),
      generated: true,
      phClass: 'loading'
    }, ...prev]);
  }, []);

  const resolveLoading = useCallback((id: string, cell: GalleryCell) => {
    const normalized = normalizeCell(cell);
    setCells(prev => prev.map(c => c.loadingId === id
      ? { ...normalized, project_id: normalized.project_id || c.project_id, loadingId: undefined }
      : c
    ));
    void persistCell(normalized).catch((error) => console.error("Failed to persist generated image", error));
    scheduleEvaluation(normalized.id);
  }, [normalizeCell, persistCell, scheduleEvaluation]);

  const failLoading = useCallback((id: string, retryFn?: (newId: string) => void, statusLabel = "FAILED") => {
    setCells(prev => prev.map(c => c.loadingId === id ? { ...c, error: true, blocked: false, retryFn, statusLabel } : c));
  }, []);

  const blockLoading = useCallback((id: string, statusLabel = "BLOCKED") => {
    setCells(prev => prev.map(c => c.loadingId === id ? { ...c, blocked: true, error: false, retryFn: undefined, statusLabel } : c));
  }, []);

  const addCell = useCallback((cell: GalleryCell) => {
    const normalized = normalizeCell(cell);
    setCells(prev => [normalized, ...prev]);
    void persistCell(normalized).catch((error) => console.error("Failed to persist gallery image", error));
  }, [normalizeCell, persistCell]);

  const advanceEvaluationQueue = useCallback((cellId: number) => {
    setEvaluationQueue((current) => {
      const remaining = current.filter((id) => id !== cellId);
      setEvaluationTargetId(remaining[0] ?? null);
      return remaining;
    });
  }, []);

  const openEvaluation = useCallback((cellId: number) => {
    setEvaluationQueue((current) => current.includes(cellId) ? current : [cellId, ...current]);
    setEvaluationTargetId(cellId);
  }, []);

  const closeEvaluationQueue = useCallback(() => {
    setEvaluationQueue([]);
    setEvaluationTargetId(null);
  }, []);

  const skipEvaluation = useCallback((cellId: number) => {
    advanceEvaluationQueue(cellId);
  }, [advanceEvaluationQueue]);

  const saveEvaluation = useCallback(async (cellId: number, evaluation: GenerationEvaluation) => {
    const cell = cells.find((entry) => entry.id === cellId);
    if (!cell) return;
    const updated = { ...cell, evaluation };
    setCells((current) => current.map((entry) => entry.id === cellId ? updated : entry));
    const projectId = updated.project_id || activeProjectId;
    if (projectId) {
      await DB.gallery.put(galleryCellForStorage({
        ...updated,
        project_id: projectId,
      }));
    }
    advanceEvaluationQueue(cellId);
  }, [activeProjectId, advanceEvaluationQueue, cells]);

  const value = useMemo(() => ({
    cells, setCells,
    isGalleryLoading,
    selectMode, setSelectMode,
    selectedIds, setSelectedIds,
    currentView, setCurrentView,
    sortOrder, setSortOrder,
    ratioFilter, setRatioFilter,
    hudOpen, setHudOpen,
    hudIndex, setHudIndex,
    infoPanelOpen, setInfoPanelOpen,
    addLoading, resolveLoading, failLoading, blockLoading, addCell,
    evaluationTargetId,
    evaluationQueueLength: evaluationQueue.length,
    openEvaluation,
    closeEvaluationQueue,
    skipEvaluation,
    saveEvaluation
  }), [
    addCell,
    addLoading,
    blockLoading,
    cells,
    closeEvaluationQueue,
    currentView,
    evaluationQueue.length,
    evaluationTargetId,
    failLoading,
    hudIndex,
    hudOpen,
    infoPanelOpen,
    isGalleryLoading,
    openEvaluation,
    ratioFilter,
    resolveLoading,
    saveEvaluation,
    selectMode,
    selectedIds,
    skipEvaluation,
    sortOrder,
  ]);

  return (
    <GalleryContext.Provider value={value}>
      {children}
    </GalleryContext.Provider>
  );
}

export function useGallery() {
  const context = useContext(GalleryContext);
  if (!context) {
    throw new Error("useGallery must be used within a GalleryProvider");
  }
  return context;
}
