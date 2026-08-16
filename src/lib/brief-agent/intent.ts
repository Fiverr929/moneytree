import type { BriefSessionState } from "./types";

const CASUAL_MESSAGE = /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|test|hellow)[\s?.!]*$/i;
const RESULT_OR_STATUS_MESSAGE = /\b(did(?:n['’]?t| not) work|does(?:n['’]?t| not) work|failed|failure|blocked|error|did(?:n['’]?t| not) happen|nothing happened|no image|where is|what happened)\b/i;
const PREFERENCE_COMMENT = /^(i\s+)?(like|love|hate|prefer|think|feel|don['’]?t like|do not like)\b/i;
const CREATIVE_ACTION = /\b(create|make|generate|draft|compose|design|illustrate|visualize|render|shoot|photograph|turn|change|replace|remove|add|use|style|edit|transform|upscale|rework|revise)\b/i;
const CREATIVE_SUBJECT = /\b(image|frame|shot|photo|photograph|portrait|product|scene|background|lighting|camera|angle|pose|render|illustration|poster|cover|logo|character|landscape|interior|exterior|campaign|car|vehicle|person|man|woman|girl|boy|animal|cat|dog|building|house|room|forest|beach|city|mountain|robot|creature|fashion|food|watch|shoe|bottle|chair|pavilion|spaceship)\b/i;
const AGENT_OR_UI_QUESTION = /^(what|how|why|when|where|who|do|are|is|does)\b.*\b(agent|chat|prompts?|references?|modules?|ui|buttons?|settings?|status|working|work)\b/i;

export function isClearlyNonCreativeMessage(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized || CASUAL_MESSAGE.test(normalized)) return true;
  if ((RESULT_OR_STATUS_MESSAGE.test(normalized) || PREFERENCE_COMMENT.test(normalized)) && !CREATIVE_ACTION.test(normalized)) {
    return true;
  }
  return AGENT_OR_UI_QUESTION.test(normalized);
}

export function isCreativeBrief(text: string) {
  const normalized = text.trim();
  if (!normalized || isClearlyNonCreativeMessage(normalized)) return false;

  // Creative requests are often phrased as questions ("Can you make..."). Check
  // their actual action before considering the sentence shape.
  if (CREATIVE_ACTION.test(normalized)) return true;
  if (/\?$/.test(normalized)) return false;

  // Prompt-box input is commonly a noun phrase rather than a command, e.g.
  // "a red sports car under neon rain" or "editorial portrait, hard flash".
  return CREATIVE_SUBJECT.test(normalized);
}

export function isCreativeFollowUp(text: string, session: BriefSessionState) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const hasTarget = !!session.selectedDirection || !!session.lastDraftPrompt || session.directions.length > 0;
  if (!hasTarget) return false;
  return /^(do|use|choose|pick|go with|continue|run|draft|generate)\b.*\b(option\s*\d+|that|this|it|one|direction|draft)\b/i.test(normalized)
    || /^option\s*\d+$/i.test(normalized)
    || /^(yes|ok|okay|cool),?\s*(do|use|draft|generate|continue)\b/i.test(normalized)
    || /^(make|change|adjust|refine|improve|add|remove|keep|try)\b/i.test(normalized)
    || /^(use|apply)\b.*\b(feedback|review|liked|disliked|preference)\b/i.test(normalized);
}

export function shouldProduceDraft(text: string, session: BriefSessionState) {
  return isCreativeBrief(text) || isCreativeFollowUp(text, session);
}
