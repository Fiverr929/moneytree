import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL("https://cafehtml.net"),
  title: {
    default: "CafeHTML — AI Image & Video Workspace",
    template: "%s | CafeHTML",
  },
  description:
    "CafeHTML is a modular AI image and video workspace for composing subject, scene, and style references, collaborating with an AI agent, and generating creative media.",
  applicationName: "CafeHTML",
  authors: [{ name: "CafeHTML", url: "https://cafehtml.net" }],
  creator: "CafeHTML",
  publisher: "CafeHTML",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CafeHTML",
    title: "CafeHTML — AI Image & Video Workspace",
    description:
      "Compose visual references, collaborate with an AI agent, and generate images and video in one modular creative workspace.",
  },
  twitter: {
    card: "summary_large_image",
    title: "CafeHTML — AI Image & Video Workspace",
    description:
      "Compose visual references, collaborate with an AI agent, and generate images and video in one modular creative workspace.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

