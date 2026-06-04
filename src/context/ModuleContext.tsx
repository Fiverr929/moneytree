"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from "react";
import DB from "@/lib/db";
import { useApp } from "@/context/AppContext";
export type ModuleFile = {
  id: number;
  uuid: string;
  folder: string | null;
  kind: "IMG";
  label: string;
  name: string;
  size: string;
  dims: string;
  modified: string;
  linked: boolean;
  eye: boolean;
  strength: number;
  mode: string;
  url: string;
  visionDesc: string;
};

export type ModuleFolder = {
  id: string;
  name: string;
  accent: string;
  locked?: boolean;
};

const DEFAULT_FOLDERS: ModuleFolder[] = [
  { id: "SUBJECT", name: "SUBJECT", accent: "#ea5823" },
  { id: "STAGE", name: "STAGE", accent: "#ea5823" },
  { id: "STYLE", name: "STYLE", accent: "#ea5823" },
];

export type PendingUpload = {
  url: string;
  file: File;
};

interface ModuleContextType {
  files: ModuleFile[];
  setFiles: React.Dispatch<React.SetStateAction<ModuleFile[]>>;
  folders: ModuleFolder[];
  setFolders: React.Dispatch<React.SetStateAction<ModuleFolder[]>>;
  openFolders: Set<string>;
  setOpenFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  
  view: "root" | "file";
  setView: React.Dispatch<React.SetStateAction<"root" | "file">>;
  activeFileId: number | null;
  setActiveFileId: React.Dispatch<React.SetStateAction<number | null>>;
  
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  
  showUpload: boolean;
  setShowUpload: React.Dispatch<React.SetStateAction<boolean>>;
  pendingUpload: PendingUpload | null;
  setPendingUpload: React.Dispatch<React.SetStateAction<PendingUpload | null>>;
  pendingUploadQueue: PendingUpload[];
  setPendingUploadQueue: React.Dispatch<React.SetStateAction<PendingUpload[]>>;
  
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  
  selectMode: boolean;
  setSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedIds: Set<number>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  menuFileId: number | null;
  setMenuFileId: React.Dispatch<React.SetStateAction<number | null>>;
  moveFileId: number | null;
  setMoveFileId: React.Dispatch<React.SetStateAction<number | null>>;
  folderMenuId: string | null;
  setFolderMenuId: React.Dispatch<React.SetStateAction<string | null>>;
  editingFolder: string | null;
  setEditingFolder: React.Dispatch<React.SetStateAction<string | null>>;
  addingFolder: boolean;
  setAddingFolder: React.Dispatch<React.SetStateAction<boolean>>;
  dragOver: string | null;
  setDragOver: React.Dispatch<React.SetStateAction<string | null>>;
  inspectorMenuOpen: boolean;
  setInspectorMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  renamingFileId: number | null;
  setRenamingFileId: React.Dispatch<React.SetStateAction<number | null>>;
  labelEditOpen: boolean;
  setLabelEditOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showInfo: boolean;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<ModuleFile[]>([]);
  const [folders, setFolders] = useState<ModuleFolder[]>(DEFAULT_FOLDERS);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(["SUBJECT", "STAGE", "STYLE"]));
  
  const [view, setView] = useState<"root" | "file">("root");
  const [activeFileId, setActiveFileId] = useState<number | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [pendingUploadQueue, setPendingUploadQueue] = useState<PendingUpload[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  // New states for full functionality
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [menuFileId, setMenuFileId] = useState<number | null>(null);
  const [moveFileId, setMoveFileId] = useState<number | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [inspectorMenuOpen, setInspectorMenuOpen] = useState(false);
  const [renamingFileId, setRenamingFileId] = useState<number | null>(null);
  const [labelEditOpen, setLabelEditOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const { activeProjectId } = useApp();

  useEffect(() => {
    if (activeProjectId) {
      DB.references.getByProject(activeProjectId).then(async data => {
        const files = data as ModuleFile[];
        const withUrls = await Promise.all(files.map(async f => {
          if (f.uuid) {
            try {
              const img = await DB.images.get(f.uuid);
              if (img && img.dataUrl) return { ...f, url: img.dataUrl };
            } catch(e) {}
          }
          return f;
        }));
        setFiles(withUrls);
      }).catch(console.error);
    } else {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setFiles([]);
    }
  }, [activeProjectId]);

  return (
    <ModuleContext.Provider
      value={{
        files, setFiles,
        folders, setFolders,
        openFolders, setOpenFolders,
        view, setView,
        activeFileId, setActiveFileId,
        searchQuery, setSearchQuery,
        showUpload, setShowUpload,
        pendingUpload, setPendingUpload,
        pendingUploadQueue, setPendingUploadQueue,
        collapsed, setCollapsed,
        
        selectMode, setSelectMode,
        selectedIds, setSelectedIds,
        menuFileId, setMenuFileId,
        moveFileId, setMoveFileId,
        folderMenuId, setFolderMenuId,
        editingFolder, setEditingFolder,
        addingFolder, setAddingFolder,
        dragOver, setDragOver,
        inspectorMenuOpen, setInspectorMenuOpen,
        renamingFileId, setRenamingFileId,
        labelEditOpen, setLabelEditOpen,
        showInfo, setShowInfo
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
}

export function useModule() {
  const context = useContext(ModuleContext);
  if (!context) {
    throw new Error("useModule must be used within a ModuleProvider");
  }
  return context;
}



