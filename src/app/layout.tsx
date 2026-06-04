import type { Metadata } from "next";
import { AppProvider } from "@/context/AppContext";
import { ModuleProvider } from "@/context/ModuleContext";
import { GalleryProvider } from "@/context/GalleryContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { StudioProvider } from "@/context/StudioContext";
import "./globals.css";
import Studio from "@/components/Studio";

export const metadata: Metadata = {
  title: "MoneyTree",
  description: "MoneyTree AI Image Generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
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
      </body>
    </html>
  );
}

