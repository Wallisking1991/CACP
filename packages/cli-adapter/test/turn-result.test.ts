import { describe, expect, it } from "vitest";
import { appendTurnOutput, turnCompleteBody } from "../src/turn-result.js";

describe("turn result helpers", () => {
  it("accumulates stdout as final turn text and ignores stderr for final message", () => {
    let finalText = "";
    finalText = appendTurnOutput(finalText, { stream: "stdout", chunk: "hello" });
    finalText = appendTurnOutput(finalText, { stream: "stderr", chunk: "debug noise" });
    finalText = appendTurnOutput(finalText, { stream: "stdout", chunk: " world" });

    expect(finalText).toBe("hello world");
    expect(turnCompleteBody(finalText, 0)).toEqual({ final_text: "hello world", exit_code: 0 });
  });
});
