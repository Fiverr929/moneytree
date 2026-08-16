import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const fixturePath = path.join(root, "src", "lib", "brief-agent", "evaluations", "cases.v1.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const baseUrl = (process.env.CAFEHTML_EVAL_URL || "http://localhost:3001").replace(/\/$/, "");

function makeSnapshot(testCase) {
  return {
    id: `eval-${testCase.id}`,
    createdAt: new Date().toISOString(),
    sourceFingerprint: `eval:${testCase.id}`,
    observations: testCase.references.map((reference) => ({
      ...reference,
      readSource: "vision"
    }))
  };
}

function scoreTurn(testCase, response) {
  const draft = response.draft;
  const prompt = String(draft.finalPrompt || "").toLowerCase();
  const actionPass = draft.action === testCase.expectedAction;
  const expectedRunAction = {
    talk: "answer",
    inspect: "inspect",
    plan: "propose_directions",
    ask: "ask",
    draft: "draft_prompt"
  }[testCase.expectedAction];
  const latestRunAction = response.run?.steps?.at(-1)?.action?.type;
  const expectedRunStatus = testCase.expectedAction === "draft"
    ? "awaiting_approval"
    : testCase.expectedAction === "ask"
    ? "planning"
    : "ready";
  const runPass = response.run?.version === 1
    && response.run.steps.length === testCase.turns.length
    && latestRunAction === expectedRunAction
    && response.run.status === expectedRunStatus
    && response.run.generationAttempts === 0;
  const requiredTerms = testCase.requiredPromptTerms.map((term) => ({
    term,
    pass: prompt.includes(term.toLowerCase())
  }));
  const requiredAnyTerms = (testCase.requiredAnyTerms || []).map((terms) => ({
    terms,
    pass: terms.some((term) => prompt.includes(term.toLowerCase()))
  }));
  const forbiddenTerms = testCase.forbiddenPromptTerms.map((term) => ({
    term,
    pass: !prompt.includes(term.toLowerCase())
  }));
  const promptShapePass = draft.action === "draft"
    ? prompt.length > 0
    : prompt.length === 0;

  return {
    actionPass,
    runPass,
    promptShapePass,
    requiredTerms,
    requiredAnyTerms,
    forbiddenTerms,
    pass: actionPass
      && runPass
      && promptShapePass
      && requiredTerms.every((check) => check.pass)
      && requiredAnyTerms.every((check) => check.pass)
      && forbiddenTerms.every((check) => check.pass)
  };
}

async function runCase(testCase) {
  const startedAtMs = Date.now();
  const messages = [];
  let session = null;
  let run = null;
  let response = null;

  for (const text of testCase.turns) {
    messages.push({
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: new Date().toISOString()
    });
    const apiResponse = await fetch(`${baseUrl}/api/brief-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        referenceSnapshot: makeSnapshot(testCase),
        messages,
        session,
        run
      })
    });
    const data = await apiResponse.json();
    if (!apiResponse.ok) {
      throw new Error(data.error || `HTTP ${apiResponse.status}`);
    }
    response = data;
    messages.push(data.message);
    session = data.draft.session;
    run = data.run || null;
  }

  return {
    id: testCase.id,
    category: testCase.category,
    expectedAction: testCase.expectedAction,
    actualAction: response.draft.action,
    finalPrompt: response.draft.finalPrompt,
    score: scoreTurn(testCase, response),
    model: response.model,
    runId: response.run?.id || null,
    runStatus: response.run?.status || null,
    runStepCount: response.run?.steps?.length || 0,
    latencyMs: Date.now() - startedAtMs
  };
}

const startedAt = new Date().toISOString();
const results = [];
for (const testCase of fixture.cases) {
  try {
    results.push(await runCase(testCase));
  } catch (error) {
    results.push({
      id: testCase.id,
      category: testCase.category,
      expectedAction: testCase.expectedAction,
      error: error instanceof Error ? error.message : String(error),
      score: { pass: false }
    });
  }
}

const passed = results.filter((result) => result.score.pass).length;
const report = {
  fixtureVersion: fixture.version,
  startedAt,
  completedAt: new Date().toISOString(),
  baseUrl,
  summary: {
    passed,
    failed: results.length - passed,
    total: results.length,
    passRate: results.length ? passed / results.length : 0
  },
  results
};
const reportDir = path.join(root, "evaluation-exports", "brief-agent", "runs");
await mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Brief agent evaluation: ${passed}/${results.length} passed`);
console.log(reportPath);
if (passed !== results.length) process.exitCode = 1;
