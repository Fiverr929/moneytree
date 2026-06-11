"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import DB from "@/lib/db";
import { useApp } from "@/context/AppContext";
import type { ModuleFile } from "@/context/ModuleContext";
export type GalleryImageUse = { uuid?: string; imgUrl: string; role?: string; label?: string };
export type GalleryCell = {
  id: number;
  uuid?: string;
  _imgUuid?: string;
  _dbId?: number;
  ratio: string;
  imgUrl?: string;
  phClass?: string;
  prompt?: string;
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
  // Internal state for pending loads
  loadingId?: string;
  blocked?: boolean;
  error?: boolean;
  retryFn?: (newId: string) => void;
};

interface GalleryContextType {
  cells: GalleryCell[];
  setCells: React.Dispatch<React.SetStateAction<GalleryCell[]>>;
  
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
  addLoading: (id: string, ratio: string, mode: string) => void;
  resolveLoading: (id: string, cell: GalleryCell) => void;
  failLoading: (id: string, retryFn: (newId: string) => void) => void;
  blockLoading: (id: string) => void;
  removeLoading: (id: string) => void;
  addCell: (cell: GalleryCell) => void;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

export function GalleryProvider({ children }: { children: ReactNode }) {
  const [cells, setCells] = useState<GalleryCell[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentView, setCurrentView] = useState<"small" | "medium" | "large">("medium");
  
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [ratioFilter, setRatioFilter] = useState<"all" | "landscape" | "portrait" | "square">("all");
  
  const [hudOpen, setHudOpen] = useState(false);
  const [hudIndex, setHudIndex] = useState(0);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);

  const { activeProjectId } = useApp();

  const normalizeCell = (cell: GalleryCell): GalleryCell => {
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
      createdAt: createdAt || new Date().toISOString(),
      updatedAt,
      usedImages: (cell.usedImages || []).map((img) => ({ imgUrl: img.imgUrl, uuid: img.uuid, role: img.role, label: img.label })),
    };
  };

  useEffect(() => {
    if (activeProjectId) {
      DB.gallery.getByProject(activeProjectId).then(async data => {
        const cells = data as GalleryCell[];
        const withUrls = await Promise.all(cells.map(async c => {
          if (c.uuid) {
            try {
              const img = await DB.images.get(c.uuid);
              if (img && img.dataUrl) return { ...c, imgUrl: img.dataUrl };
            } catch {}
          }
          return normalizeCell(c);
        }));
        setCells(withUrls.reverse());
      }).catch(console.error);
    } else {
      setCells([]);
    }
  }, [activeProjectId]);

  const addLoading = (id: string, ratio: string, mode: string) => {
    setCells(prev => [{
      id: Date.now() + Math.random(),
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
  };

  const resolveLoading = (id: string, cell: GalleryCell) => {
    const normalized = normalizeCell(cell);
    setCells(prev => prev.map(c => c.loadingId === id ? { ...normalized, loadingId: undefined } : c));
    if (activeProjectId && normalized.uuid && normalized.imgUrl) {
      const dbCell = { ...normalized, project_id: activeProjectId, loadingId: undefined };
      DB.images.put(normalized.uuid, normalized.imgUrl, activeProjectId);
      DB.gallery.put(dbCell);
      DB.projects.update(activeProjectId, { thumbnail: normalized.imgUrl }).catch(console.error);
    }
  };

  const failLoading = (id: string, retryFn: (newId: string) => void) => {
    setCells(prev => prev.map(c => c.loadingId === id ? { ...c, error: true, retryFn } : c));
  };

  const blockLoading = (id: string) => {
    setCells(prev => prev.map(c => c.loadingId === id ? { ...c, blocked: true } : c));
  };

  const removeLoading = (id: string) => {
    setCells(prev => prev.filter(c => c.loadingId !== id));
  };

  const addCell = (cell: GalleryCell) => {
    const normalized = normalizeCell(cell);
    setCells(prev => [normalized, ...prev]);
    if (activeProjectId && normalized.uuid && normalized.imgUrl) {
      const dbCell = { ...normalized, project_id: activeProjectId, loadingId: undefined };
      DB.images.put(normalized.uuid, normalized.imgUrl, activeProjectId);
      DB.gallery.put(dbCell);
      DB.projects.update(activeProjectId, { thumbnail: normalized.imgUrl }).catch(console.error);
    }
  };

  return (
    <GalleryContext.Provider
      value={{
        cells, setCells,
        selectMode, setSelectMode,
        selectedIds, setSelectedIds,
        currentView, setCurrentView,
        sortOrder, setSortOrder,
        ratioFilter, setRatioFilter,
        hudOpen, setHudOpen,
        hudIndex, setHudIndex,
        infoPanelOpen, setInfoPanelOpen,
        addLoading, resolveLoading, failLoading, blockLoading, removeLoading, addCell
      }}
    >
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




