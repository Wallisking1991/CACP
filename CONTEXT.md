# CACP Collaboration Context

CACP coordinates a temporary collaborative room between people and locally running AI agents. This glossary defines the room-lifecycle language shared by the protocol, server, connector, and web client.

## Language

**Live Room**:
A room whose collaboration lifetime is active. A dissolved room cannot be resumed, including after the room server restarts.
_Avoid_: Persistent room, archived room

**Room Attachment**:
A temporary binary asset shared with authorized participants in a Live Room. It has no independent lifetime beyond that room.
_Avoid_: Permanent file, durable asset

**Materialized Attachment**:
A verified temporary local copy of a Room Attachment prepared by the Local Connector for a Local Tool Agent. It has no lifetime beyond the Live Room and is not a source file in the user's project.
_Avoid_: Project file, permanent download

**Main Input**:
A participant submission from the main composer that appears in the shared timeline and is queued for or dispatched to the selected Local Tool Agent. It contains an explicit text instruction and may include Room Attachment references.
_Avoid_: Orbit note, upload

**Agent Input Capability**:
A declared contract describing how a Local Tool Agent can consume an input kind, such as a native image, native document, or Materialized Attachment. It determines visible validation and fallback before a Main Input is dispatched.
_Avoid_: Provider guess, silent fallback

**Local Tool Agent**:
An AI coding agent that runs on the user's machine through the Local Connector and may use local tools subject to room permissions. CACP currently supports Claude Code, Codex, GitHub Copilot, and Kimi Code as Local Tool Agents.
_Avoid_: LLM API Agent, chat provider
