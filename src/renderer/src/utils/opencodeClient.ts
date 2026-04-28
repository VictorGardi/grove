import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export type OpencodeSdkClient = ReturnType<typeof createOpencodeClient>;

export function createClient(serverUrl: string): OpencodeSdkClient {
  return createOpencodeClient({ baseUrl: serverUrl });
}

/**
 * Parse a model string of the form "providerID/modelID" into its parts.
 * Returns undefined if the string is empty or has no slash.
 */
export function parseModel(
  model: string,
): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const idx = model.indexOf("/");
  if (idx === -1) return undefined;
  return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
}

/**
 * Extract the sessionID from any SDK Event object.
 * Different event types put it in different places.
 */
export function getEventSessionId(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const e = event as Record<string, unknown>;
  const props = e.properties as Record<string, unknown> | undefined;
  if (!props) return undefined;
  // session.status, session.idle, permission.asked
  if (typeof props.sessionID === "string") return props.sessionID;
  // message.part.updated → properties.part.sessionID
  const part = props.part as Record<string, unknown> | undefined;
  if (typeof part?.sessionID === "string") return part.sessionID;
  // message.updated → properties.info.sessionID
  const info = props.info as Record<string, unknown> | undefined;
  if (typeof info?.sessionID === "string") return info.sessionID;
  return undefined;
}
