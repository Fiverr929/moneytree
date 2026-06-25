import { NextResponse } from "next/server";
import { createMockBriefDraft } from "@/lib/brief-agent/mockPlanner";
import type {
  AgentMessage,
  BriefAgentRequest,
  BriefAgentResponse,
  BriefReferenceSnapshot,
} from "@/lib/brief-agent/types";

export const runtime = "nodejs";

function validateMessage(value: unknown): AgentMessage {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid brief agent message.");
  }
  const message = value as Partial<AgentMessage>;
  if (typeof message.id !== "string" || typeof message.text !== "string" || typeof message.createdAt !== "string") {
    throw new Error("Invalid brief agent message.");
  }
  if (message.role !== "user" && message.role !== "agent" && message.role !== "system") {
    throw new Error("Invalid brief agent message role.");
  }
  return message as AgentMessage;
}

function validateReferenceSnapshot(value: unknown): BriefReferenceSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid reference snapshot.");
  }
  const snapshot = value as Partial<BriefReferenceSnapshot>;
  if (
    typeof snapshot.id !== "string"
    || typeof snapshot.createdAt !== "string"
    || typeof snapshot.sourceFingerprint !== "string"
    || !Array.isArray(snapshot.observations)
  ) {
    throw new Error("Invalid reference snapshot.");
  }
  return snapshot as BriefReferenceSnapshot;
}

function validateRequest(request: Request, value: unknown): BriefAgentRequest {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Brief agent requests require a same-origin browser request.");
  }
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-origin brief agent requests are not allowed.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid brief agent request.");
  }

  const input = value as Partial<BriefAgentRequest>;
  if (!Array.isArray(input.messages)) {
    throw new Error("Brief agent request requires messages.");
  }

  return {
    referenceSnapshot: validateReferenceSnapshot(input.referenceSnapshot),
    messages: input.messages.map(validateMessage),
  };
}

function formatAgentReply(draft: ReturnType<typeof createMockBriefDraft>) {
  const lines = [draft.reply];
  if (draft.clarification.needed) {
    draft.clarification.questions.forEach((question, index) => {
      lines.push(`Q${index + 1}: ${question}`);
    });
    lines.push("FINAL PROMPT: waiting for clarification.");
  } else if (draft.finalPrompt) {
    lines.push("FINAL PROMPT READY.");
  }
  return lines.join("\n");
}

export async function POST(request: Request) {
  try {
    const input = validateRequest(request, await request.json());
    const draft = createMockBriefDraft(input.referenceSnapshot, input.messages);
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text: formatAgentReply(draft),
      createdAt: new Date().toISOString(),
    };
    const response: BriefAgentResponse = { draft, message };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brief agent failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
