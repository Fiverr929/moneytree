"use client";

import React, { useRef, ChangeEvent, useEffect, useState } from "react";
import { useModule, ModuleFile, ModuleFolder } from "@/context/ModuleContext";
import { useStudio } from "@/context/StudioContext";
import { useApp } from "@/context/AppContext";
import { useSettings } from "@/context/SettingsContext";
import DB from "@/lib/db";

const C = { pink: "#ea3a8a", violet: "#a352ff" };
const ACCENTS = [
  "#ea3a8a",
  "#a352ff",
  "#5a8a3a",
  "#7a4a8a",
  "#c79a2a",
  "#3a8a7a",
];
const MODES = ["SUBJECT", "STAGE", "STYLE", "MOOD", "ALL"];
const MODULE_PRESETS = [
  { id: "SUBJECT", name: "SUBJECT", accent: "#ea3a8a" },
  { id: "STAGE", name: "STAGE", accent: "#5a8a3a" },
  { id: "STYLE", name: "STYLE", accent: "#c79a2a" },
  { id: "MOOD", name: "MOOD", accent: "#a352ff" },
];

export default function ModulePanel() {
  const settings = useSettings();
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<number | null>(null);

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
      const next = prev.map((f) => (f.id === id ? { ...f, ...patch } : f));
      const updated = next.find((f) => f.id === id);
      if (updated && activeProjectId)
        DB.references.put({ ...updated, project_id: activeProjectId });
      return next;
    });
  };

  const removeFile = (id: number) => {
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
    if (activeProjectId) DB.references.delete(id);
  };

  const assignFile = (fileId: number, folderId: string) => {
    const preset = MODULE_PRESETS.find((p) => p.id === folderId);
    const mode = preset
      ? preset.id === "MOOD"
        ? "MOOD"
        : preset.id === "STYLE"
          ? "STYLE"
          : preset.id === "STAGE"
            ? "STAGE"
            : "SUBJECT"
      : "SUBJECT";
    updateFile(fileId, { folder: folderId, mode });
    setOpenFolders((prev) => new Set(prev).add(folderId));
  };

  const duplicateFile = (file: ModuleFile) => {
    const copy = {
      ...file,
      id: Date.now(),
      label: `${file.label} COPY`,
      uuid: crypto.randomUUID(),
    };
    if (activeProjectId)
      DB.references.put({ ...copy, project_id: activeProjectId });
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
          visionDesc: "",
        });
      } else {
        const queue = [...uploads];
        const next = queue.shift() || null;
        setPendingUploadQueue(queue);
        setPendingUpload(next);
        setView("root");
        setActiveFileId(null);
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

  const handleUploadConfirm = () => {
    if (!pendingUpload) return;
    const labelInput = document.getElementById(
      "cmp-upload-label",
    ) as HTMLInputElement;
    const label = (labelInput?.value || "UNLABELED").trim();

    const newFile: ModuleFile = {
      id: Date.now(),
      uuid: crypto.randomUUID(),
      folder: null,
      kind: "IMG",
      label: label.toUpperCase(),
      name: pendingUpload.file.name,
      size: Math.round(pendingUpload.file.size / 1024) + " KB",
      dims: "IMAGE",
      modified: new Date().toLocaleTimeString(),
      eye: true,
      strength: 50,
      mode: "SUBJECT",
      url: pendingUpload.url,
      visionDesc: "",
    };

    if (activeProjectId) {
      DB.images.put(newFile.uuid, pendingUpload.url, activeProjectId);
      DB.references.put({ ...newFile, project_id: activeProjectId });
      DB.projects.update(activeProjectId, {}).catch(console.error);
    }

    setFiles((prev) => [newFile, ...prev]);
    showNextPendingUpload();

    if (settings.googleApiKey) {
      import("@/lib/pipeline/vision").then((vision) => {
        vision
          .describe(
            newFile.url,
            newFile.label,
            "subject",
            settings.googleApiKey,
          )
          .then((desc) => updateFile(newFile.id, { visionDesc: desc }))
          .catch(console.error);
      });
    }
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
          <button onClick={handleUploadConfirm}>ADD</button>
          <button onClick={showNextPendingUpload}>CANCEL</button>
        </div>
      </div>
    );
  };

  // Drag and Drop
  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    setDraggedFolderId(folderId);
    setDraggedFileId(null);
    e.dataTransfer.setData("text/plain", folderId);
  };

  const handleFileDragStart = (e: React.DragEvent, fileId: number) => {
    setDraggedFileId(fileId);
    setDraggedFolderId(null);
    e.dataTransfer.setData("text/plain", fileId.toString());
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
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

    if (draggedFileId !== null && draggedFileId !== targetFileId) {
      const draggedFile = files.find((f) => f.id === draggedFileId);
      if (!draggedFile) return;

      const preset = targetFolderId
        ? MODULE_PRESETS.find((p) => p.id === targetFolderId)
        : null;
      const newMode = preset ? preset.id : draggedFile.mode;

      setFiles((prev) => {
        const tempFiles = prev.map((f) =>
          f.id === draggedFileId
            ? { ...f, folder: targetFolderId, mode: newMode }
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
              if (activeProjectId)
                DB.references.put({
                  ...updatedFile,
                  project_id: activeProjectId,
                });
              return updatedFile;
            }
            return f;
          });
          return next;
        }
        return prev;
      });
    }

    setDraggedFileId(null);
    setDraggedFolderId(null);
  };

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
            openStudio({ uuid: f.uuid, imgUrl: f.url });
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

  const renderImageRow = (f: ModuleFile, showFolderTag: boolean) => {
    const selected = selectedIds.has(f.id);
    const renaming = renamingFileId === f.id;
    const folder = folders.find((x) => x.id === f.folder);

    return (
      <div
        key={f.id}
        className={`cmp-image-row ${f.folder === null ? "loose" : ""} ${selected ? "selected" : ""} ${!f.eye ? "hidden" : ""}`}
        draggable={true}
        onDragStart={(e) => {
          e.stopPropagation();
          handleFileDragStart(e, f.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleFileDrop(e, f.id, f.folder);
        }}
        onClick={() => {
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
              <span className="cmp-loose-tag">UNASSIGNED</span>
            )}
            <span>{f.dims}</span>
            {!f.eye && <span>HIDDEN</span>}
            <span className="cmp-mini-strength">
              <i style={{ width: `${f.strength}%` }}></i>
            </span>
            <span>{f.strength}%</span>
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
                ? { ...f, folder: preset.id, mode: preset.id }
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
          <b>PRESET</b>
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
              placeholder="SUBJECT / STAGE / STYLE"
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
    const rootFiles = files
      .filter((f) => f.folder === null)
      .sort((a, b) => b.modified.localeCompare(a.modified));
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
            onClick={() => setCollapsed(!collapsed)}
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
          }}
          onDrop={(e) => {
            e.preventDefault();
            const fileId = parseInt(e.dataTransfer.getData("text/plain"), 10);
            if (!isNaN(fileId) && draggedFileId === fileId) {
              const draggedFile = files.find((f) => f.id === fileId);
              if (draggedFile && draggedFile.folder !== null) {
                updateFile(fileId, { folder: null });
              }
            }
            setDraggedFileId(null);
            setDraggedFolderId(null);
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
              {rootFiles.map((f) => renderImageRow(f, false))}
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
                  setFiles(
                    files.map((f) =>
                      selectedIds.has(f.id) ? { ...f, eye: false } : f,
                    ),
                  );
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              >
                HIDE
              </button>
              <button
                onClick={() => {
                  setFiles(files.filter((f) => !selectedIds.has(f.id)));
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
            {folders.length} SLOT &middot; {assigned.length} FILES
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

    const handleStrengthChange = (e: React.MouseEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      updateFile(f.id, {
        strength: Math.max(
          0,
          Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)),
        ),
      });
    };

    const modeHelp = (mode: string) => {
      const msgs: Record<string, string> = {
        SUBJECT: "use as the main person, product, object, or wardrobe",
        STAGE: "use as the scene, set, props, lighting, or layout",
        STYLE: "use only the look, not content",
        MOOD: "use as mood board inspiration for palette, atmosphere, materials, and taste",
        COMP: "legacy stage/layout role",
        ALL: "apply as a full visual brief source",
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
            {folder ? folder.name : "ROOT"} &rsaquo;{" "}
            <b>{f.label || "UNLABELED"}</b>
          </span>
          <div className="cmp-inspector-menu-wrap">
            <button
              className={`cmp-dot ${inspectorMenuOpen ? "open" : ""}`}
              onClick={() => setInspectorMenuOpen(!inspectorMenuOpen)}
            >
              &#8943;
            </button>
            {inspectorMenuOpen && (
              <div className="cmp-menu cmp-inspector-menu">
                <div className="cmp-menu-title">{f.label || "UNLABELED"}</div>
                <button
                  className="primary"
                  onClick={() => {
                    openStudio({ uuid: f.uuid, imgUrl: f.url });
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
                <button
                  className="danger"
                  onClick={() => {
                    setInspectorMenuOpen(false);
                    removeFile(f.id);
                  }}
                >
                  REMOVE
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="cmp-detail-body">
          <div className="cmp-detail-section">
            <h4>CANVAS ROLE</h4>
            <div className="cmp-segments">
              {MODES.map((m) => (
                <button
                  key={m}
                  className={f.mode === m ? "active" : ""}
                  onClick={() => updateFile(f.id, { mode: m })}
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
              <span></span>
              <b>{f.strength}%</b>
            </div>
            <div className="cmp-strength" onClick={handleStrengthChange}>
              <i style={{ width: `${f.strength}%` }}></i>
              <span style={{ left: "25%" }}></span>
              <span style={{ left: "50%" }}></span>
              <span style={{ left: "75%" }}></span>
            </div>
            <div className="cmp-scale">
              <span>SUBTLE</span>
              <span>STANDARD</span>
              <span>FORCEFUL</span>
            </div>
          </div>

          <div className="cmp-detail-section">
            <h4>STATE</h4>
            <button
              className={`cmp-toggle ${f.eye ? "on" : ""}`}
              onClick={() => updateFile(f.id, { eye: !f.eye })}
            >
              <span>VISIBLE</span>
              <b>{f.eye ? "ON" : "OFF"}</b>
            </button>
          </div>

          <div className="cmp-image-card-stack">
            <div
              className="cmp-big-thumb"
              title="Open in Studio"
              onClick={() => openStudio({ uuid: f.uuid, imgUrl: f.url })}
            >
              {renderThumb(f)}
              <span>{f.dims}</span>
              <b className={`mode-${f.mode}`}>{f.mode}</b>
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
        <div className="cmp-status">
          <button onClick={() => setShowInfo(!showInfo)}>
            INFO {showInfo ? "\u25b2" : "\u25bc"}
          </button>
          <span>
            {f.strength}% &middot; {f.mode}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="right-sidebar">
      <div className={`mod-panel-wrap ${collapsed ? "collapsed" : ""}`}>
        <div className="module-panel" ref={panelRef}>
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
