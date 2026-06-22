"use client";

import React, { useRef, ChangeEvent, useEffect, useState, useCallback } from "react";
import { useModule, ModuleFile, ModuleFolder } from "@/context/ModuleContext";
import { useStudio } from "@/context/StudioContext";
import { useApp } from "@/context/AppContext";
import DB from "@/lib/db";
import { deriveEditedName, loadImageMetadata } from "@/lib/imageMeta";
import { sortModuleFilesByLayerOrder } from "@/lib/pipeline/module-order";
import { describeReferenceStrength, normalizeStrength, type ReferenceRole } from "@/lib/pipeline/strength";

const ACCENTS = [
  "#ea3a8a",
  "#a352ff",
  "#5a8a3a",
  "#7a4a8a",
  "#c79a2a",
  "#3a8a7a",
];
const MODES = ["SUBJECT", "SCENE", "STYLE"];
const MODULE_PRESETS = [
  { id: "MOOD", name: "MOOD", accent: "#a352ff" },
  { id: "LOOKBOOK", name: "LOOKBOOK", accent: "#ea3a8a" },
  { id: "WORLD", name: "WORLD", accent: "#3a8a7a" },
];

const moduleRole = (mode: string) => {
  const role = String(mode || "").trim().toUpperCase();
  return MODES.includes(role) ? role : "UNASSIGNED";
};

export default function ModulePanel() {
  const {
    files,
    setFiles,
    folders,
    setFolders,
    openFolders,
    setOpenFolders,
    view,
    setView,
    activeFileId,
    setActiveFileId,
    searchQuery,
    setSearchQuery,
    showUpload,
    setShowUpload,
    pendingUpload,
    setPendingUpload,
    pendingUploadQueue,
    setPendingUploadQueue,
    collapsed,
    setCollapsed,
    selectMode,
    setSelectMode,
    selectedIds,
    setSelectedIds,
    menuFileId,
    setMenuFileId,
    moveFileId,
    setMoveFileId,
    folderMenuId,
    setFolderMenuId,
    editingFolder,
    setEditingFolder,
    addingFolder,
    setAddingFolder,
    dragOver,
    setDragOver,
    inspectorMenuOpen,
    setInspectorMenuOpen,
    renamingFileId,
    setRenamingFileId,
    labelEditOpen,
    setLabelEditOpen,
    showInfo,
    setShowInfo,
  } = useModule();

  const { openStudio } = useStudio();
  const { activeProjectId } = useApp();

  const persistReference = useCallback((file: ModuleFile) => {
    if (!activeProjectId) return;
    void DB.references.put({ ...file, project_id: activeProjectId })
      .catch((error) => console.error("Failed to persist module reference", error));
  }, [activeProjectId]);

  const persistImage = useCallback((uuid: string, url: string) => {
    if (!activeProjectId) return;
    void DB.images.put(uuid, url, activeProjectId)
      .catch((error) => console.error("Failed to persist module image", error));
  }, [activeProjectId]);

  const deleteReference = useCallback((id: number) => {
    void DB.references.delete(id)
      .catch((error) => console.error("Failed to delete module reference", error));
  }, []);

  const deleteImage = useCallback((uuid: string) => {
    void DB.images.delete(uuid)
      .catch((error) => console.error("Failed to delete module image", error));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<{
    fileId: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressNextRowClickRef = useRef(false);

  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<number | null>(null);
  const [dragPlaceholderIndex, setDragPlaceholderIndex] = useState<number | null>(null);

  const [folderFormName, setFolderFormName] = useState("");
  const [folderFormAccent, setFolderFormAccent] = useState(
    () => ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
  );
  const [folderPresetOpen, setFolderPresetOpen] = useState(false);

  // Sync collapsed state to body for gallery expansion
  useEffect(() => {
    if (collapsed) {
      document.body.classList.add("module-collapsed");
    } else {
      document.body.classList.remove("module-collapsed");
    }
  }, [collapsed]);

  // Close menus on outside click
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest(".cmp-menu") &&
        !target.closest(".cmp-dot") &&
        !target.closest(".cmp-folder-dot")
      ) {
        if (menuFileId || moveFileId) {
          setMenuFileId(null);
          setMoveFileId(null);
        }
        if (folderMenuId) setFolderMenuId(null);
      }
      if (inspectorMenuOpen && !target.closest(".cmp-inspector-menu-wrap")) {
        setInspectorMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [
    menuFileId,
    moveFileId,
    folderMenuId,
    inspectorMenuOpen,
    setFolderMenuId,
    setInspectorMenuOpen,
    setMenuFileId,
    setMoveFileId,
  ]);

  useEffect(() => {
    if (addingFolder) {
      setFolderFormName("");
      setFolderFormAccent(ACCENTS[Math.floor(Math.random() * ACCENTS.length)]);
      setFolderPresetOpen(false);
    } else if (editingFolder) {
      const folder = folders.find((f) => f.id === editingFolder);
      if (folder) {
        setFolderFormName(folder.id);
        setFolderFormAccent(folder.accent);
      }
      setFolderPresetOpen(false);
    }
  }, [addingFolder, editingFolder, folders]);

  const activeFile = files.find((f) => f.id === activeFileId);
  const getFolder = (fId: string | null) => folders.find((f) => f.id === fId);

  const updateFile = (id: number, patch: Partial<ModuleFile>) => {
    setFiles((prev) => {
      const previous = prev.find((f) => f.id === id);
      const next = prev.map((f) => (f.id === id ? { ...f, ...patch } : f));
      const updated = next.find((f) => f.id === id);
      if (updated) {
        persistReference(updated);
        if (patch.url && updated.uuid) {
          persistImage(updated.uuid, patch.url);
        }
        if (patch.uuid && previous?.uuid && previous.uuid !== patch.uuid) {
          deleteImage(previous.uuid);
        }
      }
      return next;
    });
  };

  const applyStudioResult = (file: ModuleFile, url: string) => {
    loadImageMetadata(url)
      .then((meta) => {
        updateFile(file.id, {
          url,
          name: deriveEditedName(file.name),
          size: meta.size,
          dims: meta.dims,
          modified: new Date().toLocaleTimeString(),
        });
      })
      .catch(() => {
        updateFile(file.id, {
          url,
          name: deriveEditedName(file.name),
          size: file.size,
          dims: file.dims || "IMAGE",
          modified: new Date().toLocaleTimeString(),
        });
      });
  };

  const setFileRole = (id: number, mode: string) => {
    setFiles((prev) => {
      const current = prev.find((f) => f.id === id);
      const nextMode = moduleRole(current?.mode || "") === mode ? "REFERENCE" : mode;
      const next = prev.map((f) => {
        if (f.id === id) return { ...f, mode: nextMode };
        if (nextMode === mode && moduleRole(f.mode) === mode) return { ...f, mode: "REFERENCE" };
        return f;
      });
      next
        .filter((f) => f.id === id || prev.some((old) => old.id === f.id && old.mode !== f.mode))
        .forEach(persistReference);
      return next;
    });
  };

  const removeFile = (id: number) => {
    const target = files.find((f) => f.id === id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    if (activeFileId === id) {
      setView("root");
      setActiveFileId(null);
    }
    if (activeProjectId) deleteReference(id);
    if (target?.uuid) deleteImage(target.uuid);
  };

  const assignFile = (fileId: number, folderId: string) => {
    updateFile(fileId, { folder: folderId, mode: "REFERENCE" });
    setOpenFolders((prev) => new Set(prev).add(folderId));
  };

  const duplicateFile = (file: ModuleFile) => {
    const copy = {
      ...file,
      id: Date.now(),
      label: `${file.label} COPY`,
      uuid: crypto.randomUUID(),
      mode: "REFERENCE",
    };
    if (activeProjectId) {
      if (file.url) persistImage(copy.uuid, file.url);
      persistReference(copy);
    }
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.id === file.id);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(e.target.files || []);
    if (!uploadedFiles.length) return;

    const replaceMode = view === "file" && activeFileId !== null;
    let filesToProcess = uploadedFiles;
    if (replaceMode) filesToProcess = filesToProcess.slice(0, 1);

    Promise.all(
      filesToProcess.map((file) => {
        return new Promise<{ url: string; file: File }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (evt) =>
            resolve({ url: evt.target?.result as string, file });
          reader.readAsDataURL(file);
        });
      }),
    ).then((uploads) => {
      if (replaceMode && activeFileId !== null) {
        const upload = uploads[0];
        updateFile(activeFileId, {
          url: upload.url,
          name: upload.file.name,
          size: Math.round(upload.file.size / 1024) + " KB",
          uuid: crypto.randomUUID(),
        });
      } else {
        const queue = [...uploads];
        const next = queue.shift() || null;
        setPendingUploadQueue(queue);
        setPendingUpload(next);
        setView("root");
        setActiveFileId(null);
        setCollapsed(false);
        setShowUpload(!!next);
        setMenuFileId(null);
        setMoveFileId(null);
        setFolderMenuId(null);
        setInspectorMenuOpen(false);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };

  const showNextPendingUpload = () => {
    const nextQueue = [...pendingUploadQueue];
    const next = nextQueue.shift() || null;
    setPendingUploadQueue(nextQueue);
    setPendingUpload(next);
    setShowUpload(!!next);
  };

  const handleUploadConfirm = (collapseAfter = false) => {
    if (!pendingUpload) return;
    const labelInput = document.getElementById(
      "cmp-upload-label",
    ) as HTMLInputElement;
    const label = (labelInput?.value || "UNLABELED").trim();

    const uuid = crypto.randomUUID();
    const id = parseInt(uuid.replace(/-/g, "").slice(0, 12), 16);

    const newFile: ModuleFile = {
      id,
      uuid,
      folder: null,
      kind: "IMG",
      label: label.toUpperCase(),
      name: pendingUpload.file.name,
      size: Math.round(pendingUpload.file.size / 1024) + " KB",
      dims: "IMAGE",
      modified: new Date().toLocaleTimeString(),
      eye: true,
      strength: 50,
      mode: "REFERENCE",
      url: pendingUpload.url,
    };

    if (activeProjectId) {
      persistImage(newFile.uuid, pendingUpload.url);
      persistReference(newFile);
      DB.projects.update(activeProjectId, {}).catch(console.error);
    }

    setFiles((prev) => [newFile, ...prev]);
    if (collapseAfter) {
      setPendingUpload(null);
      setShowUpload(false);
      setCollapsed(true);
      return;
    }
    showNextPendingUpload();
  };

  const renderUploadForm = () => {
    if (!pendingUpload) return null;
    const remaining = pendingUploadQueue.length;

    return (
      <div className="cmp-upload-form">
        <div className="cmp-upload-preview">
          <img src={pendingUpload.url} alt="" />
        </div>
        <label>
          NAME THIS BRIEF IMAGE {remaining ? `(${remaining + 1} SELECTED)` : ""}
        </label>
        <input
          id="cmp-upload-label"
          defaultValue={pendingUpload.file.name
            .replace(/\.[^.]+$/, "")
            .replace(/[_-]+/g, " ")
            .trim()
            .toUpperCase()}
          placeholder="CHARACTER - LOCATION - CAMERA LOOK..."
          onKeyDown={(e) => {
            if (e.key === "Enter") handleUploadConfirm();
          }}
          autoFocus
        />
        <div className="cmp-upload-actions">
          <button onClick={() => handleUploadConfirm()}>ADD</button>
          <button onClick={showNextPendingUpload}>CANCEL</button>
        </div>
      </div>
    );
  };

  // Drag and Drop
  const setMoveDragEffect = (e: React.DragEvent) => {
    e.dataTransfer.dropEffect = "move";
  };

  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    setDraggedFolderId(folderId);
    setDraggedFileId(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", folderId);
  };

  const handleFileDragStart = (e: React.DragEvent, fileId: number) => {
    setDraggedFileId(fileId);
    setDraggedFolderId(null);
    e.dataTransfer.effectAllowed = "move";
    const row = (e.currentTarget as HTMLElement).closest(".cmp-image-row") as HTMLElement | null;
    if (row) {
      const rect = row.getBoundingClientRect();
      const dragPreview = row.cloneNode(true) as HTMLElement;
      dragPreview.style.position = "fixed";
      dragPreview.style.top = "-1000px";
      dragPreview.style.left = "-1000px";
      dragPreview.style.width = `${rect.width}px`;
      dragPreview.style.pointerEvents = "none";
      dragPreview.style.boxShadow = "none";
      document.body.appendChild(dragPreview);
      e.dataTransfer.setDragImage(
        dragPreview,
        Math.max(0, e.clientX - rect.left),
        Math.max(0, e.clientY - rect.top),
      );
      window.setTimeout(() => dragPreview.remove(), 0);
    }
    e.dataTransfer.setData("text/plain", fileId.toString());
  };

  const clearDragState = useCallback(() => {
    setDraggedFileId(null);
    setDraggedFolderId(null);
    setDragPlaceholderIndex(null);
    setDragOver(null);
  }, [setDragOver]);

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    setMoveDragEffect(e);
    setDragOver(folderId);
  };

  const handleFolderDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggedFolderId) {
      if (draggedFolderId !== targetFolderId) {
        const draggedIdx = folders.findIndex((f) => f.id === draggedFolderId);
        const targetIdx = folders.findIndex((f) => f.id === targetFolderId);
        if (draggedIdx !== -1 && targetIdx !== -1) {
          const nextFolders = [...folders];
          const [moved] = nextFolders.splice(draggedIdx, 1);
          nextFolders.splice(targetIdx, 0, moved);
          setFolders(nextFolders);
        }
      }
    } else if (draggedFileId !== null) {
      assignFile(draggedFileId, targetFolderId);
    }

    setDraggedFolderId(null);
    setDraggedFileId(null);
    setDragPlaceholderIndex(null);
    setDragOver(null);
  };

  const handleFolderDragLeave = () => setDragOver(null);

  const handleFileDrop = (
    e: React.DragEvent,
    targetFileId: number,
    targetFolderId: string | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveDragEffect(e);

    if (draggedFileId !== null && draggedFileId !== targetFileId) {
      const draggedFile = files.find((f) => f.id === draggedFileId);
      if (!draggedFile) return;

      setFiles((prev) => {
        const tempFiles = prev.map((f) =>
          f.id === draggedFileId
            ? { ...f, folder: targetFolderId, mode: targetFolderId ? "REFERENCE" : f.mode }
            : f,
        );

        const groupFiles = tempFiles
          .filter((f) => f.folder === targetFolderId)
          .sort((a, b) => b.modified.localeCompare(a.modified));

        const draggedIdx = groupFiles.findIndex((f) => f.id === draggedFileId);
        const targetIdx = groupFiles.findIndex((f) => f.id === targetFileId);

        if (draggedIdx !== -1 && targetIdx !== -1) {
          const reorderedGroup = [...groupFiles];
          const [moved] = reorderedGroup.splice(draggedIdx, 1);
          reorderedGroup.splice(targetIdx, 0, moved);

          const now = Date.now();
          const next = tempFiles.map((f) => {
            if (f.folder === targetFolderId) {
              const idxInGroup = reorderedGroup.findIndex((x) => x.id === f.id);
              const newModified = new Date(
                now - idxInGroup * 1000,
              ).toISOString();
              const updatedFile = { ...f, modified: newModified };
              if (activeProjectId) persistReference(updatedFile);
              return updatedFile;
            }
            return f;
          });
          return next;
        }
        return prev;
      });
    }

    clearDragState();
  };

  const reorderRootFiles = useCallback((targetIndex: number | null, fileId: number) => {
    setFiles((prev) => {
      const draggedFile = prev.find((f) => f.id === fileId);
      if (!draggedFile || draggedFile.folder !== null) return prev;

      const rootFiles = sortModuleFilesByLayerOrder(
        prev.filter((f) => f.folder === null),
      );
      const withoutDragged = rootFiles.filter((f) => f.id !== fileId);
      const boundedIndex = Math.max(
        0,
        Math.min(targetIndex ?? withoutDragged.length, withoutDragged.length),
      );
      const reorderedRoot = [...withoutDragged];
      reorderedRoot.splice(boundedIndex, 0, draggedFile);

      const now = Date.now();
      const updatedRoot = reorderedRoot.map((file, index) => ({
        ...file,
        modified: new Date(now - index * 1000).toISOString(),
      }));
      const byId = new Map(updatedRoot.map((file) => [file.id, file]));
      const next = prev.map((file) => byId.get(file.id) || file);

      if (activeProjectId) {
        updatedRoot.forEach(persistReference);
      }

      return next;
    });
  }, [activeProjectId, persistReference, setFiles]);

  const startRootPointerReorder = (
    e: React.PointerEvent,
    fileId: number,
    rootFiles: ModuleFile[],
  ) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, .cmp-menu, .cmp-dot")) return;

    pointerDragRef.current = {
      fileId,
      startY: e.clientY,
      active: false,
    };
    const rootIndex = rootFiles.findIndex((f) => f.id === fileId);
    setDragPlaceholderIndex(rootIndex === -1 ? null : rootIndex);
  };

  const updatePointerPlaceholder = useCallback((clientY: number, fileId: number) => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        `.module-panel .cmp-image-row.loose[data-module-file-id]:not([data-module-file-id="${fileId}"])`,
      ),
    );
    const nextIndex = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    setDragPlaceholderIndex(nextIndex === -1 ? rows.length : nextIndex);
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag) return;

      const moved = Math.abs(e.clientY - drag.startY);
      if (!drag.active && moved < 4) return;

      e.preventDefault();
      if (!drag.active) {
        drag.active = true;
        suppressNextRowClickRef.current = true;
        setDraggedFileId(drag.fileId);
        setDraggedFolderId(null);
      }
      updatePointerPlaceholder(e.clientY, drag.fileId);
    };

    const handlePointerUp = () => {
      const drag = pointerDragRef.current;
      if (!drag) return;

      if (drag.active) {
        reorderRootFiles(dragPlaceholderIndex, drag.fileId);
      }
      pointerDragRef.current = null;
      clearDragState();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [clearDragState, dragPlaceholderIndex, reorderRootFiles, updatePointerPlaceholder]);

  const renderThumb = (file: ModuleFile) => {
    if (file.url)
      return <img className="cmp-thumb-img" src={file.url} alt="" />;
    return (
      <svg viewBox="0 0 100 100" className="cmp-thumb-svg">
        <rect width="100" height="100" fill="#3a4a55" />
        <circle cx="50" cy="34" r="14" fill="rgba(0,0,0,.45)" />
        <path d="M24 100Q24 64 50 60Q76 64 76 100Z" fill="rgba(0,0,0,.45)" />
      </svg>
    );
  };

  const renderRowMenu = (f: ModuleFile) => {
    if (menuFileId !== f.id && moveFileId !== f.id) return null;
    if (moveFileId === f.id) {
      return (
        <div className="cmp-menu cmp-move-menu">
          <div className="cmp-menu-title">MOVE TO BRIEF</div>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={f.folder === folder.id ? "current" : ""}
              onClick={(e) => {
                e.stopPropagation();
                assignFile(f.id, folder.id);
                setMoveFileId(null);
              }}
            >
              <i style={{ background: folder.accent }}></i>
              <span>{folder.name}</span>
              {f.folder === folder.id && <b>NOW</b>}
            </button>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMoveFileId(null);
            }}
          >
            CANCEL
          </button>
        </div>
      );
    }
    return (
      <div className="cmp-menu">
        <div className="cmp-menu-title">{f.label || "UNLABELED"}</div>
        <button
          className="primary"
          onClick={(e) => {
            e.stopPropagation();
            openStudio({
              uuid: f.uuid,
              imgUrl: f.url,
              caller: 'module',
              onDone: (url) => {
                if (url) applyStudioResult(f, url);
              }
            });
            setMenuFileId(null);
          }}
        >
          STUDIO
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenamingFileId(f.id);
            setMenuFileId(null);
          }}
        >
          RENAME
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMoveFileId(f.id);
            setMenuFileId(null);
          }}
        >
          MOVE TO...
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            duplicateFile(f);
            setMenuFileId(null);
          }}
        >
          DUPLICATE
        </button>
        <button
          className="danger"
          onClick={(e) => {
            e.stopPropagation();
            removeFile(f.id);
            setMenuFileId(null);
          }}
        >
          REMOVE
        </button>
      </div>
    );
  };

  const renderImageRow = (
    f: ModuleFile,
    showFolderTag: boolean,
    rootFilesForDrag?: ModuleFile[],
  ) => {
    const selected = selectedIds.has(f.id);
    const renaming = renamingFileId === f.id;
    const folder = folders.find((x) => x.id === f.folder);

    return (
      <div
        key={f.id}
        data-module-file-id={f.id}
        className={`cmp-image-row ${f.folder === null ? "loose" : ""} ${selected ? "selected" : ""} ${!f.eye ? "hidden" : ""}`}
        draggable={!rootFilesForDrag}
        onPointerDown={(e) => {
          if (rootFilesForDrag) startRootPointerReorder(e, f.id, rootFilesForDrag);
        }}
        onDragStart={(e) => {
          if (rootFilesForDrag) {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          handleFileDragStart(e, f.id);
        }}
        onDragOver={(e) => {
          if (!rootFilesForDrag) {
            e.preventDefault();
            e.stopPropagation();
            setMoveDragEffect(e);
          }
        }}
        onDrop={(e) => {
          if (!rootFilesForDrag) {
            e.preventDefault();
            e.stopPropagation();
            setMoveDragEffect(e);
            handleFileDrop(e, f.id, f.folder);
          }
        }}
        onDragEnd={() => {
          clearDragState();
        }}
        onClick={() => {
          if (suppressNextRowClickRef.current) {
            suppressNextRowClickRef.current = false;
            return;
          }
          if (collapsed) return;

          if (selectMode) {
            const next = new Set(selectedIds);
            if (next.has(f.id)) next.delete(f.id);
            else next.add(f.id);
            setSelectedIds(next);
          } else {
            setView("file");
            setActiveFileId(f.id);
            setShowInfo(false);
            setLabelEditOpen(false);
          }
        }}
        onDoubleClick={() => {
          if (!collapsed) return;

          setCollapsed(false);
          setView("file");
          setActiveFileId(f.id);
          setShowInfo(false);
          setLabelEditOpen(false);
        }}
      >
        {selectMode && (
          <span className="cmp-check">{selected ? "\u2713" : ""}</span>
        )}
        <div className="cmp-thumb">{renderThumb(f)}</div>
        <div className="cmp-row-main">
          {renaming ? (
            <input
              autoFocus
              className="cmp-inline-rename"
              defaultValue={f.label}
              onBlur={(e) => {
                updateFile(f.id, {
                  label: e.target.value.toUpperCase() || "UNLABELED",
                });
                setRenamingFileId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenamingFileId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="cmp-row-label">
              {f.label || "UNLABELED"}
              {showFolderTag && folder && <span>[{folder.name}]</span>}
            </div>
          )}
          <div className="cmp-row-meta">
            {f.folder === null && (
              <span className={`cmp-loose-tag mode-${moduleRole(f.mode)}`}>
                {moduleRole(f.mode)}
              </span>
            )}
            <span>{f.dims}</span>
            {!f.eye && <span>HIDDEN</span>}
            <span className="cmp-mini-strength" style={{ position: "relative" }}>
              <i style={{ position: "absolute", left: `${f.strength < 50 ? f.strength : 50}%`, width: `${Math.abs(f.strength - 50)}%` }}></i>
            </span>
            <span>{f.strength - 50 >= 0 ? "+" : ""}{f.strength - 50}</span>
          </div>
        </div>
        <button
          className={`cmp-dot ${menuFileId === f.id || moveFileId === f.id ? "open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuFileId(menuFileId === f.id ? null : f.id);
            setMoveFileId(null);
          }}
        >
          &#8943;
        </button>
        {renderRowMenu(f)}
      </div>
    );
  };

  const renderSortableRootRows = (rootFiles: ModuleFile[]) => {
    const isRootDrag =
      draggedFileId !== null &&
      rootFiles.some((file) => file.id === draggedFileId);

    if (!isRootDrag) {
      return rootFiles.map((f) => renderImageRow(f, false, rootFiles));
    }

    const visibleRows = rootFiles.filter((f) => f.id !== draggedFileId);
    const draggedFile = rootFiles.find((f) => f.id === draggedFileId);
    const placeholderIndex = Math.max(
      0,
      Math.min(dragPlaceholderIndex ?? visibleRows.length, visibleRows.length),
    );
    const rows: React.ReactNode[] = [];

    visibleRows.forEach((file, index) => {
      if (index === placeholderIndex && draggedFile) {
        rows.push(renderImageRow(draggedFile, false, rootFiles));
      }
      rows.push(renderImageRow(file, false, rootFiles));
    });

    if (placeholderIndex === visibleRows.length && draggedFile) {
      rows.push(renderImageRow(draggedFile, false, rootFiles));
    }

    return rows;
  };

  const renderFolderForm = (folder: ModuleFolder | null) => {
    const isNew = !folder;
    const activePresetIds = folders
      .filter((f) => f.id !== folder?.id)
      .map((f) => f.id);
    const options = MODULE_PRESETS.filter(
      (p) => !activePresetIds.includes(p.id),
    );

    const lockName =
      !isNew && options.length === 1 && options[0].id === folder?.id;

    const q = folderFormName.trim().toUpperCase();
    const list = options.filter((p) => !q || p.name.includes(q));

    const handleSave = () => {
      const preset = MODULE_PRESETS.find((p) => p.id === folderFormName);
      const allowed = preset && options.some((p) => p.id === preset.id);
      if (!allowed) return;

      if (folder) {
        setFolders(
          folders.map((f) =>
            f.id === folder.id
              ? {
                  ...f,
                  id: preset.id,
                  name: preset.name,
                  accent: folderFormAccent,
                }
              : f,
          ),
        );
        if (preset.id !== folder.id) {
          setFiles(
            files.map((f) =>
              f.folder === folder.id
                ? { ...f, folder: preset.id }
                : f,
            ),
          );
          setOpenFolders((prev) => {
            const next = new Set(prev);
            next.delete(folder.id);
            next.add(preset.id);
            return next;
          });
        }
        setEditingFolder(null);
      } else {
        setFolders([
          ...folders,
          { id: preset.id, name: preset.name, accent: folderFormAccent },
        ]);
        setOpenFolders((prev) => new Set(prev).add(preset.id));
        setAddingFolder(false);
      }
    };

    return (
      <div
        key={isNew ? "new-folder-form" : folder.id}
        className="cmp-folder-form"
      >
        <div className="cmp-folder-form-head">
              <span>{isNew ? "NEW BRIEF SLOT" : "BRIEF SLOT"}</span>
          <b>MOOD BOARD</b>
        </div>
        <div className="cmp-field-block">
          <label>CANVAS SLOT</label>
          <div className="cmp-preset-input">
            <input
              value={folderFormName}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                setFolderFormName(val);
                setFolderPresetOpen(true);
              }}
              placeholder="MOOD"
              readOnly={lockName}
            />
            <button
              type="button"
              onClick={() => {
                if (!lockName) {
                  setFolderFormName("");
                  setFolderPresetOpen(!folderPresetOpen);
                }
              }}
            >
              &#9662;
            </button>
          </div>
          {(folderPresetOpen || isNew) && (
            <div className="cmp-preset-list">
              {list.length > 0 ? (
                list.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setFolderFormName(p.id);
                      setFolderFormAccent(p.accent);
                      setFolderPresetOpen(false);
                    }}
                  >
                    <i style={{ background: p.accent }}></i>
                    <span>{p.name}</span>
                  </button>
                ))
              ) : (
                <span>NO SLOTS</span>
              )}
            </div>
          )}
        </div>
        <div className="cmp-field-block">
          <label>ACCENT</label>
          <div className="cmp-swatches">
            {ACCENTS.map((a) => (
              <button
                key={a}
                className={folderFormAccent === a ? "active" : ""}
                style={{ background: a }}
                onClick={() => setFolderFormAccent(a)}
              />
            ))}
          </div>
        </div>
        <div className="cmp-form-actions">
          <button className="primary" onClick={handleSave}>
            {isNew ? "CREATE" : "SAVE"}
          </button>
          <button
            onClick={() => {
              setAddingFolder(false);
              setEditingFolder(null);
            }}
          >
            CANCEL
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (folder: ModuleFolder) => {
    if (editingFolder === folder.id) return renderFolderForm(folder);

    const open = openFolders.has(folder.id);
    const menuOpen = folderMenuId === folder.id;
    const list = files
      .filter((f) => f.folder === folder.id)
      .sort((a, b) => b.modified.localeCompare(a.modified));
    const preview = list[0] ? (
      <span className="cmp-folder-preview">{renderThumb(list[0])}</span>
    ) : null;
    const slip =
      list.length > 1 ? (
        <span className="cmp-folder-slip">+{list.length - 1}</span>
      ) : null;

    return (
      <div
        key={folder.id}
        className={`cmp-folder ${dragOver === folder.id ? "drag-over" : ""} ${list.length === 0 ? "empty" : ""} ${list.length > 1 ? "stacked" : ""}`}
        style={{ "--folder-accent": folder.accent } as React.CSSProperties}
        draggable={true}
        onDragStart={(e) => handleFolderDragStart(e, folder.id)}
        onDragOver={(e) => handleFolderDragOver(e, folder.id)}
        onDragLeave={handleFolderDragLeave}
        onDrop={(e) => handleFolderDrop(e, folder.id)}
      >
        <div
          className={`cmp-folder-head ${open ? "open" : ""}`}
          style={{ background: open ? folder.accent : "" }}
        >
          <button
            className="cmp-folder-toggle"
            onClick={() => {
              const next = new Set(openFolders);
              if (next.has(folder.id)) next.delete(folder.id);
              else next.add(folder.id);
              setOpenFolders(next);
            }}
          >
            <span className="cmp-chevron"></span>
            <span className="cmp-folder-icon">
              {preview}
              {slip}
            </span>
            <span className="cmp-folder-name">
              {dragOver === folder.id
                ? `DROP INTO ${folder.name}`
                : folder.name}
            </span>
            <span className="cmp-count">{list.length}</span>
          </button>
          <button
            className={`cmp-folder-dot ${menuOpen ? "open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setFolderMenuId(menuOpen ? null : folder.id);
            }}
          >
            &#8943;
          </button>

          {menuOpen && (
            <div className="cmp-menu cmp-folder-menu">
              <div className="cmp-menu-title">{folder.name}</div>
              <button
                className="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingFolder(folder.id);
                  setFolderMenuId(null);
                }}
              >
                EDIT
              </button>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setFolders(folders.filter((f) => f.id !== folder.id));
                  setFiles(
                    files.map((f) =>
                      f.folder === folder.id ? { ...f, folder: null } : f,
                    ),
                  );
                  setFolderMenuId(null);
                }}
              >
                DELETE
              </button>
            </div>
          )}
        </div>
        {open && (
          <div className="cmp-folder-body">
            {list.map((f) => renderImageRow(f, false))}
          </div>
        )}
      </div>
    );
  };

  const renderRoot = () => {
    const q = searchQuery.trim().toLowerCase();
    const rootFiles = sortModuleFilesByLayerOrder(
      files.filter((f) => f.folder === null),
    );
    const roleFiles = files.filter((f) => moduleRole(f.mode) !== "UNASSIGNED");
    const assigned = files.filter((f) => f.folder !== null);
    const results = q
      ? assigned.filter((f) => {
          const folder = folders.find((x) => x.id === f.folder);
          return (
            f.label.toLowerCase().includes(q) ||
            (folder && folder.name.toLowerCase().includes(q))
          );
        })
      : [];

    return (
      <div className="cmp-panel">
        <div className="cmp-header">
          <button
            className="cmp-header-collapse"
            onClick={() => {
              if (showUpload) {
                handleUploadConfirm(true);
                return;
              }
              setCollapsed(!collapsed);
            }}
            title="Collapse brief"
          ></button>
          <span>MODULE</span>
        </div>
        <div className="cmp-search">
          <span>&#8981;</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="SEARCH"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}>&times;</button>
          )}
        </div>

        {showUpload ? renderUploadForm() : null}

        <div
          className="cmp-scroll"
          onDragOver={(e) => {
            e.preventDefault();
            setMoveDragEffect(e);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setMoveDragEffect(e);
            const fileId = parseInt(e.dataTransfer.getData("text/plain"), 10);
            if (!isNaN(fileId) && draggedFileId === fileId) {
              const draggedFile = files.find((f) => f.id === fileId);
              if (draggedFile && draggedFile.folder !== null) {
                updateFile(fileId, { folder: null });
              }
            }
            clearDragState();
          }}
        >
          {q ? (
            <>
              <div className="cmp-results-head">
                <span>RESULTS</span>
                <b>
                  {results.length} OF {assigned.length}
                </b>
              </div>
              {results.map((f) => renderImageRow(f, true))}
            </>
          ) : (
            <>
              {renderSortableRootRows(rootFiles)}
              {folders.map(renderFolder)}
              {addingFolder && renderFolderForm(null)}
            </>
          )}
        </div>

        {selectMode && selectedIds.size > 0 && (
          <div className="cmp-bulk">
            <span>{selectedIds.size} SELECTED</span>
            <div>
              <button
                onClick={() => {
                  const hiddenIds = new Set(selectedIds);
                  setFiles((prev) => {
                    const next = prev.map((f) =>
                      hiddenIds.has(f.id) ? { ...f, eye: false } : f,
                    );
                    if (activeProjectId) {
                      next
                        .filter((f) => hiddenIds.has(f.id))
                        .forEach(persistReference);
                    }
                    return next;
                  });
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              >
                HIDE
              </button>
              <button
                onClick={() => {
                  const deleteIds = new Set(selectedIds);
                  const filesToDelete = files.filter((f) => deleteIds.has(f.id));
                  setFiles((prev) => prev.filter((f) => !deleteIds.has(f.id)));
                  if (activeProjectId) {
                    deleteIds.forEach(deleteReference);
                  }
                  filesToDelete.forEach((f) => {
                    if (f.uuid) deleteImage(f.uuid);
                  });
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              >
                DELETE
              </button>
            </div>
          </div>
        )}

        <div className="cmp-actions">
          <div className="cmp-actions-left">
            <button
              className="cmp-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Load brief image"
            >
              <span className="cmp-plus-icon"></span>
            </button>
            <button
              className="cmp-icon-btn"
              onClick={() => setAddingFolder(true)}
              title="New brief slot"
            >
              <span className="cmp-folder-icon"></span>
            </button>
          </div>
          <button
            className={`cmp-select-btn ${selectMode ? "active" : ""}`}
            onClick={() => {
              setSelectMode(!selectMode);
              setSelectedIds(new Set());
            }}
          >
            {selectMode ? "DONE" : "SELECT"}
          </button>
        </div>

        <div className="cmp-status cmp-root-status">
          <span>
            {roleFiles.length}/3 MODULE &middot; {assigned.length} MOOD FILES
          </span>
          <span>{rootFiles.length} UNASSIGNED</span>
        </div>
      </div>
    );
  };

  const renderInspector = () => {
    const f = activeFile;
    if (!f) return renderRoot();
    const folder = getFolder(f.folder);
    const activeRole = moduleRole(f.mode) as ReferenceRole;
    const strengthInfo = describeReferenceStrength(f.strength, activeRole);

    const updateStrengthFromClientX = (clientX: number, element: HTMLDivElement) => {
      const r = element.getBoundingClientRect();
      updateFile(f.id, {
        strength: normalizeStrength(((clientX - r.left) / r.width) * 100),
      });
    };

    const handleStrengthPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      updateStrengthFromClientX(e.clientX, e.currentTarget);
    };

    const handleStrengthPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return;
      updateStrengthFromClientX(e.clientX, e.currentTarget);
    };

    const handleStrengthKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 10 : 5;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        updateFile(f.id, { strength: normalizeStrength(f.strength - step) });
      }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        updateFile(f.id, { strength: normalizeStrength(f.strength + step) });
      }
      if (e.key === "Home") {
        e.preventDefault();
        updateFile(f.id, { strength: 0 });
      }
      if (e.key === "End") {
        e.preventDefault();
        updateFile(f.id, { strength: 100 });
      }
    };

    const modeHelp = (mode: string) => {
      const msgs: Record<string, string> = {
        SUBJECT: "use as the main person, product, object, or wardrobe",
        SCENE: "use as the scene, set, props, lighting, or layout",
        STYLE: "use only the look, not content",
      };
      return msgs[mode] || "";
    };

    return (
      <div className="cmp-panel">
        <div className="cmp-detail-nav">
          <button
            onClick={() => {
              setView("root");
              setActiveFileId(null);
            }}
          >
            &lsaquo;
          </button>
          <span>
            <em>{folder ? folder.name : "ROOT"}</em> &rsaquo;{" "}
            <b>{f.label || "UNLABELED"}</b>
          </span>
        </div>
        <div className="cmp-detail-body">
          <div className="cmp-detail-section">
            <h4>CANVAS ROLE</h4>
            <div className="cmp-segments">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={moduleRole(f.mode) === m ? "active" : ""}
                  onClick={() => setFileRole(f.id, m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <p>{modeHelp(f.mode)}</p>
          </div>

          <div className="cmp-detail-section">
            <h4>STRENGTH</h4>
            <div className="cmp-strength-head">
              <b>{strengthInfo.uiValue >= 0 ? "+" : ""}{strengthInfo.uiValue} &middot; {strengthInfo.strengthLabel.toUpperCase()}</b>
            </div>
            <div
              className="cmp-strength"
              role="slider"
              tabIndex={0}
              aria-label="Reference strength"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={strengthInfo.value}
              aria-valuetext={`${strengthInfo.strengthLabel} ${strengthInfo.value}%`}
              onPointerDown={handleStrengthPointerDown}
              onPointerMove={handleStrengthPointerMove}
              onKeyDown={handleStrengthKeyDown}
            >
              <i style={{ position: "absolute", left: `${strengthInfo.uiValue < 0 ? strengthInfo.value : 50}%`, width: `${Math.abs(strengthInfo.uiValue)}%` }}></i>
              <span style={{ left: "25%" }}></span>
              <span style={{ left: "50%" }}></span>
              <span style={{ left: "75%" }}></span>
            </div>
            <div className="cmp-scale">
              <span>IMPROVISE</span>
              <span>FAITHFUL</span>
              <span>EXPRESSIVE</span>
            </div>
          </div>

          <div className="cmp-image-card-stack">
            <div className="cmp-image-card-actions">
              <div className="cmp-inspector-menu-wrap">
                <button
                  className={`cmp-dot ${inspectorMenuOpen ? "open" : ""}`}
                  onClick={() => setInspectorMenuOpen(!inspectorMenuOpen)}
                  title="Image actions"
                >
                  &#8943;
                </button>
                {inspectorMenuOpen && (
                  <div className="cmp-menu cmp-inspector-menu">
                    <div className="cmp-menu-title">{f.label || "UNLABELED"}</div>
                    <button
                      className="primary"
                      onClick={() => {
                        openStudio({
                          uuid: f.uuid,
                          imgUrl: f.url,
                          caller: 'module',
                          onDone: (url) => {
                            if (url) applyStudioResult(f, url);
                          }
                        });
                        setInspectorMenuOpen(false);
                      }}
                    >
                      STUDIO
                    </button>
                    <button
                      onClick={() => {
                        setInspectorMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      REPLACE
                    </button>
                  </div>
                )}
              </div>
              <div className="cmp-image-card-actions-right">
                <button
                  className={`cmp-image-eye ${!f.eye ? "off" : ""}`}
                  title={f.eye ? "Hide image" : "Show image"}
                  onClick={() => updateFile(f.id, { eye: !f.eye })}
                >
                  <img
                    src={f.eye ? "assets/icon-eye-on.svg" : "assets/icon-eye-off.svg"}
                    alt={f.eye ? "visible" : "hidden"}
                  />
                </button>
                <button
                  className="cmp-image-remove"
                  title="Remove image"
                  onClick={() => removeFile(f.id)}
                >
                  <img src="assets/icon-trash.svg" alt="remove" />
                </button>
              </div>
            </div>
            <div
              className="cmp-big-thumb"
              title="Open in Studio"
              onClick={() => openStudio({
                uuid: f.uuid,
                imgUrl: f.url,
                caller: 'module',
                onDone: (url) => {
                  if (url) applyStudioResult(f, url);
                }
              })}
            >
              {renderThumb(f)}
              <span>{f.dims}</span>
              <b className={`mode-${moduleRole(f.mode)}`}>{moduleRole(f.mode)}</b>
            </div>
            <div className="cmp-label-card">
              <input
                className="cmp-label-input"
                readOnly={!labelEditOpen}
                defaultValue={f.label}
                onBlur={(e) => {
                  updateFile(f.id, {
                    label: e.target.value.toUpperCase() || "UNLABELED",
                  });
                  setLabelEditOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <button
                className="cmp-label-edit"
                onClick={() => setLabelEditOpen(true)}
              >
                EDIT
              </button>
            </div>
          </div>
        </div>

        {showInfo && (
          <div className="cmp-info open">
            <span>FILE</span>
            <b>{f.name}</b>
            <span>SIZE</span>
            <b>{f.size}</b>
            <span>DIM</span>
            <b>{f.dims}</b>
          </div>
        )}
        <div className="cmp-status cmp-detail-status">
          <button onClick={() => setShowInfo(!showInfo)}>
            INFO {showInfo ? "\u25b2" : "\u25bc"}
          </button>
          <span>
            {f.strength - 50 >= 0 ? "+" : ""}{f.strength - 50} &middot; {moduleRole(f.mode)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="right-sidebar">
      <div className={`mod-panel-wrap ${collapsed ? "collapsed" : ""}`}>
        <div className={`module-panel ${draggedFileId !== null || draggedFolderId !== null ? "dragging" : ""}`} ref={panelRef}>
          {view === "file" ? renderInspector() : renderRoot()}
        </div>
      </div>
      <input
        type="file"
        id="mp-file-input"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        ref={fileInputRef}
        onChange={handleFileUpload}
      />
    </div>
  );
}
