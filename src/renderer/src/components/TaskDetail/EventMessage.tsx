import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { Part, ToolPart } from "@opencode-ai/sdk/v2";
import type { MessageDisplay } from "./TaskEventStream";
import { StreamingText } from "./StreamingText";
import { StreamingReasoning } from "./StreamingReasoning";
import { ToolCallGroup } from "./ToolCallGroup";
import { WorkingPlaceholder } from "./WorkingPlaceholder";
import { SubtaskPart } from "./SubtaskPart";
import { ShellActionPart } from "./ShellActionPart";
import { DiffViewer, formatDuration } from "./DiffViewer";
import styles from "./TaskEventStream.module.css";

interface EventMessageProps {
  message: MessageDisplay;
  suppressQuestionJson?: boolean;
  showBusyDots?: boolean;
  responseDurationMs?: number | null;
  agentMode?: "plan" | "execute";
  agentModel?: string;
  runningToolText?: string | null;
  isNew?: boolean;
  isLastInTurn?: boolean;
}

interface QuestionOption { label: string; description?: string }
interface QuestionInfo { header?: string; question: string; multiple?: boolean; options: QuestionOption[] }
interface QuestionPayload { questions: QuestionInfo[] }

function parseQuestionJson(text: string): QuestionPayload | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as QuestionPayload;
    if (Array.isArray(parsed.questions)) return parsed;
  } catch { /* not JSON */ }
  return null;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isStreaming(part: Part): boolean {
  if (part.type !== "text" && part.type !== "reasoning") return false;
  if (!part.time?.start) return false;
  return !part.time.end;
}

function isSubtaskPart(part: Part): boolean {
  return part.type === "subtask" || (part as { type?: string }).type === "subtask";
}

function isShellActionPart(part: Part): boolean {
  const p = part as { type?: string; shellAction?: unknown };
  return p.type === "text" && typeof p.shellAction === "object" && p.shellAction !== null;
}

function getSubtaskInfo(part: Part) {
  const p = part as {
    description?: string;
    command?: string;
    agent?: string;
    prompt?: string;
    taskSessionID?: string;
    model?: { providerID?: string; modelID?: string };
  };
  return {
    description: p.description as string | undefined,
    command: p.command as string | undefined,
    agent: p.agent as string | undefined,
    prompt: p.prompt as string | undefined,
    taskSessionID: p.taskSessionID as string | undefined,
    model: p.model,
  };
}

function getShellActionInfo(part: Part) {
  const p = part as {
    shellAction?: {
      command?: string;
      output?: string;
      status?: string;
    };
  };
  return {
    command: p.shellAction?.command as string | undefined,
    output: p.shellAction?.output as string | undefined,
    status: p.shellAction?.status as string | undefined,
  };
}

function getToolMetadataPatch(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;

  const patch = (metadata as { patch?: unknown }).patch;
  if (typeof patch === "string" && patch.trim().length > 0) return patch.trim();

  const diff = (metadata as { diff?: unknown }).diff;
  if (typeof diff === "string" && diff.trim().length > 0) return diff.trim();

  return undefined;
}

export function EventMessage({
  message,
  suppressQuestionJson,
  showBusyDots,
  agentMode,
  agentModel,
  runningToolText,
  isNew,
}: EventMessageProps): React.JSX.Element {
  const isAssistant = message.role === "assistant";
  const roleClass = isAssistant ? styles.messageAssistant : styles.messageUser;

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopyMessage = useCallback(async () => {
    const textContent = message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text?: string }).text || "")
      .join("\n");

    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    await navigator.clipboard.writeText(textContent);
    setCopied(true);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [message.parts]);

  const groupedParts = useMemo(() => {
    const result: Array<{ type: "single"; part: Part; index: number } | { type: "toolGroup"; parts: Part[]; startIndex: number }> = [];
    let i = 0;
    while (i < message.parts.length) {
      const part = message.parts[i];
      if (part.type === "tool") {
        const toolParts: Part[] = [];
        let j = i;
        while (j < message.parts.length && message.parts[j].type === "tool") {
          toolParts.push(message.parts[j]);
          j++;
        }
        result.push({ type: "toolGroup", parts: toolParts, startIndex: i });
        i = j;
      } else {
        result.push({ type: "single", part, index: i });
        i++;
      }
    }
    return result;
  }, [message.parts]);

  const messageTime = useMemo(() => {
    const lastPart = message.parts[message.parts.length - 1];
    if (!lastPart) return null;
    const part = lastPart as { time?: { start?: number; end?: number } };
    if (part.time?.start) {
      return {
        start: part.time.start,
        end: part.time.end,
      };
    }
    return null;
  }, [message.parts]);

  const partsContent = (
    <div className={styles.parts}>
      {groupedParts.map((group) => {
        if (group.type === "single") {
          const { part, index } = group;

          if (isSubtaskPart(part)) {
            const info = getSubtaskInfo(part);
            return <SubtaskPart key={part.id ?? `subtask-${index}`} {...info} />;
          }

          if (isShellActionPart(part)) {
            const info = getShellActionInfo(part);
            return (
              <ShellActionPart
                key={part.id ?? `shell-${index}`}
                command={info.command || ""}
                output={info.output}
                status={info.status}
              />
            );
          }

          switch (part.type) {
            case "text": {
              const qPayload = parseQuestionJson((part as { text?: string }).text || "");
              if (qPayload) {
                if (suppressQuestionJson) return null;
                return (
                  <div key={part.id ?? `q-${index}`} className={styles.historicalQuestionCard}>
                    {qPayload.questions.map((q, i) => (
                      <div key={i} className={styles.questionBlock}>
                        {q.header && <div className={styles.questionHeader}>{q.header}</div>}
                        <div className={styles.questionText}>{q.question}</div>
                      </div>
                    ))}
                  </div>
                );
              }
              const text = (part as { text?: string }).text || "";
              if (!text.trim()) return null;
              return (
                <StreamingText
                  key={part.id ?? `text-${index}`}
                  text={text}
                  isStreaming={isStreaming(part)}
                  partId={part.id ?? `text-${index}`}
                />
              );
            }
            case "reasoning":
              // Show reasoning if streaming OR has start time OR has text (not fully filtered out)
              if (!isStreaming(part) && !part.text?.trim() && !part.time?.start) return null;
              return (
                <StreamingReasoning
                  key={part.id ?? `reasoning-${index}`}
                  text={part.text || ""}
                  isStreaming={isStreaming(part)}
                  startTime={part.time?.start}
                />
              );
            case "tool": {
              const toolPart = part as ToolPart;
              if (toolPart.tool === "edit" || toolPart.tool === "apply_patch" || toolPart.tool === "multiedit" || toolPart.tool === "write") {
                const state = toolPart.state as { output?: string; metadata?: Record<string, unknown>; input?: Record<string, unknown> } | null;
                const output = state?.output || "";
                const patch = getToolMetadataPatch(state?.metadata) || output;

                if (patch.includes("@@") || patch.includes("diff ") || patch.includes("Index:")) {
                  const input = state?.input as Record<string, unknown> | undefined;
                  const filePath = (input?.path as string) || (input?.file_path as string) || "";
                  return <DiffViewer key={part.id ?? `diff-${index}`} diffText={patch} filePath={filePath} />;
                }
              }
              return <ToolCallGroup key={`tool-${index}`} parts={[part]} />;
            }
            default:
              return null;
          }
        } else {
          return <ToolCallGroup key={`toolgroup-${group.startIndex}`} parts={group.parts} />;
        }
      })}
    </div>
  );

  if (isAssistant) {
    const timeDisplay = messageTime?.end ? formatDuration(messageTime.end - messageTime.start) : null;
    const timestamp = messageTime?.start ? formatTime(messageTime.start) : null;

    return (
      <div className={`${styles.message} ${roleClass} ${isNew ? styles.messageNew : ""}`}>
        <div className={styles.messageHeader}>
          <span className={styles.messageHeaderIcon}>&#x25C6;</span>
          <span className={styles.messageRole}>
            agent
            {agentModel && <span className={styles.modelName}>{agentModel}</span>}
          </span>
          {agentMode && (
            <span className={`${styles.modeBadge} ${agentMode === "plan" ? styles.modeBadgePlan : styles.modeBadgeBuild}`}>
              {agentMode === "plan" ? "plan" : "build"}
            </span>
          )}
          {showBusyDots && <WorkingPlaceholder isWorking statusText={runningToolText ?? null} />}
          {timeDisplay && <span className={styles.responseDuration}>{timeDisplay}</span>}
          {timestamp && <span className={styles.messageTimestamp}>{timestamp}</span>}
          <button className={styles.messageActionBtn} onClick={handleCopyMessage}>
            {copied ? "copied" : "copy"}
          </button>
        </div>
        {partsContent}
      </div>
    );
  }

  return (
    <div className={`${styles.message} ${roleClass} ${isNew ? styles.messageNew : ""}`}>
      <div className={styles.messageUserHeader}>
        <span className={styles.messageRole}>you</span>
        {messageTime?.start && <span className={styles.messageTimestamp}>{formatTime(messageTime.start)}</span>}
        <button className={styles.messageActionBtn} onClick={handleCopyMessage}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div className={styles.userBubble}>{partsContent}</div>
    </div>
  );
}