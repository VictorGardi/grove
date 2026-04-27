import { ipcMain, BrowserWindow } from "electron";
import type { Event } from "@opencode-ai/sdk/v2";
import { getClient } from "../opencode/client";
import { getSessionEntry } from "./opencodeSession";

interface Subscription {
  cancel: () => void;
}

const subscriptions = new Map<string, Subscription>();

export function registerOpencodeEventsHandlers(
  mainWindow: BrowserWindow,
): void {
  ipcMain.handle(
    "opencodeEvents:subscribe",
    async (
      _event,
      params: { taskId: string },
    ): Promise<{ ok: boolean } | { error: string }> => {
      const { taskId } = params;
      const entry = getSessionEntry(taskId);
      if (!entry) {
        return { error: `No session found for task ${taskId}` };
      }

      if (subscriptions.has(taskId)) {
        return { ok: true };
      }

      const client = getClient(entry.serverUrl);
      const sessionId = entry.sessionId;

      let eventBuffer: Event[] = [];
      let flushTimeout: ReturnType<typeof setTimeout> | null = null;

      const flushEvents = () => {
        if (eventBuffer.length > 0 && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`opencode:event:${taskId}`, eventBuffer);
          eventBuffer = [];
        }
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
      };

      const scheduleFlush = () => {
        if (!flushTimeout) {
          flushTimeout = setTimeout(flushEvents, 16);
        }
      };

      let streamIterator: AsyncIterator<Event> | null = null;

      try {
        const result = await client.event.subscribe(
          { directory: entry.worktreePath },
          {
            onSseEvent: (streamEvent) => {
              const rawEvent = streamEvent.data as Event;
              if (
                rawEvent &&
                typeof rawEvent === "object" &&
                "properties" in rawEvent
              ) {
                const eventWithProps = rawEvent as {
                  type: string;
                  properties: { sessionID?: string };
                };
                if (eventWithProps.properties?.sessionID !== sessionId) {
                  return;
                }
                eventBuffer.push(rawEvent);
                scheduleFlush();
              }
            },
            onSseError: () => {},
          },
        );

        streamIterator = result.stream[Symbol.asyncIterator]();

        subscriptions.set(taskId, {
          cancel: async () => {
            subscriptions.delete(taskId);
            if (streamIterator) {
              try {
                await streamIterator.return?.();
              } catch {
              }
            }
            if (flushTimeout) {
              clearTimeout(flushTimeout);
            }
            flushEvents();
          },
        });
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }

      return { ok: true };
    },
  );

  ipcMain.handle(
    "opencodeEvents:unsubscribe",
    async (
      _event,
      params: { taskId: string },
    ): Promise<{ ok: boolean }> => {
      const sub = subscriptions.get(params.taskId);
      if (sub) {
        await sub.cancel();
        subscriptions.delete(params.taskId);
      }
      return { ok: true };
    },
  );
}