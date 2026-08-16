import type { GalleryCell } from "@/context/GalleryContext";

export type ProjectInfo = { id: number; name?: string };

export type EvaluationRecord = {
  schemaVersion: 1;
  generationId: number;
  uuid: string | null;
  project: { id: number; name: string };
  createdAt: string | null;
  pipelineVersion: string;
  model: { label: string | null; id: string | null };
  userPrompt: string;
  effectivePrompt: string;
  references: Array<{
    uuid: string | null;
    role: string | null;
    label: string | null;
    strength: number | null;
    strengthBand: string | null;
  }>;
  settings: GalleryCell["generationSettings"] | null;
  result: { ratio: string; dimensions: string | null };
  evaluation: GalleryCell["evaluation"] | null;
  generationTimeMs: number | null;
};

export type EvaluationExportResult = {
  count: number;
  latestJsonl: string;
  latestReport: string;
  historyJsonl: string;
  historyReport: string;
};

function toRecord(cell: GalleryCell, project: ProjectInfo): EvaluationRecord {
  return {
    schemaVersion: 1,
    generationId: cell.id,
    uuid: cell.uuid || null,
    project: { id: project.id, name: project.name || "Project" },
    createdAt: cell.createdAt || cell.date || null,
    pipelineVersion: cell.pipelineVersion || "legacy-unversioned",
    model: { label: cell.model || null, id: cell.modelId || null },
    userPrompt: cell.userPrompt || "",
    effectivePrompt: cell.effectivePrompt || cell.prompt || "",
    references: (cell.usedImages || []).map((image) => ({
      uuid: image.uuid || null,
      role: image.role || null,
      label: image.label || null,
      strength: typeof image.strength === "number" ? image.strength : null,
      strengthBand: image.strengthBand || null,
    })),
    settings: cell.generationSettings || null,
    result: { ratio: cell.ratio, dimensions: cell.dims || null },
    evaluation: cell.evaluation || null,
    generationTimeMs: typeof cell.generationTimeMs === "number" ? cell.generationTimeMs : null,
  };
}

function average(records: EvaluationRecord[], key: "promptMatch" | "subjectMatch" | "sceneMatch" | "styleMatch" | "qualityMatch") {
  const values: number[] = records.flatMap((record) => {
    const value = record.evaluation?.[key];
    return typeof value === "number" ? [value] : [];
  });
  if (!values.length) return "-";
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2);
}

function averageSpeed(records: EvaluationRecord[]) {
  const values: number[] = records.flatMap((record) => {
    const value = record.generationTimeMs;
    return typeof value === "number" ? [value] : [];
  });
  if (!values.length) return "-";
  const avgMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${(avgMs / 1000).toFixed(2)}s`;
}

export function buildEvaluationReport(records: EvaluationRecord[], project: ProjectInfo, exportedAt = new Date().toISOString()) {
  const rated = records.filter((record) => record.evaluation);
  const versions = [...new Set(records.map((record) => record.pipelineVersion))];
  const lines = [
    `# Generation Evaluation Report`,
    ``,
    `Project: ${project.name || "Project"}`,
    `Exported: ${exportedAt}`,
    `Generations: ${records.length}`,
    `Rated: ${rated.length}`,
    `Unrated: ${records.length - rated.length}`,
    `Average Speed: ${averageSpeed(records)}`,
    ``,
    `## Overall Scores`,
    ``,
    `| Dimension | Average |`,
    `| --- | ---: |`,
    `| Prompt match | ${average(rated, "promptMatch")} |`,
    `| Subject match | ${average(rated, "subjectMatch")} |`,
    `| Scene match | ${average(rated, "sceneMatch")} |`,
    `| Style match | ${average(rated, "styleMatch")} |`,
    `| Visual quality | ${average(rated, "qualityMatch")} |`,
  ];

  versions.forEach((version) => {
    const versionRecords = records.filter((record) => record.pipelineVersion === version);
    const versionRated = versionRecords.filter((record) => record.evaluation);
    lines.push(
      ``,
      `## ${version}`,
      ``,
      `Generations: ${versionRecords.length} | Rated: ${versionRated.length} | Avg Speed: ${averageSpeed(versionRecords)}`,
      ``,
      `Prompt ${average(versionRated, "promptMatch")} | Subject ${average(versionRated, "subjectMatch")} | Scene ${average(versionRated, "sceneMatch")} | Style ${average(versionRated, "styleMatch")} | Quality ${average(versionRated, "qualityMatch")}`,
    );
    versionRated.filter((record) => record.evaluation?.comment).forEach((record) => {
      lines.push(``, `- ${record.createdAt || "Unknown date"}: ${record.evaluation!.comment}`);
    });
  });

  lines.push(``, `## Data`, ``, `The accompanying JSONL file is the authoritative machine-readable dataset.`);
  return lines.join("\n");
}

export function collectGenerationEvaluations(cells: GalleryCell[], project: ProjectInfo) {
  return cells
    .filter((cell) => cell.origin === "generation" && cell.imgUrl && !cell.loadingId && !cell.blocked && !cell.error && cell.evaluation)
    .map((cell) => toRecord(cell, project));
}

export async function exportGenerationEvaluations(cells: GalleryCell[], project: ProjectInfo) {
  const records = collectGenerationEvaluations(cells, project);
  const response = await fetch("/api/evaluations/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, records }),
  });
  const result = await response.json() as EvaluationExportResult & { error?: string };
  if (!response.ok) throw new Error(result.error || "Evaluation export failed.");
  return result;
}
