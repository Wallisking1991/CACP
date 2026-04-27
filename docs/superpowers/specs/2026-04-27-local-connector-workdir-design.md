# Local Connector Download and Working Directory Design

Date: 2026-04-27
Status: Draft for review
Scope: Cloud room web UI, Local Connector, pairing claim flow

## Problem

The cloud web app currently asks for a `Working directory` during room creation and recently attempted to open a browser directory picker. This is the wrong boundary. A public browser page cannot reliably access a user's absolute local path, and directory-picking APIs may expose file names or fail for empty folders. The working directory is a local machine concern and should be chosen by the Local Connector, not by the cloud server or web page.

Users also need an obvious way to download the Local Connector before or during room setup. The connector binary is generic; the connection code is the per-room, short-lived secret.

## Goals

- Remove `Working directory` from the cloud web room creation flow.
- Make the Local Connector downloadable from the homepage and from the room sidebar.
- Let users place or launch the connector from the local project directory they want the agent to operate in.
- Keep pairing tokens and connection codes short-lived and room-specific.
- Preserve local-first behavior for non-cloud development mode.

## Non-Goals

- Do not build a full installer, updater, or signed release workflow in this change.
- Do not expose local filesystem paths to the cloud web page.
- Do not support remote server-side agent execution in cloud mode.

## Options Considered

### Option A: Browser directory picker

The web page opens `<input webkitdirectory>` or `showDirectoryPicker()`. This is not recommended because browsers do not expose stable absolute paths, empty directories are problematic, and selected file names may leak to the page.

### Option B: Manual path input in web

The web page asks users to paste `D:\Projects\app`. This works technically, but it is easy to mistype and still sends a local path to the cloud server unnecessarily.

### Option C: Connector-local working directory (Recommended)

The connector determines the working directory locally. The simplest rule is: by default, use the directory containing `CACP-Local-Connector.exe`; when run from a terminal, optionally allow a `--cwd <path>` override. The cloud web page only provides download and connection-code instructions.

## Proposed User Flow

1. User opens the cloud web homepage.
2. Homepage shows `Download Local Connector` and basic setup instructions.
3. User downloads `CACP-Local-Connector.exe`.
4. User places the exe in the local project directory, for example `D:\Projects\my-app\`.
5. User creates a room in the web app. The web app generates a one-time connection code.
6. User runs the connector from the project directory and pastes the connection code.
7. Connector claims the pairing, starts the selected CLI agent, and runs it with the local working directory.

The same connector binary can be reused. For a later room, the user only needs a new connection code.

## Component Changes

### Web UI

- Landing page:
  - Remove `Working directory` input and `Browse` button.
  - Add a visible `Download Local Connector` action in cloud mode.
  - Add short instructions: place the connector in your project folder, run it, paste the connection code.
- Room sidebar:
  - Keep the existing Local Connector card after pairing creation.
  - Continue to show download link, connection code, expiration time, and copy button.
- i18n:
  - Add English and Chinese text for connector download and local working-directory instructions.
  - Use i18n keys for agent type and permission labels instead of hardcoded English.

### Web API Client

- Cloud `createAgentPairing` should no longer collect a user-provided working directory from Landing.
- For backward compatibility, server may still accept `working_dir`; the web client should send `.` or omit it once the server supports optional local claim-time working directories.

### Server

- Pairing creation remains owner/admin-only and returns:
  - `connection_code`
  - `download_url`
  - `expires_at`
- Pairing creation should not require a real local path from the web page.
- Pairing claim should allow the connector to provide its resolved local working directory, for example request body `{ working_dir?: string, adapter_name?: string }`.
- Server uses the claim-time `working_dir` when building the agent profile. If absent, it falls back to the stored value or `.`.
- Continue enforcing one-time and expiring pairing tokens.

### Local Connector / CLI Adapter

- In prompt/connect/pair modes, resolve the local working directory before claim:
  - `--cwd <path>` overrides all defaults.
  - Otherwise use the executable directory when running as the packaged connector.
  - Otherwise use `process.cwd()` for developer CLI usage.
- Include the resolved `working_dir` in the pairing claim body.
- After claim, run Claude Code / Codex / opencode with the returned agent profile working directory.
- If the resolved path does not exist or is not a directory, fail with a clear local error before claiming when possible.

## Data Flow

```text
Web homepage
  -> downloads generic CACP-Local-Connector.exe

Room owner creates room
  -> server creates room and pairing
  -> server returns one-time connection code

Connector runs locally
  -> resolves local working directory
  -> POST /agent-pairings/:token/claim { working_dir }
  -> server creates agent profile using local working_dir
  -> connector opens WebSocket and runs CLI agent in that directory
```

## Security Notes

- The web page must not enumerate local directories or file names.
- The local path is only sent by the connector during authenticated pairing claim.
- Connection codes remain secret, one-time, and time-limited.
- Downloading the connector should not embed any room token; the token is copied separately as the connection code.
- The UI should warn users that limited-write/full-access modes allow local file changes in the selected project directory.

## Error Handling

- If connector download is missing, show a clear web error or keep the link visible but let HTTP return 404 during validation.
- If the connection code is expired or already claimed, connector displays the server error and exits.
- If the local working directory is invalid, connector exits before starting the agent.
- If the selected agent CLI is not installed, connector reports the missing command locally and publishes failure where possible.

## Testing Plan

- Web tests:
  - Landing in cloud mode renders `Download Local Connector`.
  - Landing no longer renders working directory input or browser directory picker.
  - Agent type and permission dropdown labels use i18n keys.
- Server tests:
  - Pairing can be created without a meaningful local path from web.
  - Claim body `working_dir` overrides stored pairing working directory.
  - Existing one-time/expiry tests continue to pass.
- CLI adapter tests:
  - `--cwd` is parsed and sent during claim.
  - packaged/default working-directory resolver falls back deterministically.
  - invalid local directory fails before agent execution.
- Build validation:
  - `corepack pnpm check`
  - `corepack pnpm build:connector:win`

## Acceptance Criteria

- Cloud Landing has no Working directory field.
- Cloud Landing and room sidebar both provide a connector download path.
- A user can reuse the same connector binary across rooms by pasting a new connection code.
- Agent CLI runs in the directory where the connector is placed or in the explicit `--cwd` path.
- No browser directory picker or local file enumeration remains in the web app.
