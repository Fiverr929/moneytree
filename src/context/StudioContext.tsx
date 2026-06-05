"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
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

export function StudioProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [activeImage, setActiveImage] = useState<StudioConfig | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<'pencil' | 'crop' | null>(null);
  const [groups, setGroups] = useState<StudioGroup[]>([]);
  
  const [strokeSize, setStrokeSize] = useState(3);
  const [strokeColor, setStrokeColor] = useState('#ea5823');
  const [cropRatio, setCropRatio] = useState<number | 'free'>(16 / 9);

  // Load state when a new image is opened
  const openStudio = async (config: StudioConfig) => {
    setActiveImage(config);
    setIsOpen(true);
    setActiveTool(null);
    setHistory(config.imgUrl ? [config.imgUrl] : []);
    
    if (config.uuid && activeProjectId) {
      try {
        const saved = await DB.studioState.get(activeProjectId);
        if (saved && saved.histories && saved.histories[config.uuid]) {
          const entry = saved.histories[config.uuid];
          if (entry.history && entry.history.length > 0) {
            setHistory(entry.history);
          }
          if (entry.layers && entry.layers.groups) {
            setGroups(entry.layers.groups);
          }
        } else {
          setGroups([]);
        }
      } catch (_err: unknown) {
        console.error("Failed to load studio state", _err);
      }
    } else {
      setGroups([]);
    }
  };

  const closeStudio = async (finalUrl?: string | null) => {
    setIsOpen(false);
    
    if (activeImage && activeImage.uuid && activeProjectId) {
      try {
        const saved = await DB.studioState.get(activeProjectId) || { histories: {} };
        if (!saved.histories) saved.histories = {};
        
        saved.histories[activeImage.uuid] = {
          history,
          activeUrl: finalUrl || history[0],
          layers: { groups }
        };
        await DB.studioState.save(activeProjectId, saved);
      } catch (_err: unknown) {
        console.error("Failed to save studio state", _err);
      }
    }
    
    if (activeImage?.onDone) {
      activeImage.onDone(finalUrl || null);
    }
    setActiveImage(null);
  };

  // Autosave
  useEffect(() => {
    if (isOpen && activeImage?.uuid && activeProjectId) {
      const uuid = activeImage.uuid;
      const timer = setTimeout(async () => {
        try {
          const saved = await DB.studioState.get(activeProjectId) || { histories: {} };
          if (!saved.histories) saved.histories = {};
          
          saved.histories[uuid] = {
            history,
            activeUrl: history[0],
            layers: { groups }
          };
          await DB.studioState.save(activeProjectId, saved);
        } catch {}
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [groups, history, isOpen, activeImage, activeProjectId]);

  return (
    <StudioContext.Provider value={{
      isOpen, activeImage, history, setHistory,
      activeTool, setActiveTool, groups, setGroups,
      openStudio, closeStudio,
      strokeSize, setStrokeSize, strokeColor, setStrokeColor,
      cropRatio, setCropRatio
    }}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within a StudioProvider");
  return context;
}




