"use client";

import React, { createContext, useContext, useMemo, useState, ReactNode, useEffect } from "react";
import DB from "@/lib/db";
import { useApp } from "@/context/AppContext";
import { moduleFileForStorage } from "@/lib/moduleFiles";
import { pruneProjectImages } from "@/lib/projectImageGc";
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
  eye: boolean;
  strength: number;
  mode: string;
  url: string;
};

export type ModuleFolder = {
  id: string;
  name: string;
  accent: string;
  locked?: boolean;
};

const DEFAULT_FOLDERS: ModuleFolder[] = [];

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
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  
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
    let cancelled = false;

    if (activeProjectId) {
      DB.references.getByProject(activeProjectId).then(async data => {
        const storedFiles = data as ModuleFile[];
        const visibleFiles = storedFiles.map((file) => ({ ...file, url: "" }));
        if (!cancelled) setFiles(visibleFiles);

        try {
          const images = await DB.images.getMany(
            visibleFiles.map((file) => file.uuid).filter(Boolean),
          );
          const imageUrlsByUuid = new Map(
            images
              .filter((image): image is { uuid: string; dataUrl: string } => Boolean(image?.uuid && image?.dataUrl))
              .map((image) => [image.uuid, image.dataUrl]),
          );
          const originalsById = new Map(storedFiles.map((file) => [file.id, file]));
          const hydratedFiles = visibleFiles.map((file) => ({
            ...file,
            url: imageUrlsByUuid.get(file.uuid) || originalsById.get(file.id)?.url || "",
          }));

          if (!cancelled) {
            setFiles(hydratedFiles);
            pruneProjectImages(activeProjectId).catch(console.error);
          }

          await Promise.all(hydratedFiles.map(async (file) => {
            const original = originalsById.get(file.id);
            if (!file.uuid || !file.url || !original?.url) return;
            await DB.images.put(file.uuid, file.url, activeProjectId);
            await DB.references.put({ ...moduleFileForStorage(file), project_id: activeProjectId });
          }));
        } catch (error) {
          console.error("Failed to restore module images", error);
          if (!cancelled) {
            setFiles(storedFiles);
            pruneProjectImages(activeProjectId).catch(console.error);
          }
        }
      }).catch(console.error);
    } else {
      setFiles([]);
    }

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const value = useMemo(() => ({
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
  }), [
    activeFileId,
    addingFolder,
    collapsed,
    dragOver,
    editingFolder,
    files,
    folderMenuId,
    folders,
    inspectorMenuOpen,
    labelEditOpen,
    menuFileId,
    moveFileId,
    openFolders,
    pendingUpload,
    pendingUploadQueue,
    renamingFileId,
    searchQuery,
    selectMode,
    selectedIds,
    showInfo,
    showUpload,
    view,
  ]);

  return (
    <ModuleContext.Provider value={value}>
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



