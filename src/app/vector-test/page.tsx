"use client";

import React, { useMemo, useRef, useState } from "react";
import ImageTracer from "imagetracerjs";
import { loadImage, readFileAsDataUrl } from "@/lib/mask-test/canvasAlpha";

type TraceMode = "black" | "white";

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function thresholdImageToImageData(imageUrl: string, mode: TraceMode, threshold: number) {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const brightness = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
    const selected = mode === "black" ? brightness < threshold : brightness > threshold;
    const value = selected ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  return imageData;
}

export default function VectorTestPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputUrl, setInputUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<TraceMode>("black");
  const [threshold, setThreshold] = useState(160);
  const [turdSize, setTurdSize] = useState(2);
  const [svg, setSvg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const svgUrl = useMemo(() => svg ? svgToDataUrl(svg) : "", [svg]);
  const canRun = !!inputUrl && !busy;

  async function handleFile(file: File) {
    setError("");
    setSvg("");
    setFileName(file.name);
    setInputUrl(await readFileAsDataUrl(file));
  }

  async function runTrace() {
    if (!inputUrl) return;
    setBusy(true);
    setError("");
    setSvg("");

    try {
      const imageData = await thresholdImageToImageData(inputUrl, mode, threshold);
      const tracedSvg = ImageTracer.imagedataToSVG(imageData, {
        colorsampling: 0,
        numberofcolors: 2,
        colorquantcycles: 1,
        pathomit: turdSize,
        ltres: 1,
        qtres: 1,
        rightangleenhance: true,
        linefilter: false,
        scale: 1,
        roundcoords: 1,
        viewbox: true,
        strokewidth: 0,
        pal: [
          { r: 17, g: 17, b: 17, a: 255 },
          { r: 255, g: 255, b: 255, a: 0 },
        ],
      });
      setSvg(tracedSvg);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="vector-test-page">
      <section className="vector-test-workspace">
        <div className="vector-test-pane">
          <div className="vector-test-pane-head">
            <span>INPUT</span>
            <button type="button" onClick={() => inputRef.current?.click()}>UPLOAD</button>
          </div>

          <button
            type="button"
            className={`vector-test-drop ${inputUrl ? "has-image" : ""}`}
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
          <div className="vector-test-meta">{fileName || "No image selected"}</div>
        </div>

        <div className="vector-test-pane">
          <div className="vector-test-pane-head">
            <span>SVG</span>
            {svgUrl && <a href={svgUrl} download="vector-test.svg">DOWNLOAD</a>}
          </div>

          <div className="vector-test-output">
            {busy && <div className="vector-test-loading">TRACING</div>}
            {!busy && svgUrl && <img src={svgUrl} alt="Traced SVG" />}
            {!busy && !svgUrl && <span>VECTOR APPEARS HERE</span>}
          </div>
          <div className="vector-test-meta">{svg ? `${Math.round(svg.length / 1024)} KB SVG` : "No vector yet"}</div>
        </div>
      </section>

      <form
        className="vector-test-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void runTrace();
        }}
      >
        <div className="vector-test-segmented">
          <button type="button" className={mode === "black" ? "active" : ""} onClick={() => setMode("black")}>BLACK</button>
          <button type="button" className={mode === "white" ? "active" : ""} onClick={() => setMode("white")}>WHITE</button>
        </div>
        <label>
          <span>THRESH</span>
          <input type="range" min="0" max="255" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
          <b>{threshold}</b>
        </label>
        <label>
          <span>SPECK</span>
          <input type="range" min="0" max="20" value={turdSize} onChange={(event) => setTurdSize(Number(event.target.value))} />
          <b>{turdSize}</b>
        </label>
        <button type="submit" disabled={!canRun}>{busy ? "RUNNING" : "TRACE"}</button>
      </form>

      {error && <div className="vector-test-error">{error}</div>}
    </main>
  );
}
