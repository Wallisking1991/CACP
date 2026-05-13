import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";

export interface FatalPauseInput {
  argv: string[];
  execPath: string;
  stdinIsTTY?: boolean;
}

export interface FatalErrorHandlerOptions extends FatalPauseInput {
  writeError?: (line: string) => void;
  pause?: () => Promise<void>;
  exit?: (code: number) => void;
}

function isConnectorBundle(path: string | undefined): boolean {
  return basename(path ?? "") === "index.cjs";
}

export function shouldPauseBeforeFatalExit(input: FatalPauseInput): boolean {
  if (input.stdinIsTTY === false) return false;
  const packagedConnector = isConnectorBundle(input.argv[1]);
  if (!packagedConnector) return false;
  const userArgs = input.argv.slice(2);
  return userArgs.length === 0;
}

export function formatFatalError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function defaultPause(): Promise<void> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  try {
    await rl.question("Press Enter to exit...");
  } finally {
    rl.close();
  }
}

export async function handleFatalError(error: unknown, options?: Partial<FatalErrorHandlerOptions>): Promise<void> {
  const argv = options?.argv ?? process.argv;
  const execPath = options?.execPath ?? process.execPath;
  const stdinIsTTY = options?.stdinIsTTY ?? defaultStdin.isTTY;
  const writeError = options?.writeError ?? ((line: string) => console.error(line));
  const exit = options?.exit ?? ((code: number) => process.exit(code));

  writeError("CACP Local Connector failed.");
  writeError(formatFatalError(error));

  if (shouldPauseBeforeFatalExit({ argv, execPath, stdinIsTTY })) {
    await (options?.pause ?? defaultPause)();
  }

  exit(1);
}
