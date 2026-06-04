"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import DB from "@/lib/db";

interface AppContextType {
  // Modals & Menus
  menuOpen: boolean;
  setMenuOpen: (val: boolean) => void;
  projectsOpen: boolean;
  setProjectsOpen: (val: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (val: boolean) => void;
  
  // Prompt Bar State
  generationState: "FRAME" | "SCENE";
  setGenerationState: (val: "FRAME" | "SCENE") => void;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const [generationState, setGenerationState] = useState<"FRAME" | "SCENE">("FRAME");
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);

  useEffect(() => {
    DB.projects.getAll().then((data) => {
      if (data && data.length > 0) {
        data.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
        setActiveProjectId(data[0].id);
      } else {
        DB.projects.create({ name: 'Project 1' }).then((newId) => {
          setActiveProjectId(newId as number);
        });
      }
    }).catch(console.error);
  }, []);

  return (
    <AppContext.Provider
      value={{
        menuOpen,
        setMenuOpen,
        projectsOpen,
        setProjectsOpen,
        settingsOpen,
        setSettingsOpen,
        generationState,
        setGenerationState,
        promptSettingsOpen,
        setPromptSettingsOpen,
        activeProjectId,
        setActiveProjectId,
      }}
    >
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
