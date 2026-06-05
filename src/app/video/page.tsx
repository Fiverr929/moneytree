"use client";

import React from "react";
import TitleBar from "@/components/TitleBar";

export default function VideoPage() {
  return (
    <>
      <TitleBar />
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100vw",
        color: "#1e1e1e",
        fontSize: "24px",
        fontFamily: "'Times New Roman', serif",
        textTransform: "uppercase",
        letterSpacing: "0.08em"
      }}>
        Video Page
      </div>
    </>
  );
}
