import type {
  AgentRunNodeCompletedPayload,
  AgentRunNodeDeltaPayload,
  AgentRunNodeFailedPayload,
  AgentRunNodeKind,
  AgentRunNodeStartedPayload,
  AgentRunNodeStatus,
  AgentRunNodeUpdatedPayload,
  AgentRunSourceRefs
} from "@cacp/protocol";

export interface RunTraceContext {
  turnId: string;
  agentId: string;
  provider: string;
  now?: () => string;
}

export interface RunTraceSink {
  startNode(payload: AgentRunNodeStartedPayload): Promise<void>;
  appendNodeDelta(payload: AgentRunNodeDeltaPayload): Promise<void>;
  updateNode(payload: AgentRunNodeUpdatedPayload): Promise<void>;
  completeNode(payload: AgentRunNodeCompletedPayload): Promise<void>;
  failNode(payload: AgentRunNodeFailedPayload): Promise<void>;
}

interface RunTraceNodeState {
  nodeId: string;
  kind: AgentRunNodeKind;
  title: string;
  status: AgentRunNodeStatus;
  terminal: boolean;
}

export class RunTraceRecorder {
  private readonly nodes = new Map<string, RunTraceNodeState>();

  constructor(
    private readonly context: RunTraceContext,
    private readonly sink: RunTraceSink
  ) {}

  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  isTerminal(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.terminal ?? false;
  }

  openNodeIds(): string[] {
    return [...this.nodes.values()].filter((node) => !node.terminal).map((node) => node.nodeId);
  }

  currentTitle(nodeId: string): string | undefined {
    return this.nodes.get(nodeId)?.title;
  }

  currentKind(nodeId: string): AgentRunNodeKind | undefined {
    return this.nodes.get(nodeId)?.kind;
  }

  async startNode(input: {
    nodeId: string;
    kind: AgentRunNodeKind;
    title: string;
    status?: "pending" | "waiting_input" | "running" | "streaming";
    parentNodeId?: string;
    role?: "user" | "assistant" | "system";
    contentFormat?: "text" | "markdown" | "html";
    text?: string;
    detail?: Record<string, unknown>;
    sourceRefs?: AgentRunSourceRefs;
  }): Promise<void> {
    if (this.nodes.has(input.nodeId)) return;

    const timestamp = this.now();
    await this.sink.startNode({
      run_id: this.context.turnId,
      turn_id: this.context.turnId,
      agent_id: this.context.agentId,
      provider: this.context.provider,
      node_id: input.nodeId,
      ...(input.parentNodeId ? { parent_node_id: input.parentNodeId } : {}),
      kind: input.kind,
      status: input.status ?? "running",
      title: input.title,
      ...(input.role ? { role: input.role } : {}),
      ...(input.contentFormat ? { content_format: input.contentFormat } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.sourceRefs ? { source_refs: input.sourceRefs } : {}),
      started_at: timestamp,
      updated_at: timestamp
    });

    this.nodes.set(input.nodeId, {
      nodeId: input.nodeId,
      kind: input.kind,
      title: input.title,
      status: input.status ?? "running",
      terminal: false
    });
  }

  async appendNodeDelta(input: {
    nodeId: string;
    deltaType: "text" | "stdout" | "stderr";
    chunk: string;
  }): Promise<void> {
    if (!input.chunk || !this.nodes.has(input.nodeId) || this.isTerminal(input.nodeId)) return;

    await this.sink.appendNodeDelta({
      run_id: this.context.turnId,
      turn_id: this.context.turnId,
      agent_id: this.context.agentId,
      provider: this.context.provider,
      node_id: input.nodeId,
      delta_type: input.deltaType,
      chunk: input.chunk,
      updated_at: this.now()
    });
  }

  async updateNode(input: {
    nodeId: string;
    status?: AgentRunNodeStatus;
    title?: string;
    detail?: Record<string, unknown>;
    sourceRefs?: AgentRunSourceRefs;
  }): Promise<void> {
    const existing = this.nodes.get(input.nodeId);
    if (!existing || existing.terminal) return;

    await this.sink.updateNode({
      run_id: this.context.turnId,
      turn_id: this.context.turnId,
      agent_id: this.context.agentId,
      provider: this.context.provider,
      node_id: input.nodeId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.sourceRefs ? { source_refs: input.sourceRefs } : {}),
      updated_at: this.now()
    });

    this.nodes.set(input.nodeId, {
      ...existing,
      ...(input.status ? { status: input.status } : {}),
      ...(input.title ? { title: input.title } : {})
    });
  }

  async completeNode(input: {
    nodeId: string;
    summary?: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    const existing = this.nodes.get(input.nodeId);
    if (!existing || existing.terminal) return;

    await this.sink.completeNode({
      run_id: this.context.turnId,
      turn_id: this.context.turnId,
      agent_id: this.context.agentId,
      provider: this.context.provider,
      node_id: input.nodeId,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      completed_at: this.now()
    });

    this.nodes.set(input.nodeId, {
      ...existing,
      status: "completed",
      terminal: true
    });
  }

  async failNode(input: {
    nodeId: string;
    error: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    const existing = this.nodes.get(input.nodeId);
    if (!existing || existing.terminal) return;

    await this.sink.failNode({
      run_id: this.context.turnId,
      turn_id: this.context.turnId,
      agent_id: this.context.agentId,
      provider: this.context.provider,
      node_id: input.nodeId,
      error: input.error,
      ...(input.detail ? { detail: input.detail } : {}),
      failed_at: this.now()
    });

    this.nodes.set(input.nodeId, {
      ...existing,
      status: "failed",
      terminal: true
    });
  }

  private now(): string {
    return this.context.now?.() ?? new Date().toISOString();
  }
}
