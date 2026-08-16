"use client";

import React, { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useSettings } from "@/context/SettingsContext";

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useApp();
  const { geminiApiKey, setGeminiApiKey } = useSettings();
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");

  const handleSaveGeminiKey = () => {
    setGeminiApiKey(geminiApiKeyInput.trim());
    setGeminiApiKeyInput("");
    const btn = document.querySelector('.csm-gemini-save');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Saved';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    }
  };

  if (!settingsOpen) return null;

  return (
    <div id="cafe-settings-modal" className={settingsOpen ? "open" : ""} onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div className="csm-panel">
        <div className="csm-header">
          <span className="csm-title">Settings</span>
          <button className="csm-close" onClick={() => setSettingsOpen(false)}>&#215;</button>
        </div>

        <div className="csm-inner">
          <div className="csm-nav">
            <button className="csm-nav-btn active">API</button>
          </div>

          <div className="csm-body">
            <div className="csm-page active">
              <div className="csm-section">
                <div className="csm-section-label">Gemini (AI Studio) API Key</div>
                <div className="csm-key-row">
                  <input
                    type="password"
                    className="csm-google-input"
                    placeholder={geminiApiKey ? '****************' : 'Enter Gemini API key...'}
                    autoComplete="new-password"
                    value={geminiApiKeyInput}
                    onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                  />
                  <button type="button" className="csm-google-save csm-gemini-save" onClick={handleSaveGeminiKey}>Save</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
