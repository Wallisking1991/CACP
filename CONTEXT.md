# CACP Collaboration Context

CACP coordinates a temporary collaborative room between people and locally running AI agents. This glossary defines the room-lifecycle language shared by the protocol, server, connector, and web client.

## Language

**Live Room**:
A room whose collaboration lifetime is active. A dissolved room cannot be resumed, including after the room server restarts.
_Avoid_: Persistent room, archived room

**Room Attachment**:
A temporary binary asset referenced by one or more pieces of content in a Live Room. It is deleted when no room content references it or when the room ends, and it has no independent lifetime beyond that room.
_Avoid_: Permanent file, durable asset

**Materialized Attachment**:
A verified temporary local copy of a Room Attachment prepared by the Local Connector for a Local Tool Agent. It has no lifetime beyond the Live Room and is not a source file in the user's project.
_Avoid_: Project file, permanent download

**Orbit Discussion**:
The human-only side conversation within a Live Room where participants exchange lightweight Orbit Notes without directly triggering a Local Tool Agent.
_Avoid_: Main thread, Agent chat

**Orbit Note**:
A participant contribution within an Orbit Discussion that contains text, Room Attachments, or both. It may be replied to, reacted to, or promoted with its attachments into a Main Input.
_Avoid_: Main Input, message

**Orbit Promotion**:
An owner- or admin-initiated, atomic, note-terminal conversion of selected, unpromoted Orbit Notes and explicitly selected Room Attachments into one Main Input, making those attachments available to the selected Local Tool Agent. Attachments default to selected; an added Agent instruction is optional when selected Notes contain text and required when they do not; the promotion succeeds only when the complete resulting Agent input is valid.
_Avoid_: Partial promotion, silent attachment fallback

**Collaborative Whiteboard**:
A single real-time spatial workspace within a Live Room where authorized human participants create and arrange shared visual content. It shares the Live Room's lifetime and reaches a Local Tool Agent only through an explicit Main Input.
_Avoid_: Canvas, persistent board, Agent workspace

**Main Input**:
A participant submission from the main composer that appears in the shared timeline and is queued for or dispatched to the selected Local Tool Agent. It contains an explicit text instruction and may include Room Attachment references.
_Avoid_: Orbit note, upload

**Agent Input Capability**:
A declared contract describing how a Local Tool Agent can consume an input kind, such as a native image, native document, or Materialized Attachment. It determines visible validation and fallback before a Main Input is dispatched, but does not restrict human sharing within an Orbit Discussion.
_Avoid_: Provider guess, silent fallback

**Agent Attachment Grant**:
Authorization created by a Main Input for only the Local Tool Agent selected to receive that input to retrieve its Room Attachments. Changing the selected Agent does not transfer existing grants.
_Avoid_: Room-wide Agent access, inherited attachment access

**Local Tool Agent**:
An AI coding agent that runs on the user's machine through the Local Connector and may use local tools subject to room permissions. CACP currently supports Claude Code, Codex, GitHub Copilot, and Kimi Code as Local Tool Agents.
_Avoid_: LLM API Agent, chat provider
