import type {
  AgentDecisionAnswer,
  AgentDecisionFlow,
  AgentDecisionQuestion,
} from "./types";

const NUMBER_PREFIX = /^\s*(?:option\s*)?(?:\d+|[a-z])[.)\-:]\s*/i;

export function cleanDecisionLabel(value: string) {
  return value.replace(NUMBER_PREFIX, "").trim();
}

function comparable(value: string) {
  return cleanDecisionLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cleanReplyForDirections(reply: string, directions: string[]) {
  if (!directions.length) return reply.trim();
  const normalizedDirections = directions.map(comparable).filter(Boolean);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutInlineDirections = directions.reduce((text, direction) => {
    const raw = direction.trim();
    const cleaned = cleanDecisionLabel(raw);
    return [raw, cleaned]
      .filter(Boolean)
      .reduce((current, candidate) => current.replace(new RegExp(`\\s*${escape(candidate)}`, "gi"), ""), text);
  }, reply);
  return withoutInlineDirections
    .split(/\r?\n/)
    .filter((line) => {
      const normalizedLine = comparable(line);
      return !normalizedDirections.some((direction) => (
        normalizedLine === direction
        || normalizedLine.startsWith(`${direction} `)
        || direction.startsWith(`${normalizedLine} `)
      ));
    })
    .join("\n")
    .replace(/(?:^|\s)(?:\d+[.)]\s*){2,}/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function activeDecisionQuestions(flow: AgentDecisionFlow, answers: AgentDecisionAnswer[]) {
  const selected = new Map(answers.map((answer) => [answer.questionId, answer]));
  return flow.questions.filter((question) => {
    if (!question.dependsOnQuestionId) return true;
    const parent = selected.get(question.dependsOnQuestionId);
    if (!parent) return false;
    return !question.dependsOnOptionId || parent.optionId === question.dependsOnOptionId;
  });
}

export function updateDecisionAnswer(
  flow: AgentDecisionFlow,
  answers: AgentDecisionAnswer[],
  next: AgentDecisionAnswer,
) {
  const replaced = [...answers.filter((answer) => answer.questionId !== next.questionId), next];
  const activeIds = new Set(activeDecisionQuestions(flow, replaced).map((question) => question.id));
  return replaced.filter((answer) => activeIds.has(answer.questionId));
}

export function decisionAnswersText(flow: AgentDecisionFlow, answers: AgentDecisionAnswer[]) {
  const byId = new Map(flow.questions.map((question) => [question.id, question]));
  return [
    "Decision answers:",
    ...answers.map((answer) => `- ${byId.get(answer.questionId)?.prompt || answer.questionId}: ${answer.value}`),
    `Requested next step: ${flow.submitIntent}.`,
  ].join("\n");
}

export function createDirectionFlow(input: {
  id: string;
  sourceFingerprint: string;
  directions: string[];
}): AgentDecisionFlow | undefined {
  const directions = input.directions.map(cleanDecisionLabel).filter(Boolean).slice(0, 4);
  if (!directions.length) return undefined;
  return {
    id: input.id,
    title: "Choose a direction",
    sourceFingerprint: input.sourceFingerprint,
    submitIntent: "reply",
    questions: [{
      id: "direction",
      prompt: "Which creative direction should we develop?",
      options: directions.map((label, index) => ({ id: `direction-${index + 1}`, label })),
      allowCustom: true,
    }],
    status: "active",
  };
}

export function createClarificationFlow(input: {
  id: string;
  sourceFingerprint: string;
  submitIntent?: AgentDecisionFlow["submitIntent"];
  questions: Array<Pick<AgentDecisionQuestion, "prompt" | "options" | "allowCustom"> & Partial<Pick<AgentDecisionQuestion, "id" | "dependsOnQuestionId" | "dependsOnOptionId">>>;
}): AgentDecisionFlow | undefined {
  const questions = input.questions.slice(0, 3).map((question, index) => ({
    ...question,
    id: question.id || `question-${index + 1}`,
    prompt: question.prompt.trim(),
    options: question.options.map((option) => ({ ...option, label: cleanDecisionLabel(option.label) })).filter((option) => option.label),
    allowCustom: question.allowCustom !== false,
  })).filter((question) => question.prompt);
  if (!questions.length) return undefined;
  return {
    id: input.id,
    title: questions.length === 1 ? "One detail" : "A few details",
    sourceFingerprint: input.sourceFingerprint,
    submitIntent: input.submitIntent || "reply",
    questions,
    status: "active",
  };
}
