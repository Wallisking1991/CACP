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
  const { owner, member } = await createRoomSessions(request);
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  await seedSession(ownerContext, owner);
  await seedSession(memberContext, member);
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const memberMessages: JsonResponse[] = [];
  const memberSentMessages: JsonResponse[] = [];
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
});
