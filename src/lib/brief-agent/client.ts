import type {
  BriefAgentRequest,
  BriefAgentResponse,
  BriefReferenceReadRequest,
  BriefReferenceReadResponse,
} from "./types";

export async function requestBriefAgent(input: BriefAgentRequest): Promise<BriefAgentResponse> {
  const response = await fetch("/api/brief-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Brief agent request failed.";
    throw new Error(message);
  }

  return data as BriefAgentResponse;
}

export async function requestReferenceRead(input: BriefReferenceReadRequest): Promise<BriefReferenceReadResponse> {
  const response = await fetch("/api/brief-agent/read-references", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Reference reader request failed.";
    throw new Error(message);
  }

  return data as BriefReferenceReadResponse;
}
