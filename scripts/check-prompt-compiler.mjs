import assert from "node:assert/strict";
import { compileGenerationPrompt } from "../src/lib/brief-agent/promptCompiler.ts";

const compact = compileGenerationPrompt("  Portrait   of two models  \n\nPRESERVE both subjects\nPRESERVE both subjects ");
assert.equal(compact.prompt, "Portrait of two models\nPRESERVE both subjects");
assert.equal(compact.blocked, false);

const exact = compileGenerationPrompt("x".repeat(4_000));
assert.equal(exact.prompt.length, 4_000);
assert.equal(exact.blocked, false);

const over = compileGenerationPrompt(`${"x".repeat(4_000)}\nKEEP both subjects`);
assert.equal(over.blocked, true);
assert.equal(over.prompt, "");
assert.match(over.warnings[0], /no instructions were truncated/i);

console.log("Prompt compiler checks passed");
