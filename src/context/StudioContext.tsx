"use client";

import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode, useEffect, useRef } from "react";
import DB from "@/lib/db";
import { useApp } from "@/context/AppContext";

export type ModuleImage = { uuid: string, url: string, visible?: boolean };

export type StudioGroup = {
  action: string;
  name: string;
  images: ModuleImage[];
};

export type StudioConfig = {
  uuid?: string;
  imgUrl?: string;
  ratio?: string;
  caller?: string;
  onDone?: (url: string | null) => void;
};

interface StudioContextType {
  isOpen: boolean;
  activeImage: StudioConfig | null;
  history: string[];
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
  activeUrl: string | null;
  setActiveUrl: React.Dispatch<React.SetStateAction<string | null>>;
  activeTool: 'pencil' | 'crop' | null;
  setActiveTool: (val: 'pencil' | 'crop' | null) => void;
  
  // StudioModule State
  groups: StudioGroup[];
  setGroups: React.Dispatch<React.SetStateAction<StudioGroup[]>>;
  
  openStudio: (config: StudioConfig) => void;
  closeStudio: (finalUrl?: string | null) => void;
  
  // Canvas settings
  strokeSize: number;
  setStrokeSize: (val: number) => void;
  strokeColor: string;
  setStrokeColor: (val: string) => void;
  cropRatio: number | 'free';
  setCropRatio: (val: number | 'free') => void;
}

const StudioContext = createContext<StudioContextType | undefined>(undefined);
const MAX_STUDIO_HISTORY = 20;

const limitHistory = (items: string[]) => items.slice(0, MAX_STUDIO_HISTORY);

export function StudioProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<StudioConfig | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'pencil' | 'crop' | null>(null);
  const [groups, setGroups] = useState<StudioGroup[]>([]);
  
  const [strokeSize, setStrokeSize] = useState(3);
  const [strokeColor, setStrokeColor] = useState('#ea5823');
  const [cropRatio, setCropRatio] = useState<number | 'free'>(16 / 9);
  const openRequestRef = useRef(0);

  // Load state when a new image is opened
  const openStudio = useCallback(async (config: StudioConfig) => {
    const requestId = ++openRequestRef.current;
    setActiveImage(config);
    setIsOpen(true);
    setActiveTool(null);
    setHistory(config.imgUrl ? [config.imgUrl] : []);
    setActiveUrl(config.imgUrl || null);
    setGroups([]);
    
    if (config.uuid && activeProjectId) {
      try {
        const saved = await DB.studioState.get(activeProjectId);
        if (openRequestRef.current !== requestId) return;
        if (saved && saved.histories && saved.histories[config.uuid]) {
          const entry = saved.histories[config.uuid];
          if (entry.history && entry.history.length > 0) {
            setHistory(limitHistory(entry.history));
          }
          setActiveUrl(entry.activeUrl || entry.history?.[0] || config.imgUrl || null);
          if (entry.layers && entry.layers.groups) {
            setGroups(entry.layers.groups);
          }
        } else {
          setGroups([]);
        }
      } catch (_err: unknown) {
        if (openRequestRef.current !== requestId) return;
        console.error("Failed to load studio state", _err);
      }
    } else {
      setGroups([]);
    }
  }, [activeProjectId]);

  const closeStudio = useCallback(async (finalUrl?: string | null) => {
    openRequestRef.current += 1;
    setIsOpen(false);
    
    if (activeImage && activeImage.uuid && activeProjectId) {
      try {
        const saved = await DB.studioState.get(activeProjectId) || { histories: {} };
        if (!saved.histories) saved.histories = {};
        
        saved.histories[activeImage.uuid] = {
          history: limitHistory(history),
          activeUrl: finalUrl || activeUrl || history[0],
          layers: { groups }
        };
        await DB.studioState.save(activeProjectId, saved);
      } catch (_err: unknown) {
        console.error("Failed to save studio state", _err);
      }
    }
    
    if (activeImage?.onDone) {
      activeImage.onDone(finalUrl || activeUrl || null);
    }
    setActiveImage(null);
    setActiveUrl(null);
    setHistory([]);
    setGroups([]);
  }, [activeImage, activeProjectId, activeUrl, groups, history]);

  // Autosave
  useEffect(() => {
    if (isOpen && activeImage?.uuid && activeProjectId) {
      const uuid = activeImage.uuid;
      const timer = setTimeout(async () => {
        try {
          const saved = await DB.studioState.get(activeProjectId) || { histories: {} };
          if (!saved.histories) saved.histories = {};
          
          saved.histories[uuid] = {
            history: limitHistory(history),
            activeUrl: activeUrl || history[0],
            layers: { groups }
          };
          await DB.studioState.save(activeProjectId, saved);
        } catch (error) {
          console.error("Failed to autosave studio state", error);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [groups, history, activeUrl, isOpen, activeImage, activeProjectId]);

  const value = useMemo(() => ({
      isOpen, activeImage, history, setHistory, activeUrl, setActiveUrl,
      activeTool, setActiveTool, groups, setGroups,
      openStudio, closeStudio,
      strokeSize, setStrokeSize, strokeColor, setStrokeColor,
      cropRatio, setCropRatio
  }), [
    activeImage,
    activeTool,
    activeUrl,
    closeStudio,
    cropRatio,
    groups,
    history,
    isOpen,
    openStudio,
    strokeColor,
    strokeSize,
  ]);

  return (
    <StudioContext.Provider value={value}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within a StudioProvider");
  return context;
}




