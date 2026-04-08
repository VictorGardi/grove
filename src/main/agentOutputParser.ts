import type { PlanChunk, ToolUseData } from "@shared/types";

interface PendingToolCall {
  name: string;
  args: Record<string, unknown>;
  startTime: number;
}

export interface GroveErrorChunk {
  type: "__grove_error";
  message: string;
}

export type ParserResult = PlanChunk[] | Array<PlanChunk | GroveErrorChunk>;

export function parseOpencodeLine(obj: Record<string, unknown>): ParserResult {
  const chunks: Array<PlanChunk | GroveErrorChunk> = [];

  if (obj.type === "step_start" && typeof obj.sessionID === "string") {
    chunks.push({ type: "session_id", content: obj.sessionID });
  }

  if (
    obj.type === "step_finish" &&
    obj.part !== null &&
    typeof obj.part === "object"
  ) {
    const part = obj.part as Record<string, unknown>;
    if (part.tokens !== null && typeof part.tokens === "object") {
      const t = part.tokens as Record<string, unknown>;
      const cache =
        t.cache !== null && typeof t.cache === "object"
          ? (t.cache as Record<string, unknown>)
          : {};
      chunks.push({
        type: "tokens",
        content: "",
        data: {
          total: typeof t.total === "number" ? t.total : 0,
          input: typeof t.input === "number" ? t.input : 0,
          output: typeof t.output === "number" ? t.output : 0,
          reasoning: typeof t.reasoning === "number" ? t.reasoning : 0,
          cache: {
            write: typeof cache.write === "number" ? cache.write : 0,
            read: typeof cache.read === "number" ? cache.read : 0,
          },
        },
      });
    }
  }

  if (
    obj.type === "text" &&
    obj.part !== null &&
    typeof obj.part === "object"
  ) {
    const part = obj.part as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string") {
      chunks.push({ type: "text", content: part.text });
    }
    if (part.type === "thinking" && typeof part.thinking === "string") {
      chunks.push({ type: "thinking", content: part.thinking });
    }
  }

  if (
    obj.type === "tool_use" &&
    obj.part !== null &&
    typeof obj.part === "object"
  ) {
    const part = obj.part as Record<string, unknown>;
    const tool = typeof part.tool === "string" ? part.tool : "unknown";
    const state =
      part.state !== null && typeof part.state === "object"
        ? (part.state as Record<string, unknown>)
        : null;

    if (state && state.status === "completed") {
      const title = typeof state.title === "string" ? state.title : "";
      const rawOutput = typeof state.output === "string" ? state.output : "";
      const MAX_OUTPUT = 5 * 1024;
      const truncated = rawOutput.length > MAX_OUTPUT;
      const output = truncated ? rawOutput.slice(0, MAX_OUTPUT) : rawOutput;

      const input =
        state.input !== null && typeof state.input === "object"
          ? (state.input as Record<string, unknown>)
          : {};

      const metadata =
        state.metadata !== null && typeof state.metadata === "object"
          ? (state.metadata as Record<string, unknown>)
          : {};
      const exitCode = typeof metadata.exit === "number" ? metadata.exit : null;

      const timeRaw =
        state.time !== null && typeof state.time === "object"
          ? (state.time as Record<string, unknown>)
          : null;
      const time =
        timeRaw &&
        typeof timeRaw.start === "number" &&
        typeof timeRaw.end === "number"
          ? { start: timeRaw.start, end: timeRaw.end }
          : null;

      const data: ToolUseData = {
        tool,
        input,
        output,
        truncated,
        title,
        exitCode,
        time,
      };
      chunks.push({ type: "tool_use", content: title, data });
    }
  }

  if (
    obj.type === "error" &&
    obj.error !== null &&
    typeof obj.error === "object"
  ) {
    const err = obj.error as Record<string, unknown>;
    let msg = typeof err.name === "string" ? err.name : "Error";
    if (err.data !== null && typeof err.data === "object") {
      const data = err.data as Record<string, unknown>;
      if (typeof data.message === "string") {
        msg = data.message.replace(/^"|"$/g, "").trim();
      }
    }
    chunks.push({ type: "__grove_error", message: msg });
  }

  return chunks;
}

export function parseCopilotLine(obj: Record<string, unknown>): PlanChunk[] {
  return new CopilotLineParser().parse(obj);
}

/**
 * Stateful Copilot JSON-stream parser.
 *
 * A single instance should be created per agent run so that
 * tool.execution_start / tool.execution_complete pairs can be correlated
 * by toolCallId to produce tool_use chunks with name + output combined.
 */
export class CopilotLineParser {
  private pendingTools = new Map<string, PendingToolCall>();

  parse(obj: Record<string, unknown>): PlanChunk[] {
    const chunks: PlanChunk[] = [];

    // Legacy / simple event types
    if (obj.type === "session_id" && typeof obj.id === "string") {
      chunks.push({ type: "session_id", content: obj.id });
    }
    if (
      obj.type === "message" &&
      obj.role === "assistant" &&
      typeof obj.content === "string" &&
      obj.content
    ) {
      chunks.push({ type: "text", content: obj.content });
    }
    if (
      obj.type === "delta" &&
      typeof obj.content === "string" &&
      obj.content
    ) {
      chunks.push({ type: "text", content: obj.content });
    }

    if (
      obj.data !== null &&
      typeof obj.data === "object"
    ) {
      const data = obj.data as Record<string, unknown>;

      // Streaming text delta
      if (obj.type === "assistant.message_delta") {
        if (typeof data.deltaContent === "string" && data.deltaContent) {
          chunks.push({ type: "text", content: data.deltaContent });
        }
      }

      // Streaming reasoning/thinking delta
      if (obj.type === "assistant.reasoning_delta") {
        if (typeof data.deltaContent === "string" && data.deltaContent) {
          chunks.push({ type: "thinking", content: data.deltaContent });
        }
      }

      // Tool execution start — store name/args for later correlation
      if (obj.type === "tool.execution_start") {
        const toolCallId =
          typeof data.toolCallId === "string" ? data.toolCallId : null;
        if (toolCallId) {
          const name =
            typeof data.toolName === "string" ? data.toolName : "unknown";
          const args =
            data.arguments !== null && typeof data.arguments === "object"
              ? (data.arguments as Record<string, unknown>)
              : {};
          this.pendingTools.set(toolCallId, {
            name,
            args,
            startTime: Date.now(),
          });
        }
      }

      // Tool execution complete — emit a tool_use chunk
      if (obj.type === "tool.execution_complete") {
        const toolCallId =
          typeof data.toolCallId === "string" ? data.toolCallId : null;
        const pending = toolCallId
          ? this.pendingTools.get(toolCallId)
          : undefined;
        if (toolCallId && pending) {
          this.pendingTools.delete(toolCallId);
        }

        const result =
          data.result !== null && typeof data.result === "object"
            ? (data.result as Record<string, unknown>)
            : {};
        const rawOutput =
          typeof result.content === "string" ? result.content : "";
        const MAX_OUTPUT = 5 * 1024;
        const truncated = rawOutput.length > MAX_OUTPUT;
        const output = truncated ? rawOutput.slice(0, MAX_OUTPUT) : rawOutput;
        const success =
          typeof data.success === "boolean" ? data.success : true;

        const toolName = pending?.name ?? "unknown";
        const toolData: ToolUseData = {
          tool: toolName,
          input: pending?.args ?? {},
          output,
          truncated,
          title: toolName,
          exitCode: success ? 0 : 1,
          time: null,
        };
        chunks.push({ type: "tool_use", content: toolName, data: toolData });
      }
    }

    return chunks;
  }
}
