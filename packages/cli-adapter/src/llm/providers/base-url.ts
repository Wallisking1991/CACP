export function normalizeProviderBaseUrl(input: string, endpointPath: string): string {
  const trimmed = input.trim().replace(/\/+$/u, "");
  if (!trimmed) return trimmed;
  return trimmed.endsWith(endpointPath) ? trimmed.slice(0, -endpointPath.length).replace(/\/+$/u, "") : trimmed;
}
