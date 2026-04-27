# Room UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the cloud room UX by masking Local Connector connection codes, counting only human participants as people, surfacing join requests in an owner modal, requiring explicit display names, and adding landing-page contact copy.

**Architecture:** Keep server protocol and token behavior unchanged. Implement the changes in the web package with small reusable helpers: participant filtering in `room-state.ts`, connection-code masking in `Sidebar.tsx`, and a focused `JoinRequestModal` component wired by `Workspace.tsx`. Use existing i18n JSON files and Vitest/Testing Library for behavior coverage.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, pnpm workspace.

---

## File Structure

- Modify `packages/web/src/components/Landing.tsx`: empty display-name default and landing footer.
- Modify `packages/web/src/i18n/messages.en.json`: English footer, connector-copy, and join-request modal text.
- Modify `packages/web/src/i18n/messages.zh.json`: Chinese footer, connector-copy, and join-request modal text.
- Modify `packages/web/test/landing-connector.test.tsx`: landing defaults and footer regression tests.
- Modify `packages/web/src/room-state.ts`: export human participant helpers.
- Modify `packages/web/test/room-state-helpers.test.ts`: tests for human participant filtering.
- Modify `packages/web/src/components/Workspace.tsx`: pass human participants to header/sidebar and wire join-request modal.
- Modify `packages/web/src/components/Sidebar.tsx`: mask connector code and show copy feedback.
- Modify `packages/web/test/cloud-connector.test.tsx`: code masking and clipboard regression tests.
- Create `packages/web/src/components/JoinRequestModal.tsx`: owner join-request prompt.
- Create `packages/web/test/join-request-modal.test.tsx`: modal display/action tests.
- Create `packages/web/test/workspace-join-request-modal.test.tsx`: owner-only Workspace integration tests.
- Modify `packages/web/src/App.css`: modal and landing-footer styles.

---

## Task 1: Landing Required Names and Footer

**Files:**
- Modify: `packages/web/src/components/Landing.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Test: `packages/web/test/landing-connector.test.tsx`

- [ ] **Step 1: Add failing landing tests**

Append these tests inside `describe("Landing cloud connector setup", () => { ... })` in `packages/web/test/landing-connector.test.tsx`:

```tsx
  it("starts create and join display names empty and requires a typed name", () => {
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    const createName = screen.getByLabelText("Your name") as HTMLInputElement;
    expect(createName).toHaveValue("");
    expect(createName).toBeRequired();
    expect(screen.getByRole("button", { name: "Create room and generate connector command" })).toBeDisabled();

    fireEvent.change(createName, { target: { value: "Alice" } });
    expect(screen.getByRole("button", { name: "Create room and generate connector command" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Join with invite" }));
    const joinName = screen.getByLabelText("Your name") as HTMLInputElement;
    expect(joinName).toHaveValue("");
    expect(joinName).toBeRequired();
    expect(screen.getByRole("button", { name: "Join shared room" })).toBeDisabled();
  });

  it("renders landing copyright and contact information", () => {
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByText("© 2026 CACP. All rights reserved.")).toBeInTheDocument();
    expect(screen.getByText("Contact: 453043662@qq.com, 1023289914@qq.com")).toBeInTheDocument();
  });

  it("renders localized Chinese footer contact information", () => {
    window.localStorage.setItem("cacp.web.lang", "zh");
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByText("© 2026 CACP。保留所有权利。")).toBeInTheDocument();
    expect(screen.getByText("联系方式：453043662@qq.com，1023289914@qq.com")).toBeInTheDocument();
  });
```

Update the test imports at the top of the same file:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
```

- [ ] **Step 2: Run the focused failing landing tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- landing-connector.test.tsx
```

Expected: FAIL because the create display name is still prefilled with `Alice`, the join name shares that value, and the footer copy is missing.

- [ ] **Step 3: Add landing i18n footer messages**

Add these keys near the other `landing.*` keys in `packages/web/src/i18n/messages.en.json`:

```json
  "landing.footer.copyright": "© 2026 CACP. All rights reserved.",
  "landing.footer.contact": "Contact: 453043662@qq.com, 1023289914@qq.com",
```

Add these keys near the other `landing.*` keys in `packages/web/src/i18n/messages.zh.json`:

```json
  "landing.footer.copyright": "© 2026 CACP。保留所有权利。",
  "landing.footer.contact": "联系方式：453043662@qq.com，1023289914@qq.com",
```

- [ ] **Step 4: Implement empty display-name defaults and footer**

In `packages/web/src/components/Landing.tsx`, replace the display-name state with separate empty create/join state:

```tsx
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
```

Update validity and submit handlers:

```tsx
  const createValid = roomName.trim() && ownerDisplayName.trim();
  const joinValid = joinRoomId.trim() && inviteToken.trim() && joinDisplayName.trim();
```

```tsx
      displayName: ownerDisplayName.trim(),
```

```tsx
      displayName: joinDisplayName.trim()
```

Update the create display-name input:

```tsx
            <input
              id="landing-display-name"
              className="input"
              value={ownerDisplayName}
              onChange={(e) => setOwnerDisplayName(e.target.value)}
              required
            />
```

Update the join display-name input:

```tsx
            <input
              id="landing-join-display-name"
              className="input"
              value={joinDisplayName}
              onChange={(e) => setJoinDisplayName(e.target.value)}
              required
            />
```

Add the footer just before `</main>` and after the landing card `</div>`:

```tsx
      <footer className="landing-footer">
        <p>{t("landing.footer.copyright")}</p>
        <p>{t("landing.footer.contact")}</p>
      </footer>
```

- [ ] **Step 5: Add footer styles**

In `packages/web/src/App.css`, add this block after `.landing-subcopy`:

```css
.landing-footer {
  margin-top: 16px;
  text-align: center;
  color: var(--ink-4);
  font-size: 12px;
  line-height: 1.6;
}
```

- [ ] **Step 6: Run focused landing tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- landing-connector.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add packages/web/src/components/Landing.tsx packages/web/src/App.css packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/landing-connector.test.tsx
git commit -m "feat(web): require explicit landing display names"
```

---

## Task 2: Human-Only People Count

**Files:**
- Modify: `packages/web/src/room-state.ts`
- Modify: `packages/web/src/components/Workspace.tsx`
- Test: `packages/web/test/room-state-helpers.test.ts`

- [ ] **Step 1: Add failing helper tests**

Update the import in `packages/web/test/room-state-helpers.test.ts`:

```ts
import { isCollectionActive, isTurnInFlight, collectedMessageIds, humanParticipants } from "../src/room-state.js";
```

Append this test block to the same file:

```ts
describe("humanParticipants", () => {
  it("excludes agent participants from people counts and lists", () => {
    const participants = [
      { id: "user_owner", display_name: "Owner", role: "owner", type: "human" },
      { id: "user_member", display_name: "Member", role: "member", type: "human" },
      { id: "user_observer", display_name: "Observer", role: "observer", type: "observer" },
      { id: "agent_1", display_name: "Claude Code Agent", role: "agent", type: "agent" }
    ];

    expect(humanParticipants(participants).map((participant) => participant.id)).toEqual([
      "user_owner",
      "user_member",
      "user_observer"
    ]);
  });
});
```

- [ ] **Step 2: Run the focused failing helper tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-state-helpers.test.ts
```

Expected: FAIL because `humanParticipants` is not exported.

- [ ] **Step 3: Implement human participant helpers**

In `packages/web/src/room-state.ts`, add these exports after `RoomViewState`:

```ts
export function isHumanParticipant(participant: ParticipantView): boolean {
  return participant.role !== "agent" && participant.type !== "agent";
}

export function humanParticipants(participants: ParticipantView[]): ParticipantView[] {
  return participants.filter(isHumanParticipant);
}
```

- [ ] **Step 4: Use human participants in Workspace UI props**

In `packages/web/src/components/Workspace.tsx`, update the import:

```tsx
import { deriveRoomState, humanParticipants, isCollectionActive, isTurnInFlight } from "../room-state.js";
```

After `const isOwner = session.role === "owner";`, add:

```tsx
  const peopleParticipants = useMemo(() => humanParticipants(room.participants), [room.participants]);
```

Update `sidebarProps`:

```tsx
    participants: peopleParticipants,
```

Update `myDisplayName`:

```tsx
  const myDisplayName = peopleParticipants.find((p) => p.id === session.participant_id)?.display_name;
```

Update the header prop:

```tsx
            participantCount={peopleParticipants.length}
```

- [ ] **Step 5: Run focused helper tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-state-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run Workspace-adjacent tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- room-state.test.ts room-state-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add packages/web/src/room-state.ts packages/web/src/components/Workspace.tsx packages/web/test/room-state-helpers.test.ts
git commit -m "fix(web): count only human room participants"
```

---

## Task 3: Mask Local Connector Connection Code

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Test: `packages/web/test/cloud-connector.test.tsx`

- [ ] **Step 1: Replace connector test with masking and clipboard expectations**

Replace the contents of `packages/web/test/cloud-connector.test.tsx` with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Sidebar, { maskConnectionCode } from "../src/components/Sidebar.js";

const fullConnectionCode = "CACP-CONNECT:v1:eyJzZXJ2ZXJfdXJsIjoiaHR0cHM6Ly9jYWNwLnp1Y2hvbmdhaS5jb20iLCJwYWlyaW5nX3Rva2VuIjoiY2FjcF9wYWlyIiwicm9vbV9pZCI6InJvb21fMSIsImFnZW50X3R5cGUiOiJjbGF1ZGUtY29kZSIsInBlcm1pc3Npb25fbGV2ZWwiOiJmdWxsX2FjY2VzcyIsImV4cGlyZXNfYXQiOiIyMDI2LTA0LTI3VDE2OjMwOjAwLjAwMFoifQ";

function renderSidebar(writeText = vi.fn(async () => undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });

  render(
    <Sidebar
      agents={[]}
      participants={[]}
      inviteCount={0}
      joinRequests={[]}
      isOwner={true}
      canManageRoom={true}
      onSelectAgent={() => {}}
      onCreateInvite={async () => undefined}
      onApproveJoinRequest={() => {}}
      onRejectJoinRequest={() => {}}
      onRemoveParticipant={() => {}}
      cloudMode={true}
      createdPairing={{
        connection_code: fullConnectionCode,
        download_url: "/downloads/CACP-Local-Connector.exe",
        expires_at: "2026-04-27T16:30:00.000Z"
      }}
    />
  );

  return { writeText };
}

describe("cloud connector UI", () => {
  it("masks the connector code instead of rendering the full secret", () => {
    renderSidebar();

    expect(screen.getByText("Local Connector")).toBeInTheDocument();
    expect(screen.getByText("Download connector")).toBeInTheDocument();
    expect(screen.getByText("Copy connection code")).toBeInTheDocument();
    expect(screen.queryByText(fullConnectionCode)).not.toBeInTheDocument();
    expect(screen.getByText(maskConnectionCode(fullConnectionCode))).toBeInTheDocument();
  });

  it("copies the full connector code and shows copied feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    renderSidebar(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(writeText).toHaveBeenCalledWith(fullConnectionCode);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("masks short connection codes deterministically", () => {
    expect(maskConnectionCode("abc123")).toBe("••••abc123");
  });
});
```

- [ ] **Step 2: Run the focused failing connector tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- cloud-connector.test.tsx
```

Expected: FAIL because `maskConnectionCode` is not exported, the full code is visible, and copy feedback is missing.

- [ ] **Step 3: Add connector copy i18n messages**

Add this key in `packages/web/src/i18n/messages.en.json` near the connector keys:

```json
  "sidebar.connectionCodePreview": "Connection code preview",
  "sidebar.connectionCodeCopied": "Copied",
```

Add this key in `packages/web/src/i18n/messages.zh.json` near the connector keys:

```json
  "sidebar.connectionCodePreview": "连接码预览",
  "sidebar.connectionCodeCopied": "已复制",
```

- [ ] **Step 4: Implement masking and copied state**

In `packages/web/src/components/Sidebar.tsx`, add this exported helper near `roleDisplay`:

```tsx
export function maskConnectionCode(code: string): string {
  if (code.length <= 12) return `••••${code}`;
  const parts = code.split(":");
  const prefix = parts.length >= 2 ? parts.slice(0, 2).join(":") : code.slice(0, 8);
  return `${prefix}:••••••••${code.slice(-6)}`;
}
```

Add copied state below `inviteTtl`:

```tsx
  const [connectorCopied, setConnectorCopied] = useState(false);
```

Replace `handleCopyConnector` with:

```tsx
  const handleCopyConnector = useCallback(() => {
    if (createdPairing) {
      navigator.clipboard.writeText(createdPairing.connection_code).then(() => {
        setConnectorCopied(true);
        window.setTimeout(() => setConnectorCopied(false), 2000);
      }).catch(() => {});
    }
  }, [createdPairing]);
```

Replace the connector `<code>` block body with a masked preview and label:

```tsx
              <span style={{ display: "block", marginBottom: 4, color: "var(--ink-4)" }}>
                {t("sidebar.connectionCodePreview")}
              </span>
              {maskConnectionCode(createdPairing.connection_code)}
```

Replace the copy button label:

```tsx
              {connectorCopied ? t("sidebar.connectionCodeCopied") : t("sidebar.copyConnectionCode")}
```

- [ ] **Step 5: Run focused connector tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- cloud-connector.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add packages/web/src/components/Sidebar.tsx packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/cloud-connector.test.tsx
git commit -m "feat(web): mask local connector code"
```

---

## Task 4: Join Request Modal Component

**Files:**
- Create: `packages/web/src/components/JoinRequestModal.tsx`
- Modify: `packages/web/src/i18n/messages.en.json`
- Modify: `packages/web/src/i18n/messages.zh.json`
- Modify: `packages/web/src/App.css`
- Test: `packages/web/test/join-request-modal.test.tsx`

- [ ] **Step 1: Add failing modal component tests**

Create `packages/web/test/join-request-modal.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import JoinRequestModal from "../src/components/JoinRequestModal.js";

const request = {
  request_id: "join_req_1",
  display_name: "Bob",
  status: "pending" as const,
  created_at: "2026-04-27T12:00:00.000Z"
};

function renderModal(props: Partial<ComponentProps<typeof JoinRequestModal>> = {}) {
  const onApprove = props.onApprove ?? vi.fn();
  const onReject = props.onReject ?? vi.fn();
  const onLater = props.onLater ?? vi.fn();
  render(
    <LangProvider>
      <JoinRequestModal
        request={request}
        remainingCount={0}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
        {...props}
      />
    </LangProvider>
  );
  return { onApprove, onReject, onLater };
}

describe("JoinRequestModal", () => {
  it("renders the pending requester with clear actions", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Join request" })).toBeInTheDocument();
    expect(screen.getByText("Bob wants to join this room.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });

  it("calls approve reject and later callbacks with the request id", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    renderModal({ onApprove, onReject, onLater });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(onApprove).toHaveBeenCalledWith("join_req_1");
    expect(onReject).toHaveBeenCalledWith("join_req_1");
    expect(onLater).toHaveBeenCalledWith("join_req_1");
  });

  it("renders nothing when no request is provided", () => {
    const { container } = render(
      <LangProvider>
        <JoinRequestModal request={undefined} remainingCount={0} onApprove={() => {}} onReject={() => {}} onLater={() => {}} />
      </LangProvider>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("mentions additional pending requests", () => {
    renderModal({ remainingCount: 2 });

    expect(screen.getByText("2 more requests are waiting.")).toBeInTheDocument();
  });
});
```


- [ ] **Step 2: Run the focused failing modal tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- join-request-modal.test.tsx
```

Expected: FAIL because `JoinRequestModal` does not exist.

- [ ] **Step 3: Add join request modal i18n messages**

Add these keys in `packages/web/src/i18n/messages.en.json` near the join request keys:

```json
  "joinRequestModal.title": "Join request",
  "joinRequestModal.body": "{name} wants to join this room.",
  "joinRequestModal.more": "{count} more requests are waiting.",
  "joinRequestModal.later": "Later",
```

Add these keys in `packages/web/src/i18n/messages.zh.json` near the join request keys:

```json
  "joinRequestModal.title": "加入申请",
  "joinRequestModal.body": "{name} 想加入这个房间。",
  "joinRequestModal.more": "还有 {count} 个申请等待处理。",
  "joinRequestModal.later": "稍后处理",
```

- [ ] **Step 4: Create JoinRequestModal component**

Create `packages/web/src/components/JoinRequestModal.tsx`:

```tsx
import type { JoinRequestView } from "../room-state.js";
import { useT } from "../i18n/useT.js";

export interface JoinRequestModalProps {
  request?: JoinRequestView;
  remainingCount: number;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onLater: (requestId: string) => void;
}

export default function JoinRequestModal({ request, remainingCount, onApprove, onReject, onLater }: JoinRequestModalProps) {
  const t = useT();
  if (!request) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <section className="join-request-modal" role="dialog" aria-modal="true" aria-label={t("joinRequestModal.title")}>
        <p className="landing-eyebrow" style={{ marginBottom: 8 }}>{t("joinRequestModal.title")}</p>
        <h3>{t("joinRequestModal.body", { name: request.display_name })}</h3>
        {remainingCount > 0 && (
          <p className="join-request-modal-subcopy">{t("joinRequestModal.more", { count: remainingCount })}</p>
        )}
        <div className="join-request-modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => onApprove(request.request_id)}>
            {t("sidebar.approve")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onReject(request.request_id)}>
            {t("sidebar.reject")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onLater(request.request_id)}>
            {t("joinRequestModal.later")}
          </button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Add modal styles**

In `packages/web/src/App.css`, add this block before `/* Network banner */`:

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(28, 24, 19, 0.32);
}

.join-request-modal {
  width: min(420px, 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius-frame);
  background: var(--surface);
  padding: 22px;
  box-shadow: 0 18px 50px rgba(28, 24, 19, 0.18);
}

.join-request-modal h3 {
  font-size: 20px;
  margin-bottom: 10px;
}

.join-request-modal-subcopy {
  color: var(--ink-3);
  font-size: 13px;
  margin-bottom: 16px;
}

.join-request-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
```

- [ ] **Step 6: Run focused modal component tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- join-request-modal.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
git add packages/web/src/components/JoinRequestModal.tsx packages/web/src/App.css packages/web/src/i18n/messages.en.json packages/web/src/i18n/messages.zh.json packages/web/test/join-request-modal.test.tsx
git commit -m "feat(web): add join request modal"
```

---

## Task 5: Wire Join Request Modal Into Workspace

**Files:**
- Modify: `packages/web/src/components/Workspace.tsx`
- Test: `packages/web/test/workspace-join-request-modal.test.tsx`

- [ ] **Step 1: Add failing Workspace modal integration tests**

Create `packages/web/test/workspace-join-request-modal.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import type { ComponentProps } from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Workspace from "../src/components/Workspace.js";
import type { RoomSession } from "../src/api.js";

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_owner"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-27T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

function renderWorkspace(role: RoomSession["role"], callbacks: Partial<ComponentProps<typeof Workspace>> = {}) {
  const session: RoomSession = {
    room_id: "room_1",
    token: "token_1",
    participant_id: "user_owner",
    role
  };
  const props: ComponentProps<typeof Workspace> = {
    session,
    events: [
      event("room.created", { name: "Room" }, 1),
      event("participant.joined", { participant: { id: "user_owner", display_name: "Owner", role: "owner", type: "human" } }, 2),
      event("join_request.created", { request_id: "join_req_1", display_name: "Bob" }, 3)
    ],
    onLeaveRoom: () => {},
    onClearRoom: () => {},
    onSendMessage: () => {},
    onStartCollection: () => {},
    onSubmitCollection: () => {},
    onCancelCollection: () => {},
    onSelectAgent: () => {},
    onCreateInvite: async () => undefined,
    onApproveJoinRequest: () => {},
    onRejectJoinRequest: () => {},
    onRemoveParticipant: () => {},
    ...callbacks
  };

  render(
    <LangProvider>
      <Workspace {...props} />
    </LangProvider>
  );
}

describe("Workspace join request modal", () => {
  it("shows a pending join request modal to the room owner", () => {
    renderWorkspace("owner");

    expect(screen.getByRole("dialog", { name: "Join request" })).toBeInTheDocument();
    expect(screen.getByText("Bob wants to join this room.")).toBeInTheDocument();
  });

  it("does not show the modal to non-owners", () => {
    renderWorkspace("member");

    expect(screen.queryByRole("dialog", { name: "Join request" })).not.toBeInTheDocument();
  });

  it("approves and rejects from the modal", () => {
    const onApproveJoinRequest = vi.fn();
    const onRejectJoinRequest = vi.fn();
    renderWorkspace("owner", { onApproveJoinRequest, onRejectJoinRequest });

    const dialog = screen.getByRole("dialog", { name: "Join request" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));

    expect(onApproveJoinRequest).toHaveBeenCalledWith("join_req_1");
    expect(onRejectJoinRequest).toHaveBeenCalledWith("join_req_1");
  });

  it("dismisses the modal locally while keeping the sidebar request", () => {
    renderWorkspace("owner");

    fireEvent.click(within(screen.getByRole("dialog", { name: "Join request" })).getByRole("button", { name: "Later" }));

    expect(screen.queryByRole("dialog", { name: "Join request" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByText("Join Requests")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the focused failing Workspace integration tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- workspace-join-request-modal.test.tsx
```

Expected: FAIL because `Workspace` does not render `JoinRequestModal`.

- [ ] **Step 3: Wire modal state in Workspace**

In `packages/web/src/components/Workspace.tsx`, add the import:

```tsx
import JoinRequestModal from "./JoinRequestModal.js";
```

Add dismissed state below the existing `showSlowStreamingNotice` state:

```tsx
  const [dismissedJoinRequestIds, setDismissedJoinRequestIds] = useState<Set<string>>(() => new Set());
```

Add this derived modal request after `sidebarProps`:

```tsx
  const visibleJoinRequest = useMemo(() => {
    if (!isOwner) return undefined;
    return room.joinRequests.find((request) => !dismissedJoinRequestIds.has(request.request_id));
  }, [dismissedJoinRequestIds, isOwner, room.joinRequests]);

  const remainingJoinRequestCount = visibleJoinRequest
    ? room.joinRequests.filter((request) => request.request_id !== visibleJoinRequest.request_id && !dismissedJoinRequestIds.has(request.request_id)).length
    : 0;
```

Add cleanup when pending requests change:

```tsx
  useEffect(() => {
    const pendingIds = new Set(room.joinRequests.map((request) => request.request_id));
    setDismissedJoinRequestIds((current) => {
      const next = new Set([...current].filter((requestId) => pendingIds.has(requestId)));
      return next.size === current.size ? current : next;
    });
  }, [room.joinRequests]);
```

Add the modal before `<MobileDrawer ... />`:

```tsx
      <JoinRequestModal
        request={visibleJoinRequest}
        remainingCount={remainingJoinRequestCount}
        onApprove={onApproveJoinRequest}
        onReject={onRejectJoinRequest}
        onLater={(requestId) => setDismissedJoinRequestIds((current) => new Set(current).add(requestId))}
      />
```

- [ ] **Step 4: Run focused Workspace integration tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test -- workspace-join-request-modal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add packages/web/src/components/Workspace.tsx packages/web/test/workspace-join-request-modal.test.tsx
git commit -m "feat(web): prompt owners for join requests"
```

---

## Task 6: Full Web Regression and Final Validation

**Files:**
- Modify only if tests reveal stale expectations: `packages/web/test/*.test.ts`, `packages/web/src/**/*.tsx`, `packages/web/src/**/*.ts`

- [ ] **Step 1: Run all web tests**

Run:

```powershell
corepack pnpm --filter @cacp/web test
```

Expected: PASS. If a test fails because it expected `Alice` as the default name or expected the full connector code to be visible, update that test to match the approved design.

- [ ] **Step 2: Run full workspace validation**

Run:

```powershell
corepack pnpm check
```

Expected: PASS across protocol, cli-adapter, server, and web.

- [ ] **Step 3: Verify the full connection code is not rendered in source snapshots**

Run:

```powershell
Select-String -Path packages\web\src\components\Sidebar.tsx -Pattern 'createdPairing\.connection_code\}' -CaseSensitive
```

Expected: no matches. The file should only pass `createdPairing.connection_code` to clipboard copy and `maskConnectionCode()`.

- [ ] **Step 4: Verify connector binary still exists before any deployment**

Run:

```powershell
Test-Path .\packages\web\public\downloads\CACP-Local-Connector.exe
```

Expected: `True`. This task does not rebuild the connector, but deployment still depends on carrying the Windows-built binary into `packages/web/dist/downloads/`.

- [ ] **Step 5: Commit final regression cleanup if any files changed**

If Step 1 or Step 2 required additional fixes, commit them:

```powershell
git add packages/web
git commit -m "test(web): update room ux polish regressions"
```

If no files changed, confirm the tree is clean:

```powershell
git status --short
```

Expected: no output.

---

## Final Review Checklist

Before reporting completion, verify each acceptance criterion from `docs/superpowers/specs/2026-04-27-room-ux-polish-design.md`:

- Local Connector remains in the sidebar.
- The full connection code is not visible in the UI.
- Copy still writes the full connection code to the clipboard.
- Header and People list count humans only.
- Owner gets a modal for pending join requests.
- Later dismisses the modal but leaves the sidebar request.
- Create and join display-name fields start empty and remain required.
- Landing footer includes both contact email addresses.
- `corepack pnpm check` passes.
