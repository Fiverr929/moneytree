"use client";

import React, { useState } from "react";
import TitleBar from "@/components/TitleBar";
import ProjectsModal from "@/components/ProjectsModal";
import SettingsModal from "@/components/SettingsModal";

const SHOT_SLOTS = ["01", "02", "03", "04"];

export default function VideoPage() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("8S");
  const [ratio, setRatio] = useState("16:9");
  const [activeSlot, setActiveSlot] = useState(0);

  return (
    <>
      <TitleBar />
      <main className="video-page">
        <section className="video-stage">
          <div className="video-preview">
            <div className="video-frame-grid">
              <div className="video-frame-line vertical"></div>
              <div className="video-frame-line horizontal"></div>
            </div>
            <div className="video-playhead">
              <span></span>
            </div>
          </div>

          <div className="video-sequence">
            {SHOT_SLOTS.map((slot, index) => (
              <button
                key={slot}
                className={`video-shot ${activeSlot === index ? "active" : ""}`}
                type="button"
                onClick={() => setActiveSlot(index)}
              >
                <span>{slot}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="video-control-panel">
          <div className="video-panel-title">SCENE {SHOT_SLOTS[activeSlot]}</div>

          <div className="video-control-group">
            <div className="video-control-label">DURATION</div>
            <div className="video-segmented">
              {["4S", "8S", "12S"].map((value) => (
                <button
                  key={value}
                  className={duration === value ? "active" : ""}
                  type="button"
                  onClick={() => setDuration(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="video-control-group">
            <div className="video-control-label">FORMAT</div>
            <div className="video-segmented">
              {["16:9", "9:16", "1:1"].map((value) => (
                <button
                  key={value}
                  className={ratio === value ? "active" : ""}
                  type="button"
                  onClick={() => setRatio(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="video-prompt-bar" data-state="SCENE">
          <button className="video-upload-ref" type="button" title="Add video reference"></button>
          <button className="video-settings-btn" type="button" title="Video settings">
            <img src="/assets/icon-settings.svg" alt="settings" />
          </button>
          <div className="video-prompt-input-area">
            <input
              className="video-prompt-text-field"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What are we making today?"
            />
            <button className="video-frame-btn" type="button" disabled={!prompt.trim()}>
              VIDEO
            </button>
          </div>
        </div>
      </main>
      <ProjectsModal />
      <SettingsModal />
    </>
  );
}
