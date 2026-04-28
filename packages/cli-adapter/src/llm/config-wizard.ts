import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { providerForAgentType, type LlmAgentType, type LlmConnectivityResult, type LlmProviderConfig } from "./types.js";
import { sanitizeLlmError } from "./sanitize.js";

export interface LlmConfigPrompter {
  question(prompt: string): Promise<string>;
  secret(prompt: string): Promise<string>;
  chooseRetry(prompt: string): Promise<boolean>;
  writeLine(line: string): void;
  close(): void;
}

type ValidateLlmConfig = (config: LlmProviderConfig) => Promise<LlmConnectivityResult>;

function numberOrDefault(value: string, fallback: number): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function promptForLlmApiConfig(
  agentType: LlmAgentType,
  prompter: LlmConfigPrompter,
  validate: ValidateLlmConfig
): Promise<LlmProviderConfig | undefined> {
  prompter.writeLine("This connection is for an LLM API Agent.");
  prompter.writeLine("Provider settings are required for this connector session.");
  prompter.writeLine("API keys stay on this machine and are never sent to the CACP room server.");
  try {
    while (true) {
      const baseUrl = (await prompter.question("Base URL: ")).trim();
      const model = (await prompter.question("Model: ")).trim();
      const apiKey = (await prompter.secret("API Key: ")).trim();
      const temperature = numberOrDefault(await prompter.question("Temperature [0.7]: "), 0.7);
      const maxTokens = Math.trunc(numberOrDefault(await prompter.question("Max tokens [1024]: "), 1024));
      const config = { provider: providerForAgentType(agentType), baseUrl, model, apiKey, temperature, maxTokens };
      try {
        const result = await validate(config);
        prompter.writeLine(
          `LLM API connectivity test succeeded. The agent will now connect to the room.${result.sampleText ? ` Sample: ${result.sampleText}` : ""}`
        );
        return config;
      } catch (cause) {
        prompter.writeLine("LLM API connectivity test failed.");
        prompter.writeLine(sanitizeLlmError(cause, apiKey));
        if (!(await prompter.chooseRetry("Re-enter LLM API settings? [Y/n]: "))) return undefined;
      }
    }
  } finally {
    prompter.close();
  }
}

export function createConsolePrompter(): LlmConfigPrompter {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return {
    question: (prompt) => rl.question(prompt),
    secret: async (prompt) => {
      if (!defaultStdin.isTTY || !defaultStdin.setRawMode) {
        console.log("Warning: this terminal may echo input. Paste only in a trusted local console.");
        return await rl.question(prompt);
      }
      defaultStdout.write(prompt);
      defaultStdin.setRawMode(true);
      let value = "";
      let resolved = false;

      return await new Promise<string>((resolve, reject) => {
        const cleanup = () => {
          if (resolved) return;
          resolved = true;
          try { defaultStdin.setRawMode(false); } catch { /* ignore */ }
          defaultStdin.off("data", onData);
          defaultStdout.write("\n");
        };

        const onData = (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          for (const char of text) {
            if (char === "\r" || char === "\n") {
              cleanup();
              resolve(value);
              return;
            }
            if (char === "\b" || char === "\u007f") {
              value = value.slice(0, -1);
              continue;
            }
            if (char === "\u0003") { // Ctrl+C
              cleanup();
              reject(new Error("user_cancelled"));
              return;
            }
            value += char;
          }
        };
        defaultStdin.on("data", onData);
      });
    },
    chooseRetry: async (prompt) => {
      const answer = (await rl.question(prompt)).trim().toLowerCase();
      return answer === "" || answer === "y" || answer === "yes";
    },
    writeLine: (line) => console.log(line),
    close: () => rl.close()
  };
}
