import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { normalizeProviderBaseUrl } from "./providers/base-url.js";
import { getProviderAdapter, listProviderAdapters } from "./providers/registry.js";
import type { LlmAgentType, LlmConnectivityResult, LlmProviderConfig } from "./types.js";
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
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function positiveIntOrDefault(value: string, fallback: number): number {
  const n = numberOrDefault(value, fallback);
  return Math.max(1, Math.trunc(n));
}

function temperatureOrDefault(value: string, fallback: number): number {
  return clamp(numberOrDefault(value, fallback), 0, 2);
}

function booleanOrUndefined(value: string): boolean | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "y" || trimmed === "yes") return true;
  if (trimmed === "n" || trimmed === "no") return false;
  return undefined;
}

function stringOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function promptForLlmApiConfig(
  agentType: LlmAgentType,
  prompter: LlmConfigPrompter,
  validate: ValidateLlmConfig
): Promise<LlmProviderConfig | undefined> {
  prompter.writeLine("This connection is for an LLM API Agent.");
  prompter.writeLine("Provider settings are required for this connector session.");
  prompter.writeLine("API keys stay on this machine and are never sent to the CACP room server.");

  const adapters = listProviderAdapters();
  const defaultProviderIndex = agentType === "llm-openai-compatible"
    ? adapters.findIndex((a) => a.id === "custom-openai-compatible")
    : agentType === "llm-anthropic-compatible"
      ? adapters.findIndex((a) => a.id === "custom-anthropic-compatible")
      : -1;

  try {
    while (true) {
      prompter.writeLine("");
      prompter.writeLine("Choose LLM API provider:");
      adapters.forEach((adapter, index) => {
        prompter.writeLine(`${index + 1}) ${adapter.label}`);
      });

      const providerInput = (await prompter.question("Provider [1-9]: ")).trim();
      const providerIndex = providerInput ? Number(providerInput) - 1 : defaultProviderIndex;
      const adapter = adapters[providerIndex];
      if (!adapter) {
        prompter.writeLine("Invalid provider selection.");
        if (!(await prompter.chooseRetry("Try again? [Y/n]: "))) return undefined;
        continue;
      }

      const baseUrlDefault = adapter.defaultBaseUrl ?? "";
      const baseUrlPrompt = baseUrlDefault ? `Base URL [${baseUrlDefault}]: ` : "Base URL: ";
      let baseUrl = (await prompter.question(baseUrlPrompt)).trim();
      if (!baseUrl && baseUrlDefault) baseUrl = baseUrlDefault;
      baseUrl = normalizeProviderBaseUrl(baseUrl, adapter.endpointPath);

      const model = (await prompter.question("Model: ")).trim();
      const apiKey = (await prompter.secret("API Key: ")).trim();

      const options: Record<string, unknown> = {};

      const advanced = (await prompter.question("Configure advanced provider options? [y/N]: ")).trim().toLowerCase();
      if (advanced === "y" || advanced === "yes") {
        await promptAdvancedOptions(adapter.id, prompter, options);
      }

      const config: LlmProviderConfig = {
        providerId: adapter.id,
        protocol: adapter.protocol,
        baseUrl,
        model,
        apiKey,
        options
      };

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

async function promptAdvancedOptions(
  providerId: string,
  prompter: LlmConfigPrompter,
  options: Record<string, unknown>
): Promise<void> {
  const adapter = getProviderAdapter(providerId as never);

  const temperatureDefault = adapter.defaultTemperature;
  const maxTokensDefault = adapter.defaultMaxTokens;

  switch (providerId) {
    case "siliconflow": {
      const temp = stringOrUndefined(await prompter.question(`Temperature [${temperatureDefault ?? "0.7"}]: `));
      if (temp !== undefined) options.temperature = temperatureOrDefault(temp, temperatureDefault ?? 0.7);
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      const enableThinking = booleanOrUndefined(await prompter.question("Enable thinking [provider default / y / n]: "));
      if (enableThinking !== undefined) options.enable_thinking = enableThinking;
      const thinkingBudget = stringOrUndefined(await prompter.question(`Thinking budget [${maxTokensDefault ?? 4096}, 128-32768]: `));
      if (thinkingBudget !== undefined) options.thinking_budget = positiveIntOrDefault(thinkingBudget, maxTokensDefault ?? 4096);
      const minP = stringOrUndefined(await prompter.question("min_p [blank=provider default, 0-1]: "));
      if (minP !== undefined) options.min_p = clamp(numberOrDefault(minP, 0), 0, 1);
      break;
    }
    case "kimi":
    case "glm-official": {
      const temp = stringOrUndefined(await prompter.question(`Temperature [${temperatureDefault ?? 0.7}]: `));
      if (temp !== undefined) options.temperature = temperatureOrDefault(temp, temperatureDefault ?? 0.7);
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      const thinkingType = stringOrUndefined(await prompter.question("Thinking mode [provider default / enabled / disabled]: "));
      if (thinkingType !== undefined) options.thinking_type = thinkingType;
      break;
    }
    case "minimax": {
      const temp = stringOrUndefined(await prompter.question(`Temperature [${temperatureDefault ?? 1.0}]: `));
      if (temp !== undefined) options.temperature = temperatureOrDefault(temp, temperatureDefault ?? 1.0);
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      const reasoningSplit = booleanOrUndefined(await prompter.question("Reasoning split [provider default / y / n]: "));
      if (reasoningSplit !== undefined) options.reasoning_split = reasoningSplit;
      break;
    }
    case "openai": {
      const maxCompletionTokens = stringOrUndefined(await prompter.question("Max completion tokens [blank=provider default]: "));
      if (maxCompletionTokens !== undefined) options.max_completion_tokens = positiveIntOrDefault(maxCompletionTokens, 1024);
      const maxTokens = stringOrUndefined(await prompter.question("Max tokens (legacy) [blank=provider default]: "));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, 1024);
      const reasoningEffort = stringOrUndefined(await prompter.question("Reasoning effort [provider default / low / medium / high]: "));
      if (reasoningEffort !== undefined) options.reasoning_effort = reasoningEffort;
      break;
    }
    case "anthropic": {
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      const thinkingType = stringOrUndefined(await prompter.question("Thinking type [blank=provider default / enabled / adaptive / disabled]: "));
      if (thinkingType !== undefined) options.thinking_type = thinkingType;
      if (thinkingType === "enabled") {
        const thinkingBudget = stringOrUndefined(await prompter.question("Thinking budget tokens [blank=provider default]: "));
        if (thinkingBudget !== undefined) options.thinking_budget_tokens = positiveIntOrDefault(thinkingBudget, 1024);
        prompter.writeLine("Note: thinking enabled disables temperature control.");
      } else if (thinkingType === "adaptive") {
        const thinkingEffort = stringOrUndefined(await prompter.question("Thinking effort [blank=provider default / low / medium / high]: "));
        if (thinkingEffort !== undefined) options.thinking_effort = thinkingEffort;
      }
      if (thinkingType !== "enabled") {
        const temp = stringOrUndefined(await prompter.question("Temperature [blank=provider default]: "));
        if (temp !== undefined) options.temperature = temperatureOrDefault(temp, 1);
      }
      break;
    }
    case "deepseek": {
      const temp = stringOrUndefined(await prompter.question(`Temperature [${temperatureDefault ?? 1.0}]: `));
      if (temp !== undefined) options.temperature = temperatureOrDefault(temp, temperatureDefault ?? 1.0);
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      const thinkingType = stringOrUndefined(await prompter.question("Thinking mode [provider default / enabled / disabled]: "));
      if (thinkingType !== undefined) options.thinking_type = thinkingType;
      const reasoningEffort = stringOrUndefined(await prompter.question("Reasoning effort [provider default / high / max]: "));
      if (reasoningEffort !== undefined) options.reasoning_effort = reasoningEffort;
      break;
    }
    case "custom-openai-compatible": {
      const temp = stringOrUndefined(await prompter.question(`Temperature [${temperatureDefault ?? 0.7}]: `));
      if (temp !== undefined) options.temperature = temperatureOrDefault(temp, temperatureDefault ?? 0.7);
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      break;
    }
    case "custom-anthropic-compatible": {
      const maxTokens = stringOrUndefined(await prompter.question(`Max tokens [${maxTokensDefault ?? 1024}]: `));
      if (maxTokens !== undefined) options.max_tokens = positiveIntOrDefault(maxTokens, maxTokensDefault ?? 1024);
      const temp = stringOrUndefined(await prompter.question("Temperature [blank=provider default]: "));
      if (temp !== undefined) options.temperature = temperatureOrDefault(temp, 1);
      break;
    }
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
