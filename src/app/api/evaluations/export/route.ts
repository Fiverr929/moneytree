import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  buildEvaluationReport,
  type EvaluationRecord,
  type ProjectInfo,
} from "@/lib/evaluationExport";

export const runtime = "nodejs";

const MAX_RECORDS = 10_000;
const MAX_BODY_CHARACTERS = 5_000_000;

function isProjectInfo(value: unknown): value is ProjectInfo {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  return typeof project.id === "number" && (project.name === undefined || typeof project.name === "string");
}

function isEvaluationRecord(value: unknown): value is EvaluationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.generationId === "number";
}

function historyStamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARACTERS) {
      return NextResponse.json({ error: "Evaluation export is too large." }, { status: 413 });
    }

    const body = JSON.parse(raw) as { project?: unknown; records?: unknown };
    if (!isProjectInfo(body.project) || !Array.isArray(body.records)) {
      return NextResponse.json({ error: "Invalid evaluation export payload." }, { status: 400 });
    }
    if (body.records.length > MAX_RECORDS || !body.records.every(isEvaluationRecord)) {
      return NextResponse.json({ error: "Invalid evaluation records." }, { status: 400 });
    }

    const records = body.records as EvaluationRecord[];
    const now = new Date();
    const stamp = historyStamp(now);
    const exportRoot = path.join(process.cwd(), "evaluation-exports");
    const historyRoot = path.join(exportRoot, "history");
    await mkdir(historyRoot, { recursive: true });

    const jsonl = records.map((record) => JSON.stringify(record)).join("\n");
    const report = buildEvaluationReport(records, body.project, now.toISOString());
    const files = {
      latestJsonl: path.join(exportRoot, "latest.jsonl"),
      latestReport: path.join(exportRoot, "latest-report.md"),
      historyJsonl: path.join(historyRoot, `${stamp}.jsonl`),
      historyReport: path.join(historyRoot, `${stamp}-report.md`),
    };

    await Promise.all([
      writeFile(files.latestJsonl, jsonl, "utf8"),
      writeFile(files.latestReport, report, "utf8"),
      writeFile(files.historyJsonl, jsonl, "utf8"),
      writeFile(files.historyReport, report, "utf8"),
    ]);

    return NextResponse.json({
      count: records.length,
      latestJsonl: path.relative(process.cwd(), files.latestJsonl),
      latestReport: path.relative(process.cwd(), files.latestReport),
      historyJsonl: path.relative(process.cwd(), files.historyJsonl),
      historyReport: path.relative(process.cwd(), files.historyReport),
    });
  } catch (error) {
    console.error("Evaluation export failed", error);
    return NextResponse.json({ error: "Could not write evaluation export files." }, { status: 500 });
  }
}