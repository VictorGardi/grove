import { useState, useEffect, useRef } from "react";

const THROTTLE_MS = 33; // Match openchamber's FLUSH_FRAME_MS

interface UseStreamingThrottleOptions {
  text: string;
  isStreaming: boolean;
  identityKey: string; // Used to reset throttle when part changes
}

/**
 * Throttles text display updates during streaming.
 * During streaming, updates at most every THROTTLE_MS (33ms).
 * When streaming completes, immediately shows final text.
 * Resets throttle state when identityKey changes (new part).
 */
export function useStreamingThrottle({
  text,
  isStreaming,
  identityKey,
}: UseStreamingThrottleOptions): string {
  const [displayText, setDisplayText] = useState(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateRef = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;

  // Reset when identityKey changes (new part or part replaced)
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDisplayText(text);
    lastUpdateRef.current = Date.now();
  }, [identityKey]);

  useEffect(() => {
    if (!isStreaming) {
      // Streaming complete - show final text immediately
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDisplayText(text);
      return;
    }

    // Streaming - throttle updates
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= THROTTLE_MS) {
      // Update immediately
      setDisplayText(text);
      lastUpdateRef.current = now;
    } else if (!timerRef.current) {
      // Schedule update
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setDisplayText(textRef.current);
        lastUpdateRef.current = Date.now();
      }, THROTTLE_MS - elapsed);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [text, isStreaming]);

  return displayText;
}
