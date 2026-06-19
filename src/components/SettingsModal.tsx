"use client";

import React, { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useSettings } from "@/context/SettingsContext";

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useApp();
  const { googleApiKey, setGoogleApiKey } = useSettings();

  const [apiKeyInput, setApiKeyInput] = useState("");

  const handleSaveKey = () => {
    setGoogleApiKey(apiKeyInput.trim());
    setApiKeyInput("");
    const btn = document.querySelector('.csm-google-save');
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
            
            {/* API Page */}
            <div className="csm-page active">
              <div className="csm-section">
                <div className="csm-section-label">Vertex AI API Key</div>
                <div className="csm-key-row">
                  <input 
                    type="password" 
                    className="csm-google-input" 
                    placeholder={googleApiKey ? '****************' : 'Enter Vertex AI API key...'} 
                    autoComplete="new-password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                  <button type="button" className="csm-google-save" onClick={handleSaveKey}>Save</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
