export interface SseEvent {
  event?: string;
  data: string;
}

export function parseSseText(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = text.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n");
    let eventName: string | undefined;
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventName = line.slice("event: ".length);
      } else if (line.startsWith("data: ")) {
        data = line.slice("data: ".length);
      }
    }
    if (data || eventName) {
      events.push({ event: eventName, data });
    }
  }
  return events;
}

export async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}
