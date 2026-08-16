"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo, useRef } from "react";
import DB from "@/lib/db";

interface AppContextType {
  // Modals & Menus
  menuOpen: boolean;
  setMenuOpen: (val: boolean) => void;
  projectsOpen: boolean;
  setProjectsOpen: (val: boolean) => void;
  projectCreateOpen: boolean;
  setProjectCreateOpen: (val: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (val: boolean) => void;
  
  promptSettingsOpen: boolean;
  setPromptSettingsOpen: (val: boolean) => void;
  
  // Project State
  activeProjectId: number | null;
  setActiveProjectId: (val: number | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initializeProject = async () => {
      try {
        const data = await DB.projects.getAll();
        if (data.length > 0) {
          data.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
          setActiveProjectId(data[0].id);
          return;
        }
        const newId = await DB.projects.create({ name: "Project 1" });
        setActiveProjectId(newId as number);
      } catch (error) {
        console.error("Failed to initialize project", error);
      }
    };

    void initializeProject();
  }, []);

  const value = useMemo(() => ({
    menuOpen,
    setMenuOpen,
    projectsOpen,
    setProjectsOpen,
    projectCreateOpen,
    setProjectCreateOpen,
    settingsOpen,
    setSettingsOpen,
    promptSettingsOpen,
    setPromptSettingsOpen,
    activeProjectId,
    setActiveProjectId,
  }), [
    activeProjectId,
    menuOpen,
    projectCreateOpen,
    projectsOpen,
    promptSettingsOpen,
    settingsOpen,
  ]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
