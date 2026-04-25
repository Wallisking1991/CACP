export function appendTurnOutput(current: string, output: { stream: "stdout" | "stderr"; chunk: string }): string {
  return output.stream === "stdout" ? current + output.chunk : current;
}

export function turnCompleteBody(finalText: string, exitCode: number): { final_text: string; exit_code: number } {
  return { final_text: finalText, exit_code: exitCode };
}
