"use client";

import React, { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import DB from "@/lib/db";
import { useGallery } from "@/context/GalleryContext";
import { exportGenerationEvaluations } from "@/lib/evaluationExport";

type ProjectListItem = {
  id: number;
  name?: string;
  thumbnail?: string;
  date_modified: string;
  deletedAt?: string | null;
  purgeAfter?: string | null;
};

export default function ProjectsModal() {
  const {
    projectsOpen,
    setProjectsOpen,
    projectCreateOpen,
    setProjectCreateOpen,
    activeProjectId,
    setActiveProjectId,
  } = useApp();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<ProjectListItem[]>([]);
  const [section, setSection] = useState<"active" | "trash">("active");
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState("New Project");
  const [exportStatus, setExportStatus] = useState("");
  const [exporting, setExporting] = useState(false);
  const { cells } = useGallery();

  const loadProjects = () => {
    setLoading(true);
    Promise.all([DB.projects.getAll(), DB.projects.getTrash()]).then(([active, trash]) => {
      active.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
      trash.sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")));
      setProjects(active);
      setTrashedProjects(trash);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (projectsOpen) {
      loadProjects();
    }
  }, [projectsOpen]);

  // Handle Escape
  useEffect(() => {
    if (!projectsOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProjectsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [projectsOpen, setProjectsOpen]);

  const handleCreate = () => {
    const name = newProjectName.trim() || "New Project";
    DB.projects.create({ name }).then((newId) => {
      loadProjects();
      setActiveProjectId(newId as number);
      setProjectCreateOpen(false);
      setNewProjectName("New Project");
      setProjectsOpen(false);
    });
  };

  const openCreate = () => {
    setNewProjectName("New Project");
    setProjectCreateOpen(true);
  };

  const handleExportEvaluations = async () => {
    if (!activeProjectId || exporting) return;
    setExporting(true);
    setExportStatus("");
    try {
      const project = await DB.projects.get(activeProjectId) as ProjectListItem | undefined;
      const result = await exportGenerationEvaluations(cells, {
        id: activeProjectId,
        name: project?.name || "Project",
      });
      setExportStatus(`${result.count} records saved`);
    } catch (error) {
      console.error("Failed to export evaluations", error);
      setExportStatus(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Move this project to Trash? It can be restored for 30 days.")) return;

    try {
      await DB.projects.delete(id);
      if (id === activeProjectId) {
        const data = await DB.projects.getAll();
        if (data.length > 0) {
          data.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
          setActiveProjectId(data[0].id);
        } else {
          const newId = await DB.projects.create({ name: "Project 1" });
          setActiveProjectId(newId as number);
        }
      }
      loadProjects();
    } catch (error) {
      console.error("Failed to delete project", error);
    }
  };

  const handleRestore = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await DB.projects.restore(id);
    await loadProjects();
  };

  const handleDeletePermanently = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Permanently delete this project and all of its images, chat, and project memory? This cannot be undone.")) return;
    await DB.projects.deletePermanently(id);
    await loadProjects();
  };

  if (!projectsOpen) return null;

  return (
    <div id="projects-modal" className={projectsOpen ? "open" : ""} onClick={(e) => { if (e.target === e.currentTarget) setProjectsOpen(false); }}>
      <div className="pm-panel">
        <div className="pm-header">
          <span className="pm-title">Projects</span>
          <button className="pm-close" onClick={() => setProjectsOpen(false)}>&#215;</button>
        </div>
        <div className="pm-sections" role="tablist" aria-label="Project sections">
          <button type="button" role="tab" aria-selected={section === "active"} className={section === "active" ? "active" : ""} onClick={() => setSection("active")}>ACTIVE <span>{projects.length}</span></button>
          <button type="button" role="tab" aria-selected={section === "trash"} className={section === "trash" ? "active" : ""} onClick={() => setSection("trash")}>TRASH <span>{trashedProjects.length}</span></button>
        </div>
        
        <div className="pm-list">
          {loading ? (
            <div className="pm-empty">Loading...</div>
          ) : (section === "active" ? projects : trashedProjects).length === 0 ? (
            <div className="pm-empty">{section === "active" ? "No saved projects" : "Trash is empty"}</div>
          ) : (
            (section === "active" ? projects : trashedProjects).map(p => (
              <div key={p.id} className={`pm-item ${section === "active" && p.id === activeProjectId ? 'active' : ''}`} onClick={() => { if (section === "active") { setActiveProjectId(p.id); setProjectsOpen(false); } }}>
                <div className="pm-thumb">
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="thumb" />
                  ) : (
                    <svg className="pm-thumb-icon" width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="1" y="1" width="18" height="18" rx="1" stroke="#e8e6e6" strokeWidth="1.2"/><path d="M1 14l5-5 4 4 3-4 6 6" stroke="#e8e6e6" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <div className="pm-info">
                  <div className="pm-name">{p.name || 'Project'}<span className="pm-ext">.cafe</span></div>
                  <div className="pm-meta">{section === "trash" ? `PURGES ${String(p.purgeAfter || "").slice(0, 10)}` : (p.date_modified || '').slice(0, 10)}</div>
                </div>
                {section === "active" ? (
                  <button className="pm-delete" aria-label={`Move ${p.name || "project"} to Trash`} onClick={(e) => handleDelete(p.id, e)}>&#215;</button>
                ) : (
                  <div className="pm-trash-actions">
                    <button type="button" onClick={(e) => void handleRestore(p.id, e)}>RESTORE</button>
                    <button type="button" onClick={(e) => void handleDeletePermanently(p.id, e)}>DELETE</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="pm-footer">
          {section === "active" && projectCreateOpen ? (
            <form className="pm-create-form" onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
              <input
                className="pm-create-input"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                autoFocus
                aria-label="Project name"
              />
              <button className="pm-foot-btn" type="submit">Create</button>
              <button className="pm-foot-btn" type="button" onClick={() => setProjectCreateOpen(false)}>Cancel</button>
            </form>
          ) : section === "active" ? (
            <>
              <button className="pm-foot-btn" onClick={openCreate}>New</button>
              <span className="pm-foot-divider">&middot;</span>
              <button className="pm-foot-btn" disabled={exporting} onClick={handleExportEvaluations}>{exporting ? "Exporting" : "Export evaluations"}</button>
              <span className="pm-foot-divider">&middot;</span>
              <button className="pm-foot-btn" onClick={() => console.info("Import not implemented")}>Import</button>
              {exportStatus && <span className="pm-export-status" title={exportStatus}>{exportStatus}</span>}
            </>
          ) : <span className="pm-export-status">Projects in Trash are excluded from generation and memory.</span>}
        </div>
      </div>
    </div>
  );
}
