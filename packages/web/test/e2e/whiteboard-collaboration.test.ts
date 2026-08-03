import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { RequiredAgentAdapterCompatibility } from "@cacp/protocol";
import { readFile } from "node:fs/promises";

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

async function registerReadyAgent(
  request: APIRequestContext,
  owner: RoomSession
): Promise<{ agent_id: string }> {
  const registered = await postJson(
    request,
    `/rooms/${owner.room_id}/agents/register`,
    {
      compatibility: {
        protocol_version: "0.3.0",
        connector_version: "0.5.0-browser-test",
        adapters: RequiredAgentAdapterCompatibility.map((adapter) => ({
          ...adapter,
          input_capabilities: { ...adapter.input_capabilities },
        })),
      },
      name: "Frame reviewer",
      capabilities: ["kimi-cli"],
    },
    owner.token
  );
  const agentId = String(registered.agent_id);
  const agentToken = String(registered.agent_token);
  await postJson(
    request,
    `/rooms/${owner.room_id}/agents/select`,
    { agent_id: agentId },
    owner.token
  );
  await postJson(
    request,
    `/rooms/${owner.room_id}/agent-sessions/selection`,
    { agent_id: agentId, provider: "kimi-cli", mode: "fresh" },
    owner.token
  );
  await postJson(
    request,
    `/rooms/${owner.room_id}/agent-sessions/ready`,
    {
      agent_id: agentId,
      provider: "kimi-cli",
      mode: "fresh",
      ready_at: new Date().toISOString(),
    },
    agentToken
  );
  return { agent_id: agentId };
}

async function openWhiteboard(page: Page, roomId: string): Promise<void> {
  await page.goto(`/room/${roomId}`);
  await page.getByRole("tab", { name: "Whiteboard" }).click();
  await expect(
    page.getByRole("application", { name: "Collaborative Whiteboard" })
  ).toBeVisible();
  await expect(page.locator(".whiteboard-surface__status")).toHaveCount(0);
}

test("preserves the first rectangle dimensions after collaboration sync", async ({
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
  });

  await Promise.all([
    openWhiteboard(ownerPage, owner.room_id),
    openWhiteboard(memberPage, member.room_id),
  ]);
  const editor = ownerPage.getByRole("application", {
    name: "Collaborative Whiteboard",
  });
  const box = await editor.boundingBox();
  expect(box).not.toBeNull();

  await ownerPage.keyboard.press("r");
  await ownerPage.mouse.move(box!.x + 320, box!.y + 230);
  await ownerPage.mouse.down();
  await ownerPage.mouse.move(box!.x + 500, box!.y + 350, { steps: 8 });
  await ownerPage.mouse.up();

  await expect
    .poll(
      () =>
        memberMessages.some(
          (message) =>
            message.type === "whiteboard.elements.updated" &&
            Array.isArray(message.elements) &&
            message.elements.some(
              (element) =>
                typeof element === "object" &&
                element !== null &&
                (element as JsonResponse).type === "rectangle" &&
                Number((element as JsonResponse).width) >= 100 &&
                Number((element as JsonResponse).height) >= 100
            )
        ),
      { timeout: 5_000 }
    )
    .toBe(true);

  await Promise.all([ownerContext.close(), memberContext.close()]);
});

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
              (element as JsonResponse).type === "rectangle" &&
              Number((element as JsonResponse).width) >= 100 &&
              Number((element as JsonResponse).height) >= 100
          )
      )
    )
    .toBe(true);

  await ownerPage.getByRole("button", { name: "Templates" }).click();
  const templateMenu = ownerPage.getByRole("dialog", {
    name: "Built-in templates",
  });
  await templateMenu.getByRole("button", { name: /Brainstorm/u }).click();
  await expect
    .poll(() =>
      memberMessages.some(
        (message) =>
          message.type === "whiteboard.elements.updated" &&
          Array.isArray(message.elements) &&
          message.elements.some((element) => {
            if (typeof element !== "object" || element === null) return false;
            const customData = (element as JsonResponse).customData;
            if (typeof customData !== "object" || customData === null)
              return false;
            const marker = (customData as JsonResponse).cacpTemplate;
            return (
              typeof marker === "object" &&
              marker !== null &&
              (marker as JsonResponse).id === "brainstorm" &&
              (marker as JsonResponse).version === 1
            );
          })
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

  const beforeImage = await memberPage.screenshot({ clip: capture });
  const imageBase64 = await ownerPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#ff00cc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const imageChooser = ownerPage.waitForEvent("filechooser");
  await ownerPage.getByRole("button", { name: "Add image" }).click();
  await (
    await imageChooser
  ).setFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageBase64, "base64"),
  });

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
  await expect(
    memberPage.locator(".whiteboard-surface__asset-error")
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const afterImage = await memberPage.screenshot({ clip: capture });
      return Buffer.compare(beforeImage, afterImage);
    })
    .not.toBe(0);
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
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    if (format === "PNG") {
      expect(bytes.byteLength).toBeGreaterThan(1_000);
      expect([...bytes.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      const magentaPixels = await ownerPage.evaluate(async (base64) => {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (character) =>
          character.charCodeAt(0)
        );
        const image = await createImageBitmap(
          new Blob([bytes], { type: "image/png" })
        );
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas unavailable");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        let matches = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index]! > 240 &&
            pixels[index + 1]! < 20 &&
            pixels[index + 2]! > 180 &&
            pixels[index + 3]! > 240
          ) {
            matches += 1;
          }
        }
        return matches;
      }, bytes.toString("base64"));
      expect(magentaPixels).toBeGreaterThan(1_000);
    } else if (format === "SVG") {
      const svg = bytes.toString("utf8");
      expect(svg).toContain("<image");
      expect(svg).toContain("data:image/png");
    } else {
      const source = JSON.parse(bytes.toString("utf8")) as JsonResponse;
      expect(
        Object.values((source.files as JsonResponse | undefined) ?? {}).some(
          (file) =>
            typeof file === "object" &&
            file !== null &&
            String((file as JsonResponse).dataURL).startsWith("data:image/png")
        )
      ).toBe(true);
    }
  }

  const currentRevision = Math.max(
    ...memberMessages
      .filter((message) => message.type === "whiteboard.elements.updated")
      .map((message) => Number(message.revision))
  );
  await ownerPage.getByRole("button", { name: "Recovery" }).click();
  await expect(
    ownerPage.getByRole("dialog", { name: "Whiteboard recovery" })
  ).toBeVisible();
  await expect(
    ownerPage.getByText(`Current revision: ${currentRevision}`, { exact: true })
  ).toBeVisible();
  await ownerPage.getByRole("button", { name: "Clear board" }).click();
  await expect(
    ownerPage.getByText(
      "All current whiteboard content will be removed for every participant. A temporary recovery point is created first."
    )
  ).toBeVisible();
  await ownerPage.getByRole("button", { name: "Confirm clear" }).click();
  await expect
    .poll(() =>
      memberMessages.some(
        (message) =>
          message.type === "whiteboard.scene" &&
          Number(message.revision) === currentRevision + 1 &&
          Array.isArray(
            (message.scene as JsonResponse | undefined)?.elements
          ) &&
          ((message.scene as JsonResponse).elements as unknown[]).length === 0
      )
    )
    .toBe(true);

  await ownerPage
    .getByRole("button", { name: "Restore revision 1", exact: true })
    .click();
  await expect(
    ownerPage.getByText(
      "The whole shared whiteboard will be replaced for every participant and local undo history will reset."
    )
  ).toBeVisible();
  await ownerPage.getByRole("button", { name: "Confirm restore" }).click();
  await expect
    .poll(() =>
      memberMessages.some(
        (message) =>
          message.type === "whiteboard.scene" &&
          Number(message.revision) === currentRevision + 2 &&
          Array.isArray(
            (message.scene as JsonResponse | undefined)?.elements
          ) &&
          ((message.scene as JsonResponse).elements as JsonResponse[]).some(
            (element) => element.type === "rectangle"
          )
      )
    )
    .toBe(true);
});

test("promotes one real Excalidraw Frame into a single Main Input", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { owner } = await createRoomSessions(request);
  await registerReadyAgent(request, owner);
  const context = await browser.newContext();
  await seedSession(context, owner);
  const page = await context.newPage();
  const sentMessages: JsonResponse[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/whiteboard")) return;
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        sentMessages.push(JSON.parse(payload) as JsonResponse);
      } catch {
        // Non-JSON frames do not belong to the CACP whiteboard protocol.
      }
    });
  });

  await openWhiteboard(page, owner.room_id);
  const editor = page.getByRole("application", {
    name: "Collaborative Whiteboard",
  });
  const box = await editor.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.click(box!.x + 320, box!.y + 220);
  await page.keyboard.press("f");
  await page.mouse.move(box!.x + 360, box!.y + 250);
  await page.mouse.down();
  await page.mouse.move(box!.x + 700, box!.y + 500, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      sentMessages.some(
        (message) =>
          message.type === "whiteboard.elements.update" &&
          Array.isArray(message.elements) &&
          message.elements.some(
            (element) =>
              typeof element === "object" &&
              element !== null &&
              (element as JsonResponse).type === "frame"
          )
      )
    )
    .toBe(true);

  await page.getByRole("button", { name: "Send selection" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Send whiteboard selection",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByAltText("PNG preview of the selected whiteboard content")
  ).toBeVisible();
  await expect(dialog.getByText(".excalidraw", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Frame reviewer", { exact: true })
  ).toBeVisible();
  await dialog
    .getByLabel("Instruction for the Agent")
    .fill("Turn this frame into an implementation plan.");
  const promotionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/rooms/${owner.room_id}/whiteboard/promotions`)
  );
  await dialog.getByRole("button", { name: "Create Main Input" }).click();
  const response = await promotionResponse;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(dialog).toHaveCount(0);

  const conversationTab = page.getByRole("tab", {
    name: "Main conversation",
  });
  await expect(conversationTab).toHaveAttribute("aria-selected", "true");
  await expect(conversationTab).toBeFocused();
  await expect(
    page.getByText("Turn this frame into an implementation plan.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText(/whiteboard-selection-r\d+\.png/, { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByText(/whiteboard-selection-r\d+\.excalidraw/, { exact: true })
  ).toHaveCount(1);

  await context.close();
});

test("supports a complete narrow touch whiteboard flow", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const { owner, member } = await createRoomSessions(request);
  const ownerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
  });
  const memberContext = await browser.newContext({
    viewport: { width: 768, height: 900 },
  });
  await seedSession(ownerContext, owner);
  await seedSession(memberContext, member);
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const memberMessages: JsonResponse[] = [];
  memberPage.on("websocket", (socket) => {
    if (!socket.url().includes("/whiteboard")) return;
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        memberMessages.push(JSON.parse(payload) as JsonResponse);
      } catch {
        // Ignore frames outside the CACP whiteboard protocol.
      }
    });
  });

  await Promise.all([
    openWhiteboard(ownerPage, owner.room_id),
    openWhiteboard(memberPage, member.room_id),
  ]);
  await expect(ownerPage.getByLabel("2 active editors")).toBeAttached();
  await expect(
    ownerPage.getByRole("button", { name: "More", exact: true })
  ).toBeVisible();
  await expect(
    ownerPage.getByRole("button", { name: "Add image" })
  ).toHaveCount(0);
  const shellBox = await ownerPage.locator(".workspace-shell").boundingBox();
  expect(shellBox?.width).toBe(390);
  const editor = ownerPage.getByRole("application", {
    name: "Collaborative Whiteboard",
  });
  const editorBox = await editor.boundingBox();
  expect(editorBox).not.toBeNull();

  await ownerPage.keyboard.press("r");
  await expect(
    ownerPage.getByRole("radio", { name: "Rectangle" })
  ).toBeChecked();
  await ownerPage.mouse.move(editorBox!.x + 90, editorBox!.y + 180);
  await ownerPage.mouse.down();
  await ownerPage.mouse.move(editorBox!.x + 230, editorBox!.y + 300, {
    steps: 6,
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

  await ownerPage.getByRole("button", { name: "More", exact: true }).click();
  const actions = ownerPage.getByRole("dialog", {
    name: "More",
    exact: true,
  });
  await expect(actions).toBeVisible();
  const imageBase64 = await ownerPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#00a2ff";
    context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const chooser = ownerPage.waitForEvent("filechooser");
  await actions.getByRole("button", { name: "Add image" }).click();
  await (
    await chooser
  ).setFiles({
    name: "mobile.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageBase64, "base64"),
  });
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
              (element as JsonResponse).type === "image"
          )
      )
    )
    .toBe(true);

  await actions.getByRole("button", { name: "Templates" }).click();
  const templates = ownerPage.getByRole("dialog", {
    name: "Built-in templates",
  });
  await templates.getByRole("button", { name: /Simple flow/u }).click();
  await expect
    .poll(() =>
      memberMessages.some((message) =>
        JSON.stringify(message).includes('"id":"flow","version":1')
      )
    )
    .toBe(true);

  await ownerPage.getByRole("button", { name: "More", exact: true }).click();
  const downloadPromise = ownerPage.waitForEvent("download");
  const reopenedActions = ownerPage.getByRole("dialog", {
    name: "More",
    exact: true,
  });
  await reopenedActions.getByRole("button", { name: "Export PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename().toLowerCase()).toContain(".png");

  await reopenedActions.getByRole("button", { name: "Close" }).click();
  const conversationTab = ownerPage.getByRole("tab", {
    name: "Main conversation",
  });
  await conversationTab.click();
  await expect(conversationTab).toHaveAttribute("aria-selected", "true");
  await expect(
    ownerPage.getByRole("application", { name: "Collaborative Whiteboard" })
  ).not.toBeVisible();

  await Promise.all([ownerContext.close(), memberContext.close()]);
});
