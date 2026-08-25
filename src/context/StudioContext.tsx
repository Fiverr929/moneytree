"use client";

import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import {
  appendStudioResult,
  loadStudioEntry,
  saveStudioEntry,
} from "@/lib/studioState";

export type ModuleImage = { uuid: string, url: string, visible?: boolean };

export type StudioGroup = {
  action: string;
  name: string;
  images: ModuleImage[];
};

export type StudioConfig = {
  uuid?: string;
  workspaceKey?: string;
  imgUrl?: string;
  ratio?: string;
  caller?: string;
  onDone?: (url: string | null) => void;
};

export type StudioSession = {
  id: number;
  projectId: number | null;
  workspaceKey: string | null;
  sourceUuid?: string;
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
  studioSession: StudioSession | null;
  completeStudioGeneration: (input: {
    session: StudioSession;
    generatedUrl: string;
    fallbackHistory: string[];
    fallbackGroups: StudioGroup[];
  }) => Promise<boolean>;
  isStudioSessionCurrent: (sessionId: number) => boolean;
  
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
  const [studioSession, setStudioSession] = useState<StudioSession | null>(null);
  
  const [strokeSize, setStrokeSize] = useState(3);
  const [strokeColor, setStrokeColor] = useState('#ea5823');
  const [cropRatio, setCropRatio] = useState<number | 'free'>(16 / 9);
  const openRequestRef = useRef(0);
  const activeSessionRef = useRef<StudioSession | null>(null);
  const hydratedSessionRef = useRef<number | null>(null);

  // Load state when a new image is opened
  const openStudio = useCallback(async (config: StudioConfig) => {
    const requestId = ++openRequestRef.current;
    const session: StudioSession = {
      id: requestId,
      projectId: activeProjectId,
      workspaceKey: config.workspaceKey || config.uuid || null,
      sourceUuid: config.uuid,
    };
    activeSessionRef.current = session;
    hydratedSessionRef.current = null;
    setStudioSession(session);
    setActiveImage(config);
    setIsOpen(true);
    setActiveTool(null);
    setHistory(config.imgUrl ? [config.imgUrl] : []);
    setActiveUrl(config.imgUrl || null);
    setGroups([]);
    
    if (session.workspaceKey && activeProjectId) {
      try {
        const entry = await loadStudioEntry(
          activeProjectId,
          session.workspaceKey,
          config.uuid,
          config.imgUrl,
        );
        if (openRequestRef.current !== requestId) return;
        if (entry) {
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
      } finally {
        if (openRequestRef.current === requestId) hydratedSessionRef.current = requestId;
      }
    } else {
      setGroups([]);
      hydratedSessionRef.current = requestId;
    }
  }, [activeProjectId]);

  const closeStudio = useCallback(async (finalUrl?: string | null) => {
    const closingSession = activeSessionRef.current;
    const wasHydrated = closingSession?.id === hydratedSessionRef.current;
    openRequestRef.current += 1;
    activeSessionRef.current = null;
    hydratedSessionRef.current = null;
    setStudioSession(null);
    setIsOpen(false);
    
    if (activeImage && closingSession?.workspaceKey && activeProjectId && wasHydrated) {
      try {
        await saveStudioEntry(activeProjectId, closingSession.workspaceKey, {
          history: limitHistory(history),
          activeUrl: finalUrl || activeUrl || history[0],
          layers: { groups }
        }, activeImage.uuid);
      } catch (_err: unknown) {
        console.error("Failed to save studio state", _err);
      }
    }
    
    const resolvedFinalUrl = finalUrl || activeUrl || null;
    if (activeImage?.onDone && resolvedFinalUrl && resolvedFinalUrl !== activeImage.imgUrl) {
      activeImage.onDone(resolvedFinalUrl);
    }
    setActiveImage(null);
    setActiveUrl(null);
    setHistory([]);
    setGroups([]);
  }, [activeImage, activeProjectId, activeUrl, groups, history]);

  const completeStudioGeneration = useCallback(async (input: {
    session: StudioSession;
    generatedUrl: string;
    fallbackHistory: string[];
    fallbackGroups: StudioGroup[];
  }) => {
    const currentSession = activeSessionRef.current;
    const hasNewerSameWorkspace = Boolean(
      currentSession
      && currentSession.id !== input.session.id
      && currentSession.workspaceKey === input.session.workspaceKey,
    );

    if (input.session.projectId && input.session.workspaceKey) {
      await appendStudioResult({
        projectId: input.session.projectId,
        workspaceKey: input.session.workspaceKey,
        legacyUuid: input.session.sourceUuid,
        generatedUrl: input.generatedUrl,
        fallbackHistory: input.fallbackHistory,
        fallbackGroups: input.fallbackGroups,
        activateResult: !hasNewerSameWorkspace,
      });
    }

    return activeSessionRef.current?.id === input.session.id;
  }, []);

  const isStudioSessionCurrent = useCallback((sessionId: number) => (
    activeSessionRef.current?.id === sessionId
  ), []);

  // Autosave
  useEffect(() => {
    if (
      isOpen
      && activeImage
      && studioSession?.workspaceKey
      && activeProjectId
      && hydratedSessionRef.current === studioSession.id
    ) {
      const { workspaceKey, sourceUuid } = studioSession;
      const timer = setTimeout(async () => {
        try {
          await saveStudioEntry(activeProjectId, workspaceKey, {
            history: limitHistory(history),
            activeUrl: activeUrl || history[0],
            layers: { groups }
          }, sourceUuid);
        } catch (error) {
          console.error("Failed to autosave studio state", error);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [groups, history, activeUrl, isOpen, activeImage, activeProjectId, studioSession]);

  const value = useMemo(() => ({
      isOpen, activeImage, history, setHistory, activeUrl, setActiveUrl,
      activeTool, setActiveTool, groups, setGroups, studioSession,
      completeStudioGeneration, isStudioSessionCurrent,
      openStudio, closeStudio,
      strokeSize, setStrokeSize, strokeColor, setStrokeColor,
      cropRatio, setCropRatio
  }), [
    activeImage,
    activeTool,
    activeUrl,
    closeStudio,
    completeStudioGeneration,
    cropRatio,
    groups,
    history,
    isOpen,
    isStudioSessionCurrent,
    openStudio,
    strokeColor,
    strokeSize,
    studioSession,
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




