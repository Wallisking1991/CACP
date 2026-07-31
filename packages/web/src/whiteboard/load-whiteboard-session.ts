import type { WhiteboardSessionFactoryLoader } from "./whiteboard-session.js";

export const loadWhiteboardSession: WhiteboardSessionFactoryLoader =
  async () => {
    const { createWhiteboardSession } = await import("./whiteboard-session.js");
    return createWhiteboardSession;
  };
