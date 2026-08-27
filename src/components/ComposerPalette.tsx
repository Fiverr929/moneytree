"use client";

import React from "react";

export type ComposerPaletteItem = {
  id: string;
  value: string;
  label: string;
  description: string;
  group: "COMMANDS" | "MODULE IMAGES" | "MODULE FOLDERS";
  thumbnail?: string;
  meta?: string;
};

type ComposerPaletteProps = {
  trigger: "/" | "@";
  items: ComposerPaletteItem[];
  activeIndex: number;
  onSelect: (item: ComposerPaletteItem) => void;
};

export default function ComposerPalette({ trigger, items, activeIndex, onSelect }: ComposerPaletteProps) {
  const groups = [...new Set(items.map((item) => item.group))];

  return (
    <div className={`composer-palette trigger-${trigger === "/" ? "command" : "mention"}`} role="listbox" aria-label={trigger === "/" ? "Canvas commands" : "Workspace mentions"}>
      <div className="composer-palette-head">
        <span>{trigger === "/" ? "COMMAND PALETTE" : "MENTION WORKSPACE"}</span>
        <span>{items.length} · ↑↓ SELECT · ENTER INSERT</span>
      </div>
      <div className="composer-palette-scroll">
        {groups.map((group) => (
          <div className="composer-palette-group" key={group}>
            <div className="composer-palette-group-label">{group}</div>
            {items.map((item, index) => item.group === group ? (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`composer-palette-option ${index === activeIndex ? "active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
              >
                {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" decoding="async" /> : <span className="composer-palette-glyph">{trigger}</span>}
                <span className="composer-palette-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                {item.meta && <span className="composer-palette-meta">{item.meta}</span>}
              </button>
            ) : null)}
          </div>
        ))}
      </div>
    </div>
  );
}
