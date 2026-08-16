"use client";

import { usePathname } from "next/navigation";
import { AppProvider } from "@/context/AppContext";
import { ModuleProvider } from "@/context/ModuleContext";
import { GalleryProvider } from "@/context/GalleryContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { StudioProvider } from "@/context/StudioContext";
import Studio from "@/components/Studio";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") return children;

  return (
    <AppProvider>
      <SettingsProvider>
        <GalleryProvider>
          <ModuleProvider>
            <StudioProvider>
              {children}
              <Studio />
            </StudioProvider>
          </ModuleProvider>
        </GalleryProvider>
      </SettingsProvider>
    </AppProvider>
  );
}
