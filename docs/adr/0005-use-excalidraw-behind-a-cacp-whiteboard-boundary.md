---
status: accepted
---

# Use Excalidraw behind a CACP-owned collaborative whiteboard boundary

CACP will embed Excalidraw as the editor for one Collaborative Whiteboard per
Live Room, retaining its default editing experience behind a thin CACP adapter.
CACP continues to own room authorization, real-time coordination, temporary
snapshots, Room Attachment references, and explicit delivery of selected
whiteboard content into a Main Input; all whiteboard state ends with the Live
Room.

Excalidraw was selected over tldraw to avoid a production license key and over
draw.io because its freeform ideation experience and React integration better
fit the room. This trades a ready-made synchronization SDK for CACP-owned
coordination while preserving the product's local-first lifecycle, permissions,
and explicit Agent-disclosure boundary.
