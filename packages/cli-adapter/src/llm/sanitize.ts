export function sanitizeLlmError(error: unknown, apiKey: string): string {
  let text = error instanceof Error ? error.message : String(error);
  text = text.replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]");
  text = text.replace(/api_key\s+\S+/gi, "api_key [redacted]");
  text = text.replace(/x-api-key\s+\S+/gi, "x-api-key [redacted]");
  if (apiKey) {
    const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "g"), "[redacted]");
  }
  return text;
}
