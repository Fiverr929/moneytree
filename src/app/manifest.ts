import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CafeHTML — AI Image & Video Workspace",
    short_name: "CafeHTML",
    description:
      "A modular AI image and video workspace for composing references, collaborating with an AI agent, and generating creative media.",
    start_url: "/",
    display: "standalone",
    background_color: "#999997",
    theme_color: "#f25822",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
