import type { Part } from "@opencode-ai/sdk/v2";
import type { MessageDisplay } from "./TaskEventStream";
import { StreamingText } from "./StreamingText";
import { ToolCallCard } from "./ToolCallCard";
import styles from "./TaskEventStream.module.css";

interface EventMessageProps {
  message: MessageDisplay;
  suppressQuestionJson?: boolean;
}

function isQuestionJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray((parsed as { questions?: unknown }).questions);
  } catch {
    return false;
  }
}

function isStreaming(part: Part): boolean {
  if (part.type !== "text") return false;
  return !part.time?.end;
}

export function EventMessage({ message, suppressQuestionJson }: EventMessageProps): React.JSX.Element {
  const roleClass =
    message.role === "assistant" ? styles.messageAssistant : styles.messageUser;

  return (
    <div className={`${styles.message} ${roleClass}`}>
      <span className={styles.messageRole}>{message.role}</span>
      <div className={styles.parts}>
        {message.parts.map((part, index) => {
          switch (part.type) {
            case "text":
              if (suppressQuestionJson && isQuestionJson(part.text)) return null;
              return (
                <StreamingText
                  key={part.id ?? `text-${index}`}
                  text={part.text}
                  isStreaming={isStreaming(part)}
                />
              );
            case "tool":
              return <ToolCallCard key={part.id ?? `tool-${index}`} part={part} />;
            case "reasoning":
              return (
                <div
                  key={part.id ?? `reasoning-${index}`}
                  className={styles.reasoningPart}
                >
                  <details>
                    <summary className={styles.reasoningSummary}>Reasoning</summary>
                    <div className={styles.reasoningText}>{part.text}</div>
                  </details>
                </div>
              );
            case "step-start":
              return (
                <div
                  key={part.id ?? `step-${index}`}
                  className={styles.stepDivider}
                />
              );
            case "step-finish":
              return null;
            default:
              return (
                <div
                  key={part.id ?? `unknown-${index}`}
                  className={styles.unknownEvent}
                >
                  <span className={styles.unknownEventType}>{part.type}</span>
                  <code>{JSON.stringify(part)}</code>
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}
