export const DEFAULT_GENERATION_PROMPT_LIMIT = 4_000;

export type CompiledGenerationPrompt = {
  prompt: string;
  sourceCharacters: number;
  compiledCharacters: number;
  blocked: boolean;
  warnings: string[];
};

function normalizePrompt(value: string) {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n");
}

/**
 * Normalizes a generation prompt without discarding unique instructions.
 * If the prompt still exceeds the execution budget, generation is blocked so
 * the brief can be revised instead of silently losing its final constraints.
 */
export function compileGenerationPrompt(
  value: string,
  limit = DEFAULT_GENERATION_PROMPT_LIMIT,
): CompiledGenerationPrompt {
  const source = value.trim();
  const prompt = normalizePrompt(source);
  const blocked = prompt.length > limit;
  return {
    prompt: blocked ? "" : prompt,
    sourceCharacters: source.length,
    compiledCharacters: prompt.length,
    blocked,
    warnings: blocked
      ? [`The generation brief is ${prompt.length.toLocaleString()} characters and exceeds the ${limit.toLocaleString()}-character execution budget. Revise it before generating; no instructions were truncated.`]
      : [],
  };
}
