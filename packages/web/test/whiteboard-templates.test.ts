import { describe, expect, it } from "vitest";

import {
  BuiltInWhiteboardTemplates,
  createBuiltInTemplateSkeleton,
  getBuiltInWhiteboardTemplate,
  WhiteboardTemplateCatalogVersion,
  WhiteboardTemplateCategories,
} from "../src/whiteboard/whiteboard-templates.js";

describe("built-in whiteboard templates", () => {
  it("ships a substantial versioned enterprise catalog made only from trusted local elements", () => {
    expect(WhiteboardTemplateCatalogVersion).toBe(2);
    expect(WhiteboardTemplateCategories).toEqual([
      "strategy",
      "operations",
      "delivery",
      "improvement",
    ]);
    expect(BuiltInWhiteboardTemplates.map((template) => template.id)).toEqual([
      "strategy-map",
      "okr-planning",
      "swot-analysis",
      "operating-review",
      "process-swimlane",
      "raci-matrix",
      "risk-matrix",
      "project-kickoff",
      "roadmap",
      "decision-log",
      "incident-review",
      "customer-journey",
      "brainstorm",
      "flow",
      "retrospective",
    ]);
    expect(new Set(BuiltInWhiteboardTemplates.map(({ id }) => id)).size).toBe(
      BuiltInWhiteboardTemplates.length
    );
    for (const template of BuiltInWhiteboardTemplates) {
      expect(template.version).toBe(WhiteboardTemplateCatalogVersion);
      expect(getBuiltInWhiteboardTemplate(template.id)).toBe(template);
      expect(template.size.width).toBeGreaterThanOrEqual(1100);
      expect(template.size.height).toBeGreaterThanOrEqual(760);
      const elements = createBuiltInTemplateSkeleton(template.id, {
        x: 10,
        y: 20,
      });
      expect(elements.length).toBeGreaterThanOrEqual(15);
      const serialized = JSON.stringify(elements);
      expect(serialized).not.toMatch(/https?:\/\//u);
      expect(serialized).toMatch(/owner/iu);
      for (const element of elements) {
        expect(element.customData).toEqual({
          cacpTemplate: {
            id: template.id,
            version: WhiteboardTemplateCatalogVersion,
          },
        });
      }
    }
  });
});
