# CACP

**Status:** Experimental project  
**Live Demo:** https://cacp.zuchongai.com/  
**中文:** [README.zh-CN.md](README.zh-CN.md)

CACP stands for Collaborative Agent Communication Protocol.

It starts from a simple belief: the next generation of AI tools should not only make one person more capable; it should also help groups of people, AI agents, tools, and shared context work together in the same collaborative space.

Most current AI and AI Agent products still assume a one-to-one interaction model: one user talks to one AI assistant or one local coding agent. That model is powerful, but many real-world problems are not solved by one person alone. Product design, software requirements, open-source planning, security reviews, business decisions, and creative work often need multiple people with different knowledge to build a shared understanding before AI can produce a high-quality answer.

CACP is an open-source exploration of that missing collaboration layer. It provides a shared AI room where humans can discuss together, invite members or observers, connect a local or API-based agent, and use Roundtable Mode to collect human perspectives before submitting them to AI as one structured context.

This is an early prototype and protocol experiment. The core experience is already runnable and suitable for trying, studying, and contributing to, but it should not be treated as a production-ready collaboration platform yet.

![CACP concept diagram](docs/cacp-concept.en.svg)

## What is CACP?

CACP is a local-first collaborative AI room. The public server hosts room state and the Web UI; agent execution stays local through the Local Connector.

It includes:

- A web room where multiple humans can join the same AI conversation.
- A room server that stores room state as an append-only event log and broadcasts updates in real time.
- A local connector that bridges the web room to a persistent Claude Code session or LLM API agents.
- A protocol package that defines shared event types, participant roles, connection codes, and room contracts.
- Roundtable Mode, which lets people discuss first and send the collected human context to AI only when the room owner submits it.

Local execution is Claude Code-first:

- Claude Code runs in the owner’s project directory through the Local Connector.
- The connector can start fresh or resume a detected Claude Code session.
- Resumed Claude Code session history is uploaded into the shared room timeline only after the room owner confirms.
- Imported Claude Code history is visible to all room members and should be treated as shared room content.

Pure conversation LLM API agents remain supported for OpenAI-compatible and Anthropic-compatible providers. API keys stay local to the connector and are validated before pairing.

## Who is it for?

CACP is designed for two audiences.

### For regular users

Use CACP if you want to try a multi-person AI discussion room where several people can talk with the same AI context.

Possible use cases:

- Brainstorming product ideas with several participants.
- Discussing software requirements with business and technical stakeholders.
- Exploring a game, app, or creative concept with people from different backgrounds.
- Letting observers learn how an AI-assisted project discussion unfolds.
- Testing how a local Claude Code session or LLM API agents behave inside a shared room.

### For developers

Use CACP if you want to study or contribute to a protocol-first, local-first AI collaboration experiment.

Developer areas include:

- Room protocol and event model.
- Fastify/WebSocket room server.
- SQLite event store.
- React + Vite room UI.
- Local Connector Claude Code runtime and LLM API provider adapters.
- LLM API provider adapters.
- Invite, pairing, participant, and room governance flows.

## Try the live demo

Open:

https://cacp.zuchongai.com/

The live demo is public and experimental. Use it with non-sensitive test topics and test projects only.

## Quick user guide

### 1. Create a room

Open the live demo and choose the create-room flow.

Enter:

- A room name.
- Your display name.
- The type of agent you want to connect.
- The Claude Code permission level if you choose local execution.

### 2. Choose an agent type

CACP can connect different kinds of agents.

Local Claude Code agent:

- Claude Code

LLM API agents:

- OpenAI-compatible providers
- Anthropic-compatible providers
- Selected provider-specific adapters such as DeepSeek, Kimi, MiniMax, SiliconFlow, GLM, and others

LLM API connector flow supports provider-specific adapters such as DeepSeek, Kimi, MiniMax, SiliconFlow, and GLM.

### 3. Download and start the Local Connector

In cloud mode, the browser room cannot directly run your local agent. You need the Local Connector.

Download the connector from the room page when prompted.

Recommended practice:

- Put the connector in the directory where you want the agent to work.
- Use a test folder or a non-sensitive project first.
- Avoid production repositories, secret files, private keys, or confidential documents.

Start the connector and paste the CACP connection code shown in the web room.

Keep the connector window open while using the room. Closing it disconnects the local agent.

### 4. Connect an LLM API agent

If you choose an LLM API agent, the connector will ask for provider settings such as base URL, model, and API key.

These settings are used by the local connector. Do not share API keys in room messages, screenshots, issue reports, or logs.

### 5. Invite members or observers

The room owner can create invite links.

Roles:

- Owner: manages the room, approves join requests, starts or submits Roundtable Mode, and manages participants.
- Member: can participate in the discussion.
- Observer: can watch the room but does not participate in the conversation.
- Agent: the connected AI participant.

Invite links are intentionally limited and should be treated as access credentials. Share them only with people you trust.

### 6. Use normal chat

In normal chat mode, messages are sent to the room and can trigger the active agent to respond.

This is useful when the room wants immediate AI feedback.

### 7. Use Roundtable Mode

Roundtable Mode is the key CACP interaction pattern.

Use it when you want people to discuss first before AI answers.

Typical flow:

1. The owner starts Roundtable Mode, or a member requests it and the owner approves.
2. Participants add their perspectives in the room.
3. These messages are collected and do not trigger AI one by one.
4. The owner submits the round.
5. The agent receives the collected human context and responds once.

This is useful when a topic needs multiple viewpoints, such as product design, architecture discussion, business analysis, or creative brainstorming.

## Safety boundary for users

CACP is designed around a local-first agent boundary, but users still need to be careful.

Important cautions:

- The live demo is experimental. Do not use it for confidential work.
- Claude Code runs on your machine through the Local Connector and may access the working directory you choose.
- Use read-only permission for demos unless you intentionally want an agent to edit files.
- Do not expose tokens, API keys, SSH keys, production configs, private room links, or sensitive files in chat, screenshots, or logs.
- Only connect agents in directories you trust.
- Only invite people you trust into rooms that contain meaningful context.
- If you are unsure, use an LLM API agent or a test folder instead of a local coding agent with write access.

## What CACP is not

CACP is not a hosted coding-agent platform.

CACP is not a replacement for Claude Code or other agents.

CACP is not production-ready collaboration infrastructure.

CACP is an early open-source experiment in how multiple humans and AI agents can communicate through a shared protocol and shared room.

## Project structure

```text
packages/
  protocol      Shared TypeScript types, Zod schemas, protocol contracts, connection codes
  server        Fastify/WebSocket room server, SQLite event store, auth, pairing, governance
  cli-adapter   Local connector runtime for Claude Code sessions and LLM API agents
  web           React + Vite room UI

docs/
  protocol      Protocol notes
  examples      Example connector configs
  superpowers   Design and implementation notes

deploy/
  Example production deployment files

scripts/
  Repository utilities such as the Windows Local Connector build script
```

## Local development

Prerequisites:

- Node.js 20 or newer
- Corepack
- pnpm version pinned by `packageManager`

Install dependencies:

```powershell
corepack enable
corepack pnpm install
```

Run the full validation:

```powershell
corepack pnpm check
```

Run tests:

```powershell
corepack pnpm test
```

Build all packages:

```powershell
corepack pnpm build
```

Start local development services:

```powershell
corepack pnpm dev:server
corepack pnpm dev:web
corepack pnpm dev:adapter
```

For focused tests:

```powershell
corepack pnpm --filter @cacp/server test
corepack pnpm --filter @cacp/web test
corepack pnpm --filter @cacp/cli-adapter test
```

Build the Windows Local Connector executable:

```powershell
corepack pnpm build:connector:win
```

## Developer notes

Important files:

- Protocol schemas: `packages/protocol/src/schemas.ts`
- Connection-code helper: `packages/protocol/src/connection-code.ts`
- Server app and routes: `packages/server/src/server.ts`
- Event store: `packages/server/src/event-store.ts`
- Server conversation helpers: `packages/server/src/conversation.ts`
- Agent profile mapping: `packages/server/src/pairing.ts`
- Web API client: `packages/web/src/api.ts`
- Web state derivation: `packages/web/src/room-state.ts`
- CLI adapter entrypoint: `packages/cli-adapter/src/index.ts`
- LLM provider registry: `packages/cli-adapter/src/llm/providers/registry.ts`

When changing protocol event contracts, update:

- The protocol schema.
- Server logic that creates or derives from the event.
- Web room-state derivation.
- Package tests.
- Documentation if the behavior is user-visible.

## Developer safety boundary

Only the room server and web UI should be public.

Agent execution should stay local to the user through the connector.

Do not commit:

- `.env`
- `.deploy/*`
- `docs/Server info.md`
- `docs/deploy-cloud.md`
- `docs/examples/*.local.json`
- SQLite database files
- SSH keys
- API keys
- production config
- connector tokens
- screenshots or logs that expose room, invite, pairing, participant, or connector secrets

## Contributing

Contributions are welcome, especially in these areas:

- Protocol design and event semantics.
- Room UX and Roundtable Mode improvements.
- Local Connector usability.
- Agent adapter compatibility.
- LLM provider adapters.
- Security review and hardening.
- Documentation and examples.

Before opening a pull request, run the relevant tests and include validation notes. For visible UI changes, include screenshots or recordings when possible.

## Contact

Project contact emails:

- 453043662@qq.com
- wangzuchong@gmail.com
- 1023289914@qq.com

