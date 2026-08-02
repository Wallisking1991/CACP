import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

export const WhiteboardTemplateCatalogVersion = 1 as const;

export const BuiltInWhiteboardTemplates = [
  { id: "brainstorm", version: WhiteboardTemplateCatalogVersion },
  { id: "flow", version: WhiteboardTemplateCatalogVersion },
  { id: "retrospective", version: WhiteboardTemplateCatalogVersion },
] as const;

export type WhiteboardTemplateId =
  (typeof BuiltInWhiteboardTemplates)[number]["id"];

export interface WhiteboardTemplateOrigin {
  x: number;
  y: number;
}

const card = (
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  backgroundColor: string
): ExcalidrawElementSkeleton => ({
  type: "rectangle",
  x,
  y,
  width,
  height,
  backgroundColor,
  fillStyle: "solid",
  roundness: { type: 3 },
  strokeColor: "#2f2a24",
  customData: {
    cacpTemplate: { version: WhiteboardTemplateCatalogVersion },
  },
  label: { text, fontSize: 20 },
});

const heading = (
  x: number,
  y: number,
  text: string
): ExcalidrawElementSkeleton => ({
  type: "text",
  x,
  y,
  text,
  fontSize: 28,
  strokeColor: "#1f1b16",
  customData: {
    cacpTemplate: { version: WhiteboardTemplateCatalogVersion },
  },
});

function markTemplate(
  templateId: WhiteboardTemplateId,
  elements: ExcalidrawElementSkeleton[]
): ExcalidrawElementSkeleton[] {
  return elements.map((element) => ({
    ...element,
    customData: {
      ...(element.customData ?? {}),
      cacpTemplate: {
        id: templateId,
        version: WhiteboardTemplateCatalogVersion,
      },
    },
  }));
}

export function createBuiltInTemplateSkeleton(
  templateId: WhiteboardTemplateId,
  origin: WhiteboardTemplateOrigin
): ExcalidrawElementSkeleton[] {
  const { x, y } = origin;
  if (templateId === "brainstorm") {
    return markTemplate(templateId, [
      heading(x, y, "Brainstorm"),
      card(x, y + 58, 220, 150, "Ideas", "#fff3bf"),
      card(x + 240, y + 58, 220, 150, "Questions", "#d0ebff"),
      card(x + 480, y + 58, 220, 150, "Next steps", "#d3f9d8"),
    ]);
  }
  if (templateId === "flow") {
    return markTemplate(templateId, [
      heading(x, y, "Simple flow"),
      card(x, y + 72, 180, 96, "Start", "#d3f9d8"),
      {
        type: "arrow",
        x: x + 180,
        y: y + 120,
        points: [
          [0, 0],
          [80, 0],
        ],
        endArrowhead: "arrow",
      },
      card(x + 260, y + 72, 180, 96, "Explore", "#d0ebff"),
      {
        type: "arrow",
        x: x + 440,
        y: y + 120,
        points: [
          [0, 0],
          [80, 0],
        ],
        endArrowhead: "arrow",
      },
      card(x + 520, y + 72, 180, 96, "Decide", "#ffe8cc"),
    ]);
  }
  return markTemplate(templateId, [
    heading(x, y, "Retrospective"),
    card(x, y + 58, 220, 220, "Went well", "#d3f9d8"),
    card(x + 240, y + 58, 220, 220, "Needs work", "#ffe3e3"),
    card(x + 480, y + 58, 220, 220, "Try next", "#d0ebff"),
  ]);
}
