import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

interface RoomSession {
  room_id: string;
  token: string;
  participant_id: string;
  role: "owner" | "member";
}

interface JsonResponse {
  [key: string]: unknown;
}

async function postJson(
  request: APIRequestContext,
  path: string,
  data: JsonResponse,
  token?: string
): Promise<JsonResponse> {
  const response = await request.post(path, {
    data,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as JsonResponse;
}

async function createRoomSessions(
  request: APIRequestContext
): Promise<{ owner: RoomSession; member: RoomSession }> {
  const room = await postJson(request, "/rooms", {
    name: "Whiteboard browser smoke",
    display_name: "Owner",
  });
  const roomId = String(room.room_id);
  const ownerToken = String(room.owner_token);
  const owner: RoomSession = {
    room_id: roomId,
    token: ownerToken,
    participant_id: String(room.owner_id),
    role: "owner",
  };
  const invite = await postJson(
    request,
    `/rooms/${roomId}/invites`,
    { role: "member" },
    ownerToken
  );
  const join = await postJson(request, `/rooms/${roomId}/join-requests`, {
    invite_token: String(invite.invite_token),
    display_name: "Member",
  });
  await postJson(
    request,
    `/rooms/${roomId}/join-requests/${String(join.request_id)}/approve`,
    {},
    ownerToken
  );
  const statusResponse = await request.get(
    `/rooms/${roomId}/join-requests/${String(join.request_id)}`,
    {
      params: { request_token: String(join.request_token) },
    }
  );
  expect(statusResponse.ok(), await statusResponse.text()).toBe(true);
  const status = (await statusResponse.json()) as JsonResponse;
  const member: RoomSession = {
    room_id: roomId,
    token: String(status.participant_token),
    participant_id: String(status.participant_id),
    role: "member",
  };
  return { owner, member };
}

async function seedSession(
  context: BrowserContext,
  session: RoomSession
): Promise<void> {
  await context.addInitScript((storedSession) => {
    localStorage.setItem(
      "cacp.sessions",
      JSON.stringify({ [storedSession.room_id]: storedSession })
    );
  }, session);
}

async function uploadImageAttachment(
  request: APIRequestContext,
  session: RoomSession
): Promise<string> {
  const response = await request.post(`/rooms/${session.room_id}/attachments`, {
    headers: { authorization: `Bearer ${session.token}` },
    multipart: {
      file: {
        name: "pixel.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        ),
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as {
    attachment?: { attachment_id?: unknown };
  };
  return String(body.attachment?.attachment_id);
}

async function openWhiteboard(page: Page, roomId: string): Promise<void> {
  await page.goto(`/room/${roomId}`);
  await page.getByRole("tab", { name: "Whiteboard" }).click();
  await expect(
    page.getByRole("application", { name: "Collaborative Whiteboard" })
  ).toBeVisible();
  await expect(page.locator(".whiteboard-surface__status")).toHaveCount(0);
}

test("shares real Excalidraw content and collaborator presence between two browsers", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { owner, member } = await createRoomSessions(request);
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  await seedSession(ownerContext, owner);
  await seedSession(memberContext, member);
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const memberMessages: JsonResponse[] = [];
  const memberSentMessages: JsonResponse[] = [];
  const ownerSentMessages: JsonResponse[] = [];
  ownerPage.on("websocket", (socket) => {
    if (!socket.url().includes("/whiteboard")) return;
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        ownerSentMessages.push(JSON.parse(payload) as JsonResponse);
      } catch {
        // Non-JSON frames do not belong to the CACP whiteboard protocol.
      }
    });
  });
  memberPage.on("websocket", (socket) => {
    if (!socket.url().includes("/whiteboard")) return;
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        memberMessages.push(JSON.parse(payload) as JsonResponse);
      } catch {
        // Non-JSON frames do not belong to the CACP whiteboard protocol.
      }
    });
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        memberSentMessages.push(JSON.parse(payload) as JsonResponse);
      } catch {
        // Non-JSON frames do not belong to the CACP whiteboard protocol.
      }
    });
  });

  await Promise.all([
    openWhiteboard(ownerPage, owner.room_id),
    openWhiteboard(memberPage, member.room_id),
  ]);
  await expect(ownerPage.getByLabel("2 active editors")).toBeAttached();
  await expect(
    ownerPage.getByRole("button", { name: "View Member's area" })
  ).toBeVisible({ timeout: 5_000 });
  const ownerEditor = ownerPage.getByRole("application", {
    name: "Collaborative Whiteboard",
  });
  const memberEditor = memberPage.getByRole("application", {
    name: "Collaborative Whiteboard",
  });
  const [ownerBox, memberBox] = await Promise.all([
    ownerEditor.boundingBox(),
    memberEditor.boundingBox(),
  ]);
  expect(ownerBox).not.toBeNull();
  expect(memberBox).not.toBeNull();
  const capture = {
    x: memberBox!.x + 220,
    y: memberBox!.y + 140,
    width: 700,
    height: 360,
  };
  const before = await memberPage.screenshot({ clip: capture });

  await ownerPage.mouse.click(ownerBox!.x + 280, ownerBox!.y + 210);
  await ownerPage.keyboard.press("r");
  await expect(
    ownerPage.getByRole("radio", { name: "Rectangle" })
  ).toBeChecked();
  await ownerPage.mouse.move(ownerBox!.x + 320, ownerBox!.y + 230);
  await ownerPage.mouse.down();
  await ownerPage.mouse.move(ownerBox!.x + 500, ownerBox!.y + 350, {
    steps: 8,
  });
  await ownerPage.mouse.up();

  await expect
    .poll(() =>
      memberMessages.some(
        (message) =>
          message.type === "whiteboard.elements.updated" &&
          Array.isArray(message.elements) &&
          message.elements.some(
            (element) =>
              typeof element === "object" &&
              element !== null &&
              (element as JsonResponse).type === "rectangle"
          )
      )
    )
    .toBe(true);

  await ownerPage.mouse.click(ownerBox!.x + 760, ownerBox!.y + 470);
  await ownerPage.keyboard.press("t");
  await expect(ownerPage.getByRole("radio", { name: "Text" })).toBeChecked();
  await ownerPage.mouse.click(ownerBox!.x + 570, ownerBox!.y + 270);
  const textEditor = ownerPage.locator("textarea:visible");
  await expect(textEditor).toBeVisible();
  await textEditor.fill("Shared design");
  await textEditor.press("Control+Enter");

  await expect
    .poll(() =>
      memberMessages.some(
        (message) =>
          message.type === "whiteboard.elements.updated" &&
          Array.isArray(message.elements) &&
          message.elements.some(
            (element) =>
              typeof element === "object" &&
              element !== null &&
              (element as JsonResponse).type === "text" &&
              (element as JsonResponse).text === "Shared design"
          )
      )
    )
    .toBe(true);
  await memberPage.waitForTimeout(250);
  expect(
    memberSentMessages.filter(
      (message) => message.type === "whiteboard.elements.update"
    )
  ).toHaveLength(0);
  await expect
    .poll(async () => {
      const after = await memberPage.screenshot({ clip: capture });
      return Buffer.compare(before, after);
    })
    .not.toBe(0);

  const attachmentId = await uploadImageAttachment(request, owner);
  const currentElements = memberMessages
    .filter((message) => message.type === "whiteboard.elements.updated")
    .at(-1)?.elements;
  expect(Array.isArray(currentElements)).toBe(true);
  await ownerPage.evaluate(
    ({ roomId, token, elements, imageId }) =>
      new Promise<void>((resolve, reject) => {
        const url = new URL(`/rooms/${roomId}/whiteboard`, location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("token", token);
        const socket = new WebSocket(url);
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error("whiteboard_image_update_timeout"));
        }, 5_000);
        socket.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as JsonResponse;
          if (message.type === "whiteboard.scene") {
            socket.send(
              JSON.stringify({
                protocol: "cacp-whiteboard",
                version: "1.0.0",
                room_id: roomId,
                type: "whiteboard.elements.update",
                update_id: "browser-image-update",
                base_revision: message.revision,
                elements: [
                  ...elements,
                  {
                    id: "browser-image",
                    type: "image",
                    x: 610,
                    y: 310,
                    width: 120,
                    height: 120,
                    angle: 0,
                    strokeColor: "transparent",
                    backgroundColor: "transparent",
                    fillStyle: "solid",
                    strokeWidth: 1,
                    strokeStyle: "solid",
                    roughness: 0,
                    opacity: 100,
                    groupIds: [],
                    frameId: null,
                    index: "a2",
                    roundness: null,
                    seed: 42,
                    version: 1,
                    versionNonce: 42,
                    isDeleted: false,
                    boundElements: null,
                    updated: Date.now(),
                    link: null,
                    locked: false,
                    status: "saved",
                    fileId: imageId,
                    scale: [1, 1],
                    crop: null,
                  },
                ],
                app_state: { viewBackgroundColor: "#ffffff" },
              })
            );
          } else if (
            message.type === "whiteboard.ack" &&
            message.update_id === "browser-image-update"
          ) {
            window.clearTimeout(timeout);
            socket.close();
            resolve();
          } else if (message.type === "whiteboard.error") {
            window.clearTimeout(timeout);
            socket.close();
            reject(new Error(String(message.message ?? message.code)));
          }
        };
      }),
    {
      roomId: owner.room_id,
      token: owner.token,
      elements: currentElements as JsonResponse[],
      imageId: attachmentId,
    }
  );

  await expect
    .poll(() =>
      memberMessages.some(
        (message) =>
          message.type === "whiteboard.elements.updated" &&
          Array.isArray(message.elements) &&
          message.elements.some(
            (element) =>
              typeof element === "object" &&
              element !== null &&
              (element as JsonResponse).type === "image" &&
              String((element as JsonResponse).fileId).startsWith("att_")
          )
      )
    )
    .toBe(true);
  expect(
    ownerSentMessages
      .filter((message) => message.type === "whiteboard.elements.update")
      .some((message) => JSON.stringify(message).includes("data:image"))
  ).toBe(false);

  for (const format of ["PNG", "SVG", "Excalidraw"] as const) {
    const downloadPromise = ownerPage.waitForEvent("download");
    await ownerPage
      .getByRole("button", { name: `Export ${format}`, exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toContain(
      format === "Excalidraw" ? ".excalidraw" : `.${format.toLowerCase()}`
    );
  }
});
