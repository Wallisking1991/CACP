import { describe, expect, it } from "vitest";

import {
  BuiltInWhiteboardTemplates,
  createBuiltInTemplateSkeleton,
  WhiteboardTemplateCatalogVersion,
} from "../src/whiteboard/whiteboard-templates.js";

describe("built-in whiteboard templates", () => {
  it("ships a small versioned catalog made only from trusted local elements", () => {
    expect(WhiteboardTemplateCatalogVersion).toBe(1);
    expect(BuiltInWhiteboardTemplates.map((template) => template.id)).toEqual([
      "brainstorm",
      "flow",
      "retrospective",
    ]);
    for (const template of BuiltInWhiteboardTemplates) {
      expect(template.version).toBe(WhiteboardTemplateCatalogVersion);
      const elements = createBuiltInTemplateSkeleton(template.id, {
        x: 10,
        y: 20,
      });
      expect(elements.length).toBeGreaterThan(0);
      expect(JSON.stringify(elements)).not.toMatch(/https?:\/\//u);
      expect(elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            customData: {
              cacpTemplate: {
                id: template.id,
                version: WhiteboardTemplateCatalogVersion,
              },
            },
          }),
        ])
      );
    }
  });
});
