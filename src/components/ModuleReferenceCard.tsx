"use client";

import React from "react";

export type ModuleReferenceImage = {
  uuid: string;
  url: string;
  visible?: boolean;
};

type ModuleReferenceCardProps = {
  action: string;
  name: string;
  images: ModuleReferenceImage[];
  actionOptions: string[];
  isActionOpen: boolean;
  isEditingName: boolean;
  editingName: string;
  onToggleAction: () => void;
  onSelectAction: (action: string) => void;
  onStartNameEdit: () => void;
  onEditingNameChange: (name: string) => void;
  onCommitName: () => void;
  onToggleImageVisibility: (imageIndex: number) => void;
  onRemoveImage: (imageIndex: number) => void;
  onReplaceImage: (imageIndex: number) => void;
  onOpenImage?: (imageIndex: number) => void;
};

export default function ModuleReferenceCard({
  action,
  name,
  images,
  actionOptions,
  isActionOpen,
  isEditingName,
  editingName,
  onToggleAction,
  onSelectAction,
  onStartNameEdit,
  onEditingNameChange,
  onCommitName,
  onToggleImageVisibility,
  onRemoveImage,
  onReplaceImage,
  onOpenImage,
}: ModuleReferenceCardProps) {
  return (
    <div className={`mrc-card ${isActionOpen ? "is-action-open" : ""} ${isEditingName ? "is-name-open" : ""}`}>
      <div className="mrc-head">
        <button
          type="button"
          className="mrc-role"
          onClick={(e) => {
            e.stopPropagation();
            onToggleAction();
          }}
        >
          {action}
        </button>
        <button
          type="button"
          className="mrc-name"
          onClick={(e) => {
            e.stopPropagation();
            onStartNameEdit();
          }}
        >
          {name}
        </button>
      </div>

      {isActionOpen && (
        <div className="mrc-role-menu">
          {actionOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`mrc-role-option ${option === action ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAction(option);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {isEditingName && (
        <div className="mrc-name-editor">
          <input
            autoFocus
            className="mrc-name-input"
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onBlur={onCommitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
        </div>
      )}

      <div className="mrc-images">
        {images.map((img, imageIndex) => {
          const hidden = img.visible === false;
          return (
            <div key={img.uuid} className={`mrc-image ${hidden ? "is-hidden" : ""}`}>
              <button
                type="button"
                className="mrc-remove"
                title="Remove image"
                aria-label="Remove image"
                onClick={() => onRemoveImage(imageIndex)}
              >
                <img src="assets/icon-trash.svg" alt="" />
              </button>
              <button
                type="button"
                className={`mrc-toggle ${hidden ? "off" : ""}`}
                title={hidden ? "Include reference" : "Hide reference"}
                aria-label={hidden ? "Include reference" : "Hide reference"}
                onClick={() => onToggleImageVisibility(imageIndex)}
              >
                <img
                  src={hidden ? "assets/icon-eye-off.svg" : "assets/icon-eye-on.svg"}
                  alt=""
                />
              </button>
              <button
                type="button"
                className="mrc-replace"
                title="Replace reference"
                aria-label="Replace reference"
                onClick={() => onReplaceImage(imageIndex)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3l-3.35 3.35Z" />
                </svg>
              </button>
              <button
                type="button"
                className="mrc-main"
                onClick={() => onOpenImage?.(imageIndex)}
              >
                <img src={img.url} alt="image" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
