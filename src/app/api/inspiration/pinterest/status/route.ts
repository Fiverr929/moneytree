import { NextResponse } from "next/server";
import { INSPIRATION_PROVIDERS, pinterestConfiguration } from "@/lib/inspiration/providers";

export const runtime = "nodejs";

export async function GET() {
  const configuration = pinterestConfiguration(process.env);
  return NextResponse.json({
    provider: INSPIRATION_PROVIDERS.pinterest,
    configured: configuration.configured,
    missing: configuration.missing,
    status: configuration.configured ? "ready-for-oauth-implementation" : "configuration-required",
  });
}
