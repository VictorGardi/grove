import type { MessageDisplay } from "./TaskEventStream";

export interface TurnGroup {
  id: string;
  userMessage: MessageDisplay | null;
  assistantMessages: MessageDisplay[];
  isActive: boolean;
  isWorking: boolean;
}

function isUserMessage(msg: MessageDisplay): boolean {
  return msg.role === "user";
}

function isAssistantMessage(msg: MessageDisplay): boolean {
  return msg.role === "assistant";
}

function messageHasOpenStep(msg: MessageDisplay): boolean {
  const lastPart = msg.parts[msg.parts.length - 1];
  if (!lastPart) return false;
  const part = lastPart as { time?: { end?: number } };
  if (part.time) {
    return !part.time.end;
  }
  return false;
}

function messageHasPendingTools(msg: MessageDisplay): boolean {
  return msg.parts.some((p) => {
    if (p.type !== "tool") return false;
    const state = (p as { state?: { status?: string } }).state;
    return state?.status === "pending" || state?.status === "running";
  });
}

export function groupMessagesIntoTurns(messages: MessageDisplay[]): TurnGroup[] {
  const turns: TurnGroup[] = [];
  let currentTurn: TurnGroup | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isUser = isUserMessage(msg);
    const isAssistant = isAssistantMessage(msg);

    if (isUser) {
      if (currentTurn && currentTurn.userMessage) {
        turns.push(currentTurn);
      }
      currentTurn = {
        id: `turn-${turns.length}`,
        userMessage: msg,
        assistantMessages: [],
        isActive: false,
        isWorking: false,
      };
    } else if (isAssistant) {
      if (!currentTurn) {
        currentTurn = {
          id: `turn-${turns.length}`,
          userMessage: null,
          assistantMessages: [],
          isActive: false,
          isWorking: false,
        };
      }
      currentTurn.assistantMessages.push(msg);

      const hasOpenStep = messageHasOpenStep(msg);
      const hasPendingTools = messageHasPendingTools(msg);
      if (hasOpenStep || hasPendingTools) {
        currentTurn.isWorking = true;
      }

      const isLastAssistant = i === messages.length - 1 || !isAssistantMessage(messages[i + 1]);
      if (isLastAssistant && currentTurn.userMessage) {
        currentTurn.isActive = hasOpenStep || hasPendingTools;
      }
    }
  }

  if (currentTurn && (currentTurn.userMessage || currentTurn.assistantMessages.length > 0)) {
    turns.push(currentTurn);
  }

  return turns;
}

interface TurnGroupComponentProps {
  turn: TurnGroup;
  children: React.ReactNode;
}

export function TurnGroupComponent({ turn, children }: TurnGroupComponentProps): React.JSX.Element {
  return (
    <div className={`turn-group ${turn.isActive ? "turn-group-active" : ""}`} data-turn-id={turn.id}>
      {children}
    </div>
  );
}