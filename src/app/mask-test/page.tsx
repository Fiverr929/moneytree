"use client";

import React, { useMemo, useRef, useState } from "react";
import { useSettings } from "@/context/SettingsContext";
import { applyMask, readFileAsDataUrl, type MaskResult } from "@/lib/mask-test/canvasAlpha";
import { parseBgCommand, parseColorCommand, removeEdgeBackground, removeGlobalColor } from "@/lib/mask-test/localBg";
import { requestGeminiMask } from "@/lib/mask-test/maskGemini";

function parseMaskInstruction(instruction: string) {
  return instruction.trim().replace(/^\/mask\s*/i, "");
}

export default function MaskTestPage() {
  const { googleApiKey, activeModel } = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputUrl, setInputUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<MaskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showMask, setShowMask] = useState(false);
  const [invert, setInvert] = useState(false);

  const canRun = useMemo(
    () => !!inputUrl && !!instruction.trim() && !!googleApiKey.trim() && !busy,
    [busy, googleApiKey, inputUrl, instruction],
  );

  async function handleFile(file: File) {
    setError("");
    setResult(null);
    setFileName(file.name);
    setInputUrl(await readFileAsDataUrl(file));
  }

  async function generateResult(nextInvert = invert) {
    if (!inputUrl || !googleApiKey.trim()) return null;

    const colorCommand = parseColorCommand(instruction);
    if (colorCommand) {
      return removeGlobalColor(inputUrl, nextInvert, colorCommand);
    }

    const bgCommand = parseBgCommand(instruction);
    if (bgCommand) {
      return removeEdgeBackground(inputUrl, nextInvert, bgCommand);
    }
    const maskInstruction = parseMaskInstruction(instruction);

    const maskUrl = await requestGeminiMask({
      apiKey: googleApiKey.trim(),
      modelId: activeModel.id,
      imageUrl: inputUrl,
      instruction: maskInstruction,
    });
    return applyMask(inputUrl, maskUrl, nextInvert);
  }

  async function runMask() {
    setBusy(true);
    setError("");
    setResult(null);

    try {
      setResult(await generateResult());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reapplyMask(nextInvert = invert) {
    if (!inputUrl || !result?.rawMaskUrl) return;

    try {
      const colorCommand = parseColorCommand(instruction);
      const bgCommand = parseBgCommand(instruction);
      if (result.source === "color" && colorCommand) {
        setResult(await removeGlobalColor(inputUrl, nextInvert, colorCommand));
      } else if (result.source === "local-bg" && bgCommand) {
        setResult(await removeEdgeBackground(inputUrl, nextInvert, bgCommand));
      } else {
        setResult(await applyMask(inputUrl, result.rawMaskUrl, nextInvert));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mask-test-page">
      <section className="mask-test-workspace">
        <div className="mask-test-pane">
          <div className="mask-test-pane-head">
            <span>INPUT</span>
            <button type="button" onClick={() => inputRef.current?.click()}>UPLOAD</button>
          </div>

          <button
            type="button"
            className={`mask-test-drop ${inputUrl ? "has-image" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files?.[0];
              if (file?.type.startsWith("image/")) void handleFile(file);
            }}
          >
            {inputUrl ? <img src={inputUrl} alt="Uploaded source" /> : <span>DROP IMAGE</span>}
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <div className="mask-test-meta">{fileName || "No image selected"}</div>
        </div>

        <div className="mask-test-pane result">
          <div className="mask-test-pane-head">
            <span>{showMask ? "MASK" : "OUTPUT"}</span>
            <div className="mask-test-actions">
              {result && (
                <button type="button" onClick={() => setShowMask((val) => !val)}>
                  {showMask ? "OUTPUT" : "MASK"}
                </button>
              )}
              {result && (
                <a href={result.outputUrl} download="mask-test-output.png">DOWNLOAD</a>
              )}
            </div>
          </div>

          <div className="mask-test-output">
            {busy && <div className="mask-test-loading">GENERATING MASK</div>}
            {!busy && result && <img src={showMask ? result.rawMaskUrl : result.previewUrl} alt={showMask ? "Generated mask" : "Transparent output preview"} />}
            {!busy && !result && <span>RESULT APPEARS HERE</span>}
          </div>

          <div className="mask-test-meta">{result?.sourceLabel || "No result yet"}</div>
          <label className="mask-test-toggle">
            <input
              type="checkbox"
              checked={invert}
              onChange={(event) => {
                const nextInvert = event.target.checked;
                setInvert(nextInvert);
                if (result?.rawMaskUrl) {
                  void reapplyMask(nextInvert);
                }
              }}
            />
            <span>Invert mask</span>
          </label>
        </div>
      </section>

      <form
        className="mask-test-prompt"
        onSubmit={(event) => {
          event.preventDefault();
          void runMask();
        }}
      >
        <input
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="/bg auto, /color white max, or /mask..."
        />
        <button type="submit" disabled={!canRun}>{busy ? "RUNNING" : "RUN"}</button>
      </form>

      {!googleApiKey.trim() && <div className="mask-test-error">Add a Google API key in settings first.</div>}
      {error && <div className="mask-test-error">{error}</div>}
    </main>
  );
}
