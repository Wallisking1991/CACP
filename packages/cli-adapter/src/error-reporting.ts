export const ProtocolErrorMaxLength = 2000;

const TruncatedSuffix = "… [truncated]";

export function protocolSafeErrorMessage(message: string, maxLength = ProtocolErrorMaxLength): string {
  const normalized = message.trim() || "Adapter turn failed";
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= TruncatedSuffix.length) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - TruncatedSuffix.length)}${TruncatedSuffix}`;
}

export interface ReportTurnFailureInput {
  displayError: string;
  reportRuntimeFailure?: (error: string, failedAt: string) => Promise<void>;
  failTurn: (error: string) => Promise<void>;
  now?: () => string;
  log?: (message: string, error: unknown) => void;
}

export async function reportTurnFailure(input: ReportTurnFailureInput): Promise<void> {
  const safeError = protocolSafeErrorMessage(input.displayError);
  const failedAt = input.now?.() ?? new Date().toISOString();
  const log = input.log ?? (() => undefined);

  if (input.reportRuntimeFailure) {
    try {
      await input.reportRuntimeFailure(safeError, failedAt);
    } catch (error) {
      log("Adapter failed to report runtime failure status", error);
    }
  }

  try {
    await input.failTurn(safeError);
  } catch (error) {
    log("Adapter failed to report turn failure", error);
  }
}
