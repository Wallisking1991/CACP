# Collaborative Whiteboard

Date: 2026-07-31  
Status: ready-for-agent  
Related decision: ADR-0005

## Problem Statement

A Live Room currently provides a linear main conversation and an optional Orbit
discussion panel, but participants do not have a shared spatial surface for
sketching, grouping ideas, annotating images, or turning a visual result into an
Agent task. Participants must leave CACP or exchange static files to do that
work. This breaks the room's shared context and makes it unclear which visual
artifact is current.

The room needs one real-time Collaborative Whiteboard that feels like a complete
freeform editor while preserving CACP's existing authority model. Human
participants should be able to switch locally between the conversation and the
whiteboard without changing anyone else's view. The board must remain scoped to
the Live Room, must not become a second route around Main Input governance, and
must remain useful during temporary connection failures.

## Solution

Add a `主对话 | 白板` workspace switcher and embed Excalidraw behind a thin CACP
adapter. Entering the whiteboard keeps the room header visible, replaces the
thread, queue, and composer with an infinite canvas, and locally hides Orbit.
Returning to the conversation restores the participant's previous conversation
and Orbit state.

Each Live Room has one lazily created whiteboard shared by its authorized human
participants. Owners, admins, and members can edit; observers can view, pan, and
zoom; Local Tool Agents cannot connect to or operate the board. The server owns
authorization, current scene revision, transient collaboration state, temporary
snapshots, attachment references, and room-lifetime cleanup. Excalidraw owns the
editing experience, scene semantics, and its established keyboard and export
behaviors.

Whiteboard collaboration uses a dedicated authenticated, room-scoped session so
high-frequency scene and presence traffic does not enter the durable room event
history. The current scene and a bounded set of temporary snapshots survive
browser refresh and participant reconnect, but are discarded when the room ends
or the server restarts. Images use Room Attachments rather than base64 scene
payloads.

An owner or admin can explicitly promote selected elements or a Frame into the
main conversation. CACP exports a PNG, retains the selected `.excalidraw`
source, asks for an instruction and confirmation, and creates a normal Main
Input. Only that explicit Main Input grants the selected Local Tool Agent access
to the promoted attachments; promotion does not automatically start Agent work.

## User Stories

1. As a human participant, I want a clearly labeled whiteboard control in the
   room header so that I can discover the visual workspace without leaving the
   Live Room.

2. As a participant, I want switching between the main conversation and the
   whiteboard to affect only my own workspace so that I do not disrupt what
   other participants are viewing.

3. As a participant, I want my conversation scroll position, draft, queue
   context, and Orbit visibility restored when I leave the whiteboard so that
   visual work does not interrupt my text workflow.

4. As a participant, I want the room header to remain visible above the
   whiteboard so that room identity, connection state, and workspace navigation
   remain available.

5. As an owner, admin, or member, I want Excalidraw's normal drawing, text,
   shape, connector, selection, grouping, Frame, zoom, and keyboard workflows so
   that the whiteboard feels complete rather than like a limited annotation
   widget.

6. As an observer, I want to see the live board and use pan and zoom without
   being able to mutate it so that I can follow the discussion safely.

7. As a Local Tool Agent, I must not be able to connect to, inspect, or mutate
   the whiteboard directly so that the whiteboard does not bypass Main Input
   authority.

8. As an editor, I want my accepted changes to appear for other connected
   participants in near real time so that we can develop one shared visual
   model.

9. As a late joiner or reconnecting participant, I want to receive the latest
   complete scene before live updates so that my board converges without
   replaying an unbounded edit history.

10. As a collaborator, I want to see active participants, their cursor,
    display name, avatar color, and current selection so that I can understand
    who is working where.

11. As a collaborator, I want to select an active participant's avatar and jump
    my viewport to their current area so that I can quickly follow their work.

12. As a participant, I want cursor, selection, and viewport presence to
    disappear after disconnection and never replay as history so that stale
    collaborators do not remain on the board.

13. As an editor, I want undo and redo to affect my own local operations, not
    another participant's edits, so that collaboration does not make history
    controls destructive or surprising.

14. As a participant, I want concurrent changes to different elements to merge
    and the latest accepted version of the same element to converge everywhere
    so that ordinary collaboration remains predictable.

15. As an editor, I want to paste, drag, or upload an image onto the board so
    that screenshots and visual references can participate in the discussion.

16. As a participant, I want image bytes stored as protected Room Attachments
    and loaded only by authorized room participants so that scene messages stay
    bounded and attachment access remains governed.

17. As a participant, I want PNG, SVG, and `.excalidraw` export before the room
    ends so that I can preserve useful work outside the room when needed.

18. As an owner or admin, I want to select elements or a Frame and choose
    “发送到主对话” so that a visual result can enter the governed Agent workflow.

19. As an owner or admin, I want promotion to show a preview, accept an
    instruction, identify the target Agent, and require confirmation so that I
    know exactly what will become Main Input.

20. As an owner or admin, I want promotion to attach both a rendered PNG and
    the selected `.excalidraw` source so that the Agent receives a useful visual
    while humans retain an editable source artifact.

21. As an owner or admin, I want promoted files to use the existing Agent
    capability and attachment-grant checks so that incompatible inputs fail
    visibly instead of silently bypassing connector constraints.

22. As a room participant, I want promotion to create the same queued Main
    Input and room-visible notification as other governed input so that the
    action is auditable and does not automatically trigger Agent execution.

23. As a collaborator, I want one board per Live Room and Frames for organizing
    topics so that participants do not have to discover or manage a second board
    hierarchy.

24. As an owner or admin, I want lightweight temporary snapshots of the whole
    board so that I can recover from a destructive edit during the live
    discussion.

25. As an owner or admin, I want clear and restore actions to show the target
    revision and require confirmation so that whole-board changes are
    deliberate.

26. As an owner or admin, I want CACP to create a snapshot immediately before a
    clear or restore so that the prior state remains recoverable within the
    room's snapshot window.

27. As a member, I want to edit ordinary scene content but not clear the whole
    board or restore snapshots so that high-impact recovery actions remain under
    owner or admin control.

28. As a participant, I want a blank infinite canvas on first entry with a
    short local-only onboarding hint so that the default experience is
    uncluttered and does not add shared content.

29. As an editor, I want a small set of optional built-in templates so that I
    can start common brainstorming layouts without depending on an external
    marketplace.

30. As a participant reading the main conversation, I want the whiteboard
    control to show active editor count and a quiet activity dot so that I can
    notice meaningful board work without per-edit messages or sounds.

31. As a participant working on the board, I want a quiet unread indicator for
    new main-conversation activity so that I can return when the discussion
    moves on.

32. As a participant, I want entering the whiteboard to clear its local activity
    dot so that the indicator represents unseen activity rather than permanent
    room state.

33. As a participant, I want explicit promotion and whole-board restore to
    produce room notifications while routine edits remain silent so that only
    consequential actions interrupt the conversation.

34. As an editor who loses connectivity, I want the board to become temporarily
    read-only while preserving pan, zoom, and export so that I do not create
    unsynchronized edits.

35. As an editor who reconnects, I want a fresh authoritative scene to finish
    synchronizing before editing resumes so that stale local state cannot
    overwrite newer work.

36. As a participant whose room has ended, I want the last loaded scene to stay
    read-only and exportable in my browser while the server rejects further
    collaboration so that I have a final chance to save it.

37. As a room owner, I want the server to delete the scene, snapshots, presence,
    and whiteboard-only attachment references when the Live Room ends so that
    the board follows room ephemerality.

38. As an operator, I want a server restart to discard all whiteboard runtime
    state so that the feature does not accidentally introduce durable room
    storage.

39. As a desktop or tablet editor, I want the complete whiteboard tools and
    collaboration chrome so that larger screens support sustained visual work.

40. As a phone editor, I want a full-screen canvas with basic draw, text,
    selection, pan, zoom, and a compact bottom menu for advanced actions so that
    the board remains usable on a small touch screen.

41. As a keyboard or assistive-technology user, I want labeled controls, visible
    focus, logical focus restoration, non-color-only status, and accessible
    confirmation dialogs so that the workspace switch and CACP-owned actions are
    operable without a mouse.

42. As a privacy-conscious room owner, I want Excalidraw cloud, public share,
    and external collaboration entry points removed from the embedded editor so
    that participants cannot bypass CACP identity and room controls.

43. As a participant, I want Excalidraw's own editor menus, context menu,
    shortcuts, and local export tools otherwise preserved so that CACP does not
    fork or relearn a mature editor interaction model.

## Implementation Decisions

### Architecture and ownership

- Implement a deep `Collaborative Whiteboard` module with a small
  `WhiteboardSession` interface. Its callers deal in current scene, connection
  status, collaborators, role capabilities, snapshots, and promotion; they do
  not depend on Excalidraw callbacks or wire-message details.
- Place Excalidraw behind a `WhiteboardEditorAdapter`. The production adapter
  translates between Excalidraw scene changes and the CACP session model. An
  in-memory fake implements the same interface for workspace tests. This is a
  real architectural seam, not a test-only abstraction.
- Treat Excalidraw as a pinned dependency and preserve its default editor
  behavior. CACP may configure and wrap public APIs, but must not fork the
  editor or copy its internal collaboration implementation.
- Keep CACP responsible for authentication, authorization, transport, scene
  convergence, attachment access, snapshots, promotion, notifications, and
  Live Room cleanup.
- Lazy-load the editor and whiteboard client module on first entry so that rooms
  that only use conversation do not pay the editor bundle and initialization
  cost.

### Workspace interaction

- Add an accessible two-state `主对话 | 白板` switch to the room header. The
  selected workspace is local UI state and is not broadcast.
- Keep the existing conversation subtree mounted, or preserve and restore all
  user-owned state explicitly, so that switching does not lose the composer
  draft, scroll position, queued-input context, or focus return target.
- In whiteboard mode, retain the room header, replace the thread, status, queue,
  and composer regions with the board, and hide Orbit locally. Restore the
  participant's previous Orbit state on return.
- Compose the embedded editor with CACP-owned chrome for the workspace switch,
  connection state, participant strip, snapshot actions, promotion, and mobile
  overflow. Do not duplicate standard drawing tools already provided by
  Excalidraw.
- Remove or disable Excalidraw controls that initiate public sharing, vendor
  cloud storage, or a parallel collaboration session.
- Maintain local activity cursors separately for conversation and whiteboard.
  Routine whiteboard traffic updates only the editor count and unseen-activity
  dot. Promotion and full restore publish low-frequency room notifications.
- Use touch targets of at least 44 by 44 CSS pixels for CACP-owned mobile
  controls, preserve pinch zoom and two-finger pan, and move advanced CACP
  actions into a labeled bottom-sheet menu on narrow viewports.

### Permissions and lifecycle

- Derive whiteboard capabilities from the canonical room role:
  `owner/admin/member` may edit, `observer` may view/pan/zoom/export, and `agent`
  has no whiteboard session capability. Only `owner/admin` may clear, restore,
  or promote content.
- Enforce every capability on the server. Client read-only configuration and
  hidden controls are usability measures, not authorization boundaries.
- Create the empty scene lazily for the first authorized human connection.
  Maintain current scene, revision, presence, and snapshots only in room-scoped
  server runtime memory.
- Add whiteboard state to the same room-runtime disposal boundary as Orbit,
  queued runtime work, sockets, and pending attachment bytes. Room end and
  server shutdown discard current scene, snapshot history, presence, deduplication
  records, and whiteboard attachment references.
- A connected client that receives a room-ended signal freezes its last loaded
  scene for local inspection and export. The server refuses reconnects or
  mutations after room end.

### Collaboration protocol

- Define versioned whiteboard wire schemas in the shared Protocol module, but
  keep whiteboard traffic out of the durable `CacpEvent` history and out of
  Local Tool Agent room streams.
- Use a dedicated authenticated, room-scoped WebSocket interface for initial
  synchronization, scene updates, acknowledgements, and transient presence.
  Reuse the existing participant token, origin checks, room-alive checks,
  connection accounting, message-size limits, and server shutdown behavior.
- On connection, send one authoritative full scene snapshot and its monotonically
  increasing revision before live changes. Buffer or reject edits until this
  initial synchronization completes.
- Represent durable scene convergence as throttled element updates plus an
  explicit allowlist of shared scene settings, with a client update identifier
  and the client's base revision. Never synchronize participant-local viewport,
  selection, tool, dialog, or preference state as scene data. Use Excalidraw
  element identifiers and element version metadata to reconcile independent
  changes. The server validates the update, deduplicates retries, applies
  accepted element versions, increments the room revision, acknowledges the
  sender, and broadcasts the accepted result.
- Do not implement a second general-purpose CRDT. Simultaneous conflicting
  changes to one element converge according to the adapter's deterministic
  Excalidraw-compatible version reconciliation; independent elements merge.
- Keep cursor position, selection, viewport, display name, and avatar color in a
  separate throttled presence message. Presence is never included in scene
  snapshots, never persisted, and expires promptly when its connection closes
  or its heartbeat lapses.
- Apply server-side rate, payload-size, element-count, and attachment-count
  limits before scene mutation. Return typed, recoverable protocol errors so
  clients can resynchronize rather than remaining in a divergent state.
- When transport is lost or the server requests resynchronization, configure the
  adapter as read-only immediately. Preserve navigation and local export, fetch
  a new full scene, then re-enable editing only after the authoritative revision
  is installed.
- Prevent feedback loops by tagging remote scene application and ensuring it
  does not generate a new local update or enter the local undo stack.

### Scene data, images, and exports

- Store Excalidraw element and editor scene data as bounded structured payloads.
  Never include binary image bytes or base64 data URLs in scene updates or
  snapshots.
- Extend the Room Attachment reference model with a whiteboard reference kind.
  An accepted image element may refer only to an attachment that belongs to the
  same room and is readable by the participant. The server updates attachment
  references as images enter or leave the authoritative scene.
- Reuse existing upload validation, MIME detection, size limits, protected
  download behavior, and attachment cleanup. Paste and drag-and-drop enter the
  same upload path as explicit file selection.
- Resolve referenced image bytes into Excalidraw files only for authorized
  clients. Export assembles those files locally so PNG, SVG, and
  `.excalidraw` output are self-contained where the selected format permits.
- Direct placement of PDF and office-document pages is not supported. Such
  files may still enter Main Input through existing attachment workflows.

### Undo, snapshots, clear, and restore

- Let the editor adapter manage local undo and redo while excluding remote
  updates. A server restore or forced resynchronization resets incompatible
  local undo history and communicates that fact to the participant.
- Keep a bounded ring of compressed whole-scene snapshots in server memory.
  Bound it by both count and total bytes, and take checkpoints at a throttled
  cadence after meaningful accepted revisions rather than after every pointer
  movement.
- Always capture a pre-operation snapshot before clear or restore. Clear creates
  a new empty authoritative revision; restore copies the selected snapshot into
  a new head revision rather than rewinding revision numbers.
- Require owner/admin authorization and a confirmation carrying the expected
  current revision for clear and restore. Reject a stale confirmation and ask
  the client to review the newer board state.
- Broadcast the new authoritative scene after clear or restore and issue one
  low-frequency room notification naming the actor and action. Do not expose
  snapshots as a permanent audit log.

### Promotion to Main Input

- Add a CACP-owned “发送到主对话” action for an owner/admin selection or Frame.
  The adapter provides a normalized selected scene, rendered PNG preview, and
  `.excalidraw` source without mutating the shared board.
- The confirmation surface requires a non-empty instruction, target Agent,
  visible attachment summary, and explicit submit action. It must show connector
  capability failures before submission.
- Upload the PNG and source as Room Attachments, then use one server-side
  promotion operation to validate the actor, selection metadata, room state,
  attachments, target Agent capability, and expected board revision before
  creating the normal queued Main Input.
- Attachments referenced only by the board remain human-room resources. The
  promotion operation adds Main Input references and an Agent Attachment Grant
  only for the selected target Agent and only after all validation succeeds.
- Reuse Main Input ordering, idempotency, queue behavior, cancellation rules,
  replay, and notifications. Promotion does not call or wake the Agent outside
  that established workflow.
- Make retries idempotent so a network retry cannot create duplicate attachments
  or duplicate Main Inputs.

### Templates, localization, and accessibility

- Start with an empty infinite canvas. Show an unobtrusive, dismissible,
  participant-local onboarding hint that disappears after the first meaningful
  action and never becomes shared scene content.
- Ship only a small, versioned set of built-in CACP templates represented as
  trusted scene fragments. Inserting a template is an ordinary authorized edit
  and may be undone by the inserting participant.
- Provide Chinese and English labels for all CACP-owned controls and statuses.
  Vendor-provided editor localization should follow the participant's existing
  interface locale.
- Restore focus to the workspace switch or prior conversation control after
  modal actions, announce connection and read-only state through an accessible
  status region, and pair every color status with text or iconography.

## Testing Decisions

The feature has two primary test seams and a small real-integration safety net.
Tests exercise external behavior through the same interfaces production callers
use and do not assert Excalidraw's internal component tree.

### Room external-interface seam

- Use the real server builder with an in-memory database, authenticated REST
  calls, and actual WebSocket clients. This follows the existing room-stream,
  Orbit reconnect, Main Input, attachment, and room-ended test style.
- Prove that owner, admin, and member sessions can edit; observers receive scene
  and presence but mutations fail; Agent tokens cannot connect; and hidden
  client controls are not required for enforcement.
- Connect two editors and assert initial snapshot ordering, accepted revision
  monotonicity, independent-element merge, same-element deterministic
  convergence, sender acknowledgement, retry deduplication, and no echo loop.
- Disconnect and reconnect clients and assert that they receive one current
  scene before live changes, while old cursors, selections, and viewports are
  absent.
- Exercise malformed, oversized, over-rate, stale-revision, cross-room
  attachment, and unauthorized messages and assert typed errors, unchanged
  authoritative state, and successful recovery through resynchronization.
- Verify image upload and protected download, whiteboard attachment references,
  reference removal when an element is deleted, export retrieval, and cleanup at
  room end.
- Verify bounded snapshot creation, pre-clear snapshot, owner/admin restore into
  a new revision, stale-confirmation rejection, member denial, and broadcast of
  the restored full scene.
- Exercise promotion as one externally visible operation: validate the PNG and
  source attachments, one queued Main Input, one target Agent grant, idempotent
  retry, expected notification, and no grant or partial input after any failed
  validation.
- End a room and restart the server in separate cases. Assert that scene,
  snapshots, presence, deduplication state, and whiteboard references disappear
  and that subsequent connections or mutations are rejected.
- Assert that routine scene and presence traffic never enters durable room
  event replay and is never delivered to Local Tool Agent streams.

### Workspace and editor-adapter seam

- Render the real workspace with the in-memory `WhiteboardEditorAdapter` and
  user-level interaction helpers, following existing workspace and role
  permission tests.
- Assert that the local switch changes only the current participant's view,
  keeps the header, hides and restores Orbit, and preserves conversation draft,
  scroll position, queued-input context, and focus.
- Drive connection and role changes through `WhiteboardSession` and assert
  editable, observer read-only, disconnected read-only, resynchronizing, and
  room-ended export-only states.
- Drive fake local and remote edits and assert normalized update submission,
  remote application without echo, local-only undo, forced undo reset after
  restore, and collaborator presence rendering.
- Assert the whiteboard editor count and unseen-activity dot while in
  conversation, conversation unread state while on the board, clearing rules,
  and low-frequency promotion/restore notifications.
- Assert image paste, drag, and upload states; accessible upload errors; local
  onboarding; built-in template insertion; and export actions without relying on
  Excalidraw DOM internals.
- Assert promotion selection rules, owner/admin gating, preview, required
  instruction, target capability feedback, confirmation, idempotent pending
  state, success navigation, and failure recovery.
- Cover keyboard navigation, focus restoration, accessible names and statuses,
  non-color-only indicators, desktop/tablet chrome, and phone bottom-menu
  behavior at representative viewport sizes.

### Protocol, adapter, and browser coverage

- Add schema tests for every whiteboard handshake, scene, presence,
  acknowledgement, restore, and error message, including rejection of unknown
  fields, invalid revisions, excessive collections, and invalid attachment
  identifiers.
- Contract-test the production adapter's boundaries: scene normalization,
  Excalidraw-compatible element version reconciliation, image-file mapping,
  selected-scene export, remote-update suppression, and cleanup. Do not retest
  vendor drawing tools or menu behavior.
- Keep a few browser smoke tests using the real server and production Excalidraw
  adapter. In two browser contexts, mount the board, draw text and a shape,
  observe the result and presence remotely, reconnect, export, and promote a
  Frame. Add one narrow touch-viewport smoke test for entering, basic drawing,
  and returning to conversation.
- Prefer behavioral assertions over snapshots of generated markup or CSS.
  Existing conversation and Orbit tests remain regression coverage for the
  unchanged workspace.

## Out of Scope

- More than one whiteboard per Live Room, nested boards, cross-room boards, or a
  permanent board archive.
- Persisting whiteboard scene or snapshots across server restart or after room
  end.
- Direct Local Tool Agent reading, watching, cursor participation, drawing, or
  mutation of the board.
- Automatic Agent execution based on edits, Frames, templates, or snapshots.
- Offline editing, speculative disconnected changes, or later merging of
  offline branches.
- A general-purpose CRDT or guaranteed semantic merging of simultaneous edits
  to the same Excalidraw element.
- Direct PDF or office-document page placement on the canvas.
- External template or Excalidraw library marketplaces.
- Public share links, Excalidraw cloud storage, vendor-hosted collaboration, or
  anonymous whiteboard access.
- A custom drawing engine, a fork of Excalidraw, or production integration of
  draw.io or tldraw.
- Permanent snapshot history, named versions, diff views, moderation audit
  replay, or restoring only part of a snapshot.
- Presenting whiteboard edits as per-operation main-conversation messages,
  sounds, or notifications.

## Further Notes

- ADR-0005 records the choice of Excalidraw and the thin CACP integration
  boundary. ADR-0001 still requires human authority over Agent input, and
  ADR-0004 still requires time-bounded Agent Attachment Grants.
- The implementation should begin with a tracer-bullet collaboration slice
  through the `WhiteboardSession` boundary: two authorized humans, one scene
  element, reconnect, and room cleanup. Image assets, snapshots, promotion, and
  mobile refinement can then extend the same seam without widening workspace
  coupling.
- Pin an Excalidraw release compatible with the repository's React version,
  retain required license and attribution notices, and record any vendor API
  assumptions in the adapter rather than throughout the workspace.
- Exact rate limits, snapshot count, snapshot byte budget, scene-size limit, and
  presence frequency should be centralized server configuration with safe
  defaults and focused boundary tests. They are operational tuning values, not
  client-owned policy.
- Because the whiteboard channel is separate from the durable room protocol,
  connectors that do not know about whiteboards continue unchanged. Any
  low-frequency room notifications must still use schemas understood by the
  existing room event pipeline.

## Comments

- 2026-07-31: Published from the completed design discussion after confirming
  the room external-interface and editor-adapter test seams.
