import { useState, useMemo, useEffect, useRef } from "react";
import type { Part } from "@opencode-ai/sdk/v2";
import type { ToolPart } from "@opencode-ai/sdk/v2";
import { ToolCallCard } from "./ToolCallCard";
import { ToolRevealOnMount } from "./ToolRevealOnMount";
import {
  BashRenderer,
  EditRenderer,
  GrepRenderer,
  GlobRenderer,
  ReadRenderer,
  WebSearchRenderer,
} from "./ToolRenderers";
import { DiffViewer } from "./DiffViewer";
import styles from "./TaskEventStream.module.css";

interface ToolCallGroupProps {
  parts: Part[];
}

function getToolPreview(toolPart: ToolPart): string {
  const input = toolPart.state?.input as Record<string, unknown> | undefined;
  if (!input) return "";
  try {
    if (toolPart.tool === "edit" || toolPart.tool === "apply_patch") {
      const path = (input.path as string) || (input.file_path as string) || "";
      return path;
    }
    if (toolPart.tool === "bash" || toolPart.tool === "shell") {
      const cmd = (input.command as string) || "";
      return cmd.slice(0, 50) + (cmd.length > 50 ? "..." : "");
    }
    if (toolPart.tool === "read") return (input.path as string) || "";
    if (toolPart.tool === "grep") return (input.pattern as string) || "";
    if (toolPart.tool === "glob") return (input.pattern as string) || "";
    if (toolPart.tool === "todo") return "todo";
    if (toolPart.tool === "web_search" || toolPart.tool === "websearch") return (input.query as string) || "";
  } catch { /* ignore */ }
  return "";
}

function getToolMetadataPatch(metadata?: Record<string, unknown>): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const patch = (metadata as { patch?: unknown }).patch;
  if (typeof patch === "string" && patch.trim().length > 0) return patch.trim();
  const diff = (metadata as { diff?: unknown }).diff;
  if (typeof diff === "string" && diff.trim().length > 0) return diff.trim();
  return undefined;
}

function useGroupElapsed(parts: Part[]): string {
  const [now, setNow] = useState(() => Date.now());

  const isAnyRunning = parts.some((p) => (p as ToolPart).state?.status === "running");

  useEffect(() => {
    if (!isAnyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [isAnyRunning]);

  const starts: number[] = [];
  const ends: number[] = [];

  for (const p of parts) {
    const state = (p as ToolPart).state;
    if (!state || state.status === "pending") continue;
    starts.push(state.time.start);
    if (state.status === "completed" || state.status === "error") {
      ends.push(state.time.end);
    }
  }

  if (starts.length === 0) return "";

  const earliest = Math.min(...starts);
  const finish = isAnyRunning ? now : (ends.length ? Math.max(...ends) : now);
  const ms = finish - earliest;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function ToolEntry({ part }: { part: ToolPart }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggle = () => setIsExpanded((v) => !v);
  const name = part.tool.toLowerCase();

  const state = part.state as { output?: string; metadata?: Record<string, unknown>; input?: Record<string, unknown> } | null;
  const output = state?.output || "";
  const hasDiff = output.includes("@@") || output.includes("diff ") || output.includes("Index:") ||
    getToolMetadataPatch(state?.metadata);

  if (name === "bash" || name === "shell" || name === "terminal")
    return <BashRenderer part={part} isExpanded={isExpanded} onToggle={toggle} />;
  if (name === "edit" || name === "apply_patch" || name === "multiedit" || name === "write") {
    if (hasDiff) {
      const input = (state?.input as Record<string, unknown> | undefined);
      const filePath = (input?.path as string) || (input?.file_path as string) || "";
      const diffText = getToolMetadataPatch(state?.metadata) || output;
      return <DiffViewer diffText={diffText} filePath={filePath} />;
    }
    return <EditRenderer part={part} isExpanded={isExpanded} onToggle={toggle} />;
  }
  if (name === "grep")
    return <GrepRenderer part={part} isExpanded={isExpanded} onToggle={toggle} />;
  if (name === "glob")
    return <GlobRenderer part={part} isExpanded={isExpanded} onToggle={toggle} />;
  if (name === "read")
    return <ReadRenderer part={part} isExpanded={isExpanded} onToggle={toggle} />;
  if (name === "web_search" || name === "websearch")
    return <WebSearchRenderer part={part} isExpanded={isExpanded} onToggle={toggle} />;

  return <ToolCallCard part={part} defaultExpanded={false} />;
}

export function ToolCallGroup({ parts }: ToolCallGroupProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const elapsed = useGroupElapsed(parts);
  const seenToolIdsRef = useRef<Set<string>>(new Set());

  const toolNames = useMemo(
    () => parts.map((p) => (p as ToolPart).tool ?? "unknown"),
    [parts],
  );

  const uniqueToolNames = useMemo(() => [...new Set(toolNames)], [toolNames]);

  const previewText = useMemo(() => {
    const previews = parts.map((p) => getToolPreview(p as ToolPart)).filter(Boolean);
    return previews.slice(0, 3).join(", ") + (previews.length > 3 ? ` (+${previews.length - 3} more)` : "");
  }, [parts]);

  const toolCount = parts.length;

  const statuses = useMemo(() => {
    const s = { pending: 0, running: 0, completed: 0, error: 0 };
    parts.forEach((p) => {
      const status = (p as ToolPart).state?.status;
      if (status === "pending") s.pending++;
      else if (status === "running") s.running++;
      else if (status === "completed") s.completed++;
      else if (status === "error") s.error++;
    });
    return s;
  }, [parts]);

  const statusLabel =
    statuses.running > 0 ? "running" :
    statuses.pending > 0 ? "pending" :
    statuses.error > 0 ? "error" : "done";

  const statusClass =
    statuses.running > 0 ? styles.toolStatusRunning :
    statuses.error > 0 ? styles.toolStatusError :
    statuses.completed === toolCount ? styles.toolStatusCompleted :
    styles.toolStatusPending;

  return (
    <div className={styles.toolGroupCard}>
      <div className={styles.toolGroupHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <span className={`${styles.toolCallIcon} ${isExpanded ? styles.toolCallIconExpanded : ""}`}>
          {isExpanded ? "▼" : "▶"}
        </span>
        <span className={styles.toolGroupLabel}>
          {toolCount} tool{toolCount !== 1 ? "s" : ""}
        </span>
        <span className={styles.toolGroupNames}>{uniqueToolNames.join(", ")}</span>
        {!isExpanded && previewText && (
          <span className={styles.toolGroupPreview}>{previewText}</span>
        )}
        {elapsed && <span className={styles.toolElapsed}>{elapsed}</span>}
        <span className={`${styles.toolStatus} ${statusClass}`}>{statusLabel}</span>
      </div>

      {isExpanded && (
        <div className={styles.toolGroupBody}>
          {parts.map((part, idx) => {
            const id = (part as ToolPart).id ?? `tool-${idx}`;
            const isNew = !seenToolIdsRef.current.has(id);
            seenToolIdsRef.current.add(id);
            return (
              <ToolRevealOnMount key={id} animate={isNew}>
                <ToolEntry part={part as ToolPart} />
              </ToolRevealOnMount>
            );
          })}
        </div>
      )}
    </div>
  );
}