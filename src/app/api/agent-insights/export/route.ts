import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isAgentInsight, type AgentInsight } from "@/lib/brief-agent/insightPolicy";

export const runtime = "nodejs";

let exportQueue = Promise.resolve();

function buildReport(insights: AgentInsight[]) {
  const lines = [
    "# CafeHTML Agent Insight Inbox",
    "",
    "Machine-generated candidates. Diagnoses are inferences until reproduced and confirmed.",
    "",
  ];
  insights.forEach((insight) => {
    lines.push(
      `## [${insight.status.toUpperCase()}] ${insight.title}`,
      "",
      `- Type: ${insight.type}`,
      `- Project: ${insight.projectId}`,
      `- Created: ${insight.createdAt}`,
      `- Generations: ${insight.source.generationIds.join(", ") || "None captured"}`,
      `- Reference fingerprint: ${insight.referenceFingerprint || "None captured"}`,
      `- Expected: ${insight.expected}`,
      `- Observed: ${insight.observed}`,
      `- Acceptance test: ${insight.acceptanceTest}`,
      ...(insight.diagnosis ? [`- Inferred diagnosis (${insight.diagnosis.confidence.toFixed(2)}): ${insight.diagnosis.text}`] : []),
      "",
    );
  });
  return lines.join("\n");
}

async function exportInsight(insight: AgentInsight) {
  const exportRoot = path.join(process.cwd(), "evaluation-exports", "agent-insights");
  const jsonlPath = path.join(exportRoot, "latest.jsonl");
  const reportPath = path.join(exportRoot, "latest-report.md");
  await fs.mkdir(exportRoot, { recursive: true });
  let existing: AgentInsight[] = [];
  try {
    const jsonl = await fs.readFile(jsonlPath, "utf8");
    existing = jsonl.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return isAgentInsight(value) ? [value] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const byId = new Map(existing.map((item) => [item.id, item]));
  byId.set(insight.id, insight);
  const insights = Array.from(byId.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  await fs.writeFile(jsonlPath, `${insights.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  await fs.writeFile(reportPath, buildReport(insights), "utf8");
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Local insight export is disabled in production." }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as { insight?: unknown } | null;
  if (!isAgentInsight(body?.insight)) {
    return NextResponse.json({ error: "Invalid agent insight." }, { status: 400 });
  }
  const insight = body.insight;
  exportQueue = exportQueue.catch(() => undefined).then(() => exportInsight(insight));
  await exportQueue;
  return NextResponse.json({ ok: true });
}
