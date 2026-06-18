"use client";

import React, { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import DB from "@/lib/db";

type ProjectListItem = {
  id: number;
  name?: string;
  thumbnail?: string;
  date_modified: string;
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
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState("New Project");

  const loadProjects = () => {
    setLoading(true);
    DB.projects.getAll().then((data) => {
      // sort by date modified desc
      data.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
      setProjects(data);
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

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this project forever?")) return;

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

  if (!projectsOpen) return null;

  return (
    <div id="projects-modal" className={projectsOpen ? "open" : ""} onClick={(e) => { if (e.target === e.currentTarget) setProjectsOpen(false); }}>
      <div className="pm-panel">
        <div className="pm-header">
          <span className="pm-title">Projects</span>
          <button className="pm-close" onClick={() => setProjectsOpen(false)}>&#215;</button>
        </div>
        
        <div className="pm-list">
          {loading ? (
            <div className="pm-empty">Loading...</div>
          ) : projects.length === 0 ? (
            <div className="pm-empty">No saved projects</div>
          ) : (
            projects.map(p => (
              <div key={p.id} className={`pm-item ${p.id === activeProjectId ? 'active' : ''}`} onClick={() => { setActiveProjectId(p.id); setProjectsOpen(false); }}>
                <div className="pm-thumb">
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="thumb" />
                  ) : (
                    <svg className="pm-thumb-icon" width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="1" y="1" width="18" height="18" rx="1" stroke="#e8e6e6" strokeWidth="1.2"/><path d="M1 14l5-5 4 4 3-4 6 6" stroke="#e8e6e6" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <div className="pm-info">
                  <div className="pm-name">{p.name || 'Project'}<span className="pm-ext">.cafe</span></div>
                  <div className="pm-meta">{(p.date_modified || '').slice(0, 10)}</div>
                </div>
                <button className="pm-delete" onClick={(e) => handleDelete(p.id, e)}>&#215;</button>
              </div>
            ))
          )}
        </div>

        <div className="pm-footer">
          {projectCreateOpen ? (
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
          ) : (
            <>
              <button className="pm-foot-btn" onClick={openCreate}>New</button>
              <span className="pm-foot-divider">&middot;</span>
              <button className="pm-foot-btn" onClick={() => console.info("Export not implemented")}>Export</button>
              <span className="pm-foot-divider">&middot;</span>
              <button className="pm-foot-btn" onClick={() => console.info("Import not implemented")}>Import</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
