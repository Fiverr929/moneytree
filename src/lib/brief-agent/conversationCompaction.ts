import type { AgentMessage } from "./types";

export const ACTIVE_MESSAGE_LIMIT = 18;
export const RECENT_MESSAGE_COUNT = 8;
const SUMMARY_LIMIT = 1_800;

function compactLine(value: string, limit = 280) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

export function compactConversationMessages(messages: AgentMessage[]) {
  const archived = messages.slice(0, -RECENT_MESSAGE_COUNT);
  const recent = messages.slice(-RECENT_MESSAGE_COUNT);
  const lines = archived.flatMap((message) => {
    if (message.role === "system" && message.text.startsWith("COMPACTED CONTEXT")) return [];
    const speaker = message.role === "user" ? "USER" : message.role === "agent" ? "AGENT" : "SYSTEM";
    const text = compactLine(message.text);
    const prompt = message.promptArtifact?.prompt ? compactLine(message.promptArtifact.prompt, 420) : "";
    return [...(text ? [`${speaker}: ${text}`] : []), ...(prompt ? [`DRAFT: ${prompt}`] : [])];
  });
  const selected: string[] = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (length + line.length + 1 > SUMMARY_LIMIT) continue;
    selected.unshift(line);
    length += line.length + 1;
  }
  return { archived, recent, summary: selected.join("\n") };
}
