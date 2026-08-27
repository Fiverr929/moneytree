export type InspirationProviderId = "pinterest";

export type InspirationProvider = {
  id: InspirationProviderId;
  label: string;
  importModes: Array<"account-boards" | "pin-link">;
  requiredScopes: string[];
  provenanceFields: string[];
};

export const INSPIRATION_PROVIDERS: Record<InspirationProviderId, InspirationProvider> = {
  pinterest: {
    id: "pinterest",
    label: "PINTEREST",
    importModes: ["account-boards", "pin-link"],
    requiredScopes: ["boards:read", "pins:read"],
    provenanceFields: ["provider", "sourceUrl", "pinId", "boardId", "creator", "importedAt", "contentFingerprint"],
  },
};

export type InspirationImportRecord = {
  provider: InspirationProviderId;
  sourceUrl: string;
  pinId?: string;
  boardId?: string;
  creator?: string;
  importedAt: string;
  contentFingerprint: string;
  projectId: number;
  briefId: string;
};

export function pinterestConfiguration(environment: Record<string, string | undefined>) {
  const clientId = environment.PINTEREST_CLIENT_ID?.trim() || "";
  const clientSecret = environment.PINTEREST_CLIENT_SECRET?.trim() || "";
  const redirectUri = environment.PINTEREST_REDIRECT_URI?.trim() || "";
  return {
    configured: Boolean(clientId && clientSecret && redirectUri),
    missing: [
      !clientId ? "PINTEREST_CLIENT_ID" : "",
      !clientSecret ? "PINTEREST_CLIENT_SECRET" : "",
      !redirectUri ? "PINTEREST_REDIRECT_URI" : "",
    ].filter(Boolean),
  };
}
