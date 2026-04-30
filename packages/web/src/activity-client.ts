export interface TypingActivityController {
  inputChanged: (value: string) => void;
  stopNow: () => void;
  dispose: () => void;
}

export interface TypingActivityControllerOptions {
  startTyping: () => void;
  stopTyping: () => void;
  stopDelayMs?: number;
}

export function createTypingActivityController({
  startTyping,
  stopTyping,
  stopDelayMs = 2500
}: TypingActivityControllerOptions): TypingActivityController {
  let typing = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function clearStopTimer(): void {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = undefined;
  }

  function emitStop(): void {
    clearStopTimer();
    if (!typing) return;
    typing = false;
    stopTyping();
  }

  function scheduleStop(): void {
    clearStopTimer();
    timeout = setTimeout(emitStop, stopDelayMs);
  }

  return {
    inputChanged(value: string): void {
      if (!value.trim()) {
        emitStop();
        return;
      }
      if (!typing) {
        typing = true;
        startTyping();
      }
      scheduleStop();
    },
    stopNow: emitStop,
    dispose(): void {
      emitStop();
    }
  };
}
