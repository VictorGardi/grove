import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";

let cachedClient: { url: string; client: OpencodeClient } | null = null;

export function getClient(serverUrl: string): OpencodeClient {
  if (!cachedClient || cachedClient.url !== serverUrl) {
    cachedClient = {
      url: serverUrl,
      client: createOpencodeClient({ baseUrl: serverUrl }),
    };
  }
  return cachedClient.client;
}
