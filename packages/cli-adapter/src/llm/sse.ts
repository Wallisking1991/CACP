export interface SseEvent {
  event?: string;
  data: string;
}

function parseEventBlock(block: string): SseEvent | null {
  const lines = block.split(/\r\n|\n|\r/);
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trimStart();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    } else if (line.startsWith(":")) {
      // comment — ignore
    }
  }

  if (dataLines.length === 0 && !eventName) return null;
  return { event: eventName, data: dataLines.join("\n") };
}

function extractCompleteEvents(buffer: string): { events: SseEvent[]; remaining: string } {
  const events: SseEvent[] = [];
  let remaining = buffer;

  while (true) {
    let boundary = remaining.indexOf("\r\n\r\n");
    let endOffset = 4;
    if (boundary === -1) {
      boundary = remaining.indexOf("\n\n");
      endOffset = 2;
    }
    if (boundary === -1) {
      boundary = remaining.indexOf("\r\r");
      endOffset = 2;
    }
    if (boundary === -1) break;

    const block = remaining.slice(0, boundary);
    remaining = remaining.slice(boundary + endOffset);

    const event = parseEventBlock(block);
    if (event) events.push(event);
  }

  return { events, remaining };
}

export async function* parseSseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<SseEvent, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    if (done) {
      buffer += decoder.decode();
    }

    const result = extractCompleteEvents(buffer);
    for (const event of result.events) {
      yield event;
    }
    buffer = result.remaining;

    if (done) break;
  }

  if (buffer.trim()) {
    const event = parseEventBlock(buffer);
    if (event) yield event;
  }
}

// Backward-compatible text parser for tests
export function parseSseText(text: string): SseEvent[] {
  const result = extractCompleteEvents(text);
  if (result.remaining.trim()) {
    const event = parseEventBlock(result.remaining);
    if (event) result.events.push(event);
  }
  return result.events;
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
