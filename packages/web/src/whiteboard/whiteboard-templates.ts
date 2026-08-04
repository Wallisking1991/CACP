import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

export const WhiteboardTemplateCatalogVersion = 2 as const;

export const WhiteboardTemplateCategories = [
  "strategy",
  "operations",
  "delivery",
  "improvement",
] as const;

export type WhiteboardTemplateCategory =
  (typeof WhiteboardTemplateCategories)[number];

type WhiteboardTemplatePreview =
  | "columns"
  | "journey"
  | "lanes"
  | "matrix"
  | "quadrants"
  | "scorecard"
  | "timeline";

interface WhiteboardTemplateDefinition {
  id: string;
  category: WhiteboardTemplateCategory;
  version: typeof WhiteboardTemplateCatalogVersion;
  accent: string;
  preview: WhiteboardTemplatePreview;
  size: { width: number; height: number };
}

export const BuiltInWhiteboardTemplates = [
  {
    id: "strategy-map",
    category: "strategy",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#5b5bd6",
    preview: "lanes",
    size: { width: 1240, height: 820 },
  },
  {
    id: "okr-planning",
    category: "strategy",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#4c6ef5",
    preview: "columns",
    size: { width: 1240, height: 810 },
  },
  {
    id: "swot-analysis",
    category: "strategy",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#7048e8",
    preview: "quadrants",
    size: { width: 1180, height: 800 },
  },
  {
    id: "operating-review",
    category: "operations",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#087f5b",
    preview: "scorecard",
    size: { width: 1280, height: 880 },
  },
  {
    id: "process-swimlane",
    category: "operations",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#0b7285",
    preview: "lanes",
    size: { width: 1320, height: 830 },
  },
  {
    id: "raci-matrix",
    category: "operations",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#2b8a3e",
    preview: "matrix",
    size: { width: 1260, height: 810 },
  },
  {
    id: "risk-matrix",
    category: "operations",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#e8590c",
    preview: "matrix",
    size: { width: 1280, height: 900 },
  },
  {
    id: "project-kickoff",
    category: "delivery",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#1971c2",
    preview: "columns",
    size: { width: 1260, height: 890 },
  },
  {
    id: "roadmap",
    category: "delivery",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#4263eb",
    preview: "timeline",
    size: { width: 1320, height: 870 },
  },
  {
    id: "decision-log",
    category: "delivery",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#5f3dc4",
    preview: "scorecard",
    size: { width: 1280, height: 810 },
  },
  {
    id: "incident-review",
    category: "delivery",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#c92a2a",
    preview: "timeline",
    size: { width: 1280, height: 880 },
  },
  {
    id: "customer-journey",
    category: "improvement",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#a61e4d",
    preview: "journey",
    size: { width: 1400, height: 980 },
  },
  {
    id: "brainstorm",
    category: "improvement",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#f08c00",
    preview: "quadrants",
    size: { width: 1200, height: 800 },
  },
  {
    id: "flow",
    category: "improvement",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#0b7285",
    preview: "timeline",
    size: { width: 1200, height: 760 },
  },
  {
    id: "retrospective",
    category: "improvement",
    version: WhiteboardTemplateCatalogVersion,
    accent: "#2f9e44",
    preview: "columns",
    size: { width: 1200, height: 800 },
  },
] as const satisfies readonly WhiteboardTemplateDefinition[];

export type WhiteboardTemplateId =
  (typeof BuiltInWhiteboardTemplates)[number]["id"];

export interface WhiteboardTemplateOrigin {
  x: number;
  y: number;
}

type Skeleton = ExcalidrawElementSkeleton;
type TemplateBuilder = (origin: WhiteboardTemplateOrigin) => Skeleton[];

const colors = {
  ink: "#24211d",
  muted: "#6f675d",
  line: "#b8afa3",
  surface: "#fffdf9",
  soft: "#f4f1eb",
  blue: "#dbeafe",
  blueStrong: "#bfdbfe",
  green: "#dcfce7",
  greenStrong: "#bbf7d0",
  amber: "#fef3c7",
  amberStrong: "#fde68a",
  red: "#fee2e2",
  redStrong: "#fecaca",
  purple: "#ede9fe",
  pink: "#fce7f3",
  cyan: "#cffafe",
} as const;

interface BoxOptions {
  background?: string;
  stroke?: string;
  fontSize?: number;
  round?: boolean;
  strokeWidth?: number;
}

function box(
  origin: WhiteboardTemplateOrigin,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  options: BoxOptions = {}
): Skeleton {
  return {
    type: "rectangle",
    x: origin.x + x,
    y: origin.y + y,
    width,
    height,
    backgroundColor: options.background ?? colors.surface,
    fillStyle: "solid",
    roundness: options.round === false ? undefined : { type: 3 },
    strokeColor: options.stroke ?? colors.line,
    strokeWidth: options.strokeWidth ?? 1,
    label: { text: label, fontSize: options.fontSize ?? 16 },
  };
}

function textElement(
  origin: WhiteboardTemplateOrigin,
  x: number,
  y: number,
  text: string,
  fontSize = 18,
  strokeColor: string = colors.ink
): Skeleton {
  return {
    type: "text",
    x: origin.x + x,
    y: origin.y + y,
    text,
    fontSize,
    strokeColor,
  };
}

function connector(
  origin: WhiteboardTemplateOrigin,
  x: number,
  y: number,
  points: [number, number][]
): Skeleton {
  return {
    type: "arrow",
    x: origin.x + x,
    y: origin.y + y,
    points,
    strokeColor: colors.muted,
    endArrowhead: "arrow",
  };
}

function boardHeader(
  origin: WhiteboardTemplateOrigin,
  title: string,
  subtitle: string,
  width: number,
  context: string[]
): Skeleton[] {
  const gap = 12;
  const itemWidth = (width - gap * (context.length - 1)) / context.length;
  return [
    textElement(origin, 0, 0, title, 32),
    textElement(origin, 0, 42, subtitle, 16, colors.muted),
    ...context.map((label, index) =>
      box(origin, index * (itemWidth + gap), 78, itemWidth, 52, label, {
        background: colors.soft,
        fontSize: 14,
      })
    ),
  ];
}

function panel(
  origin: WhiteboardTemplateOrigin,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  prompts: string,
  accent: string
): Skeleton[] {
  return [
    box(origin, x, y, width, 40, title, {
      background: accent,
      stroke: accent,
      fontSize: 16,
    }),
    box(origin, x, y + 40, width, height - 40, prompts, {
      background: colors.surface,
      fontSize: 14,
      round: false,
    }),
  ];
}

function table(
  origin: WhiteboardTemplateOrigin,
  x: number,
  y: number,
  widths: number[],
  rows: string[][],
  options: {
    header?: string;
    rowHeight?: number;
    headerBackground?: string;
    fontSize?: number;
  } = {}
): Skeleton[] {
  const rowHeight = options.rowHeight ?? 48;
  const elements: Skeleton[] = [];
  let rowY = y;
  if (options.header) {
    elements.push(
      box(
        origin,
        x,
        rowY,
        widths.reduce((sum, width) => sum + width, 0),
        40,
        options.header,
        {
          background: options.headerBackground ?? colors.soft,
          stroke: options.headerBackground ?? colors.line,
          fontSize: 16,
        }
      )
    );
    rowY += 40;
  }
  rows.forEach((row, rowIndex) => {
    let cellX = x;
    row.forEach((label, columnIndex) => {
      elements.push(
        box(
          origin,
          cellX,
          rowY + rowIndex * rowHeight,
          widths[columnIndex] ?? widths.at(-1) ?? 100,
          rowHeight,
          label,
          {
            background:
              rowIndex === 0
                ? (options.headerBackground ?? colors.soft)
                : colors.surface,
            fontSize: rowIndex === 0 ? 14 : (options.fontSize ?? 13),
            round: false,
          }
        )
      );
      cellX += widths[columnIndex] ?? widths.at(-1) ?? 100;
    });
  });
  return elements;
}

function buildStrategyMap(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Strategy map",
    "Connect the ambition to measurable outcomes, capabilities, and owners.",
    1240,
    [
      "Planning horizon",
      "North-star outcome",
      "Executive sponsor",
      "Review cadence",
    ]
  );
  const perspectives = [
    [
      "FINANCIAL",
      colors.green,
      "Profitable growth",
      "Unit economics",
      "Cash resilience",
    ],
    [
      "CUSTOMER",
      colors.blue,
      "Priority segments",
      "Customer promise",
      "Retention & trust",
    ],
    [
      "OPERATIONS",
      colors.amber,
      "Critical processes",
      "Quality & speed",
      "Scale constraints",
    ],
    [
      "CAPABILITY",
      colors.purple,
      "People & skills",
      "Data & technology",
      "Culture & governance",
    ],
  ] as const;
  perspectives.forEach((row, index) => {
    const y = 160 + index * 112;
    elements.push(box(origin, 0, y, 160, 82, row[0], { background: row[1] }));
    row.slice(2).forEach((label, column) => {
      elements.push(
        box(
          origin,
          180 + column * 353,
          y,
          333,
          82,
          `${label}\nObjective · KPI · target`,
          {
            background: colors.surface,
            fontSize: 15,
          }
        )
      );
      if (index < perspectives.length - 1) {
        elements.push(
          connector(origin, 346 + column * 353, y + 82, [
            [0, 0],
            [0, 30],
          ])
        );
      }
    });
  });
  elements.push(
    ...table(
      origin,
      0,
      630,
      [300, 250, 190, 180, 320],
      [
        [
          "Strategic initiative",
          "Outcome supported",
          "Owner",
          "Quarter",
          "Leading indicator",
        ],
        [
          "Initiative 01",
          "Objective / dependency",
          "Name",
          "Q_",
          "Early signal + target",
        ],
        [
          "Initiative 02",
          "Objective / dependency",
          "Name",
          "Q_",
          "Early signal + target",
        ],
      ],
      { header: "PRIORITY INITIATIVES", headerBackground: colors.green }
    )
  );
  return elements;
}

function buildOkrPlanning(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "OKR planning",
    "Turn company priorities into observable results and a disciplined check-in rhythm.",
    1240,
    ["Cycle / quarter", "Company priority", "OKR owner", "Confidence: __ / 10"]
  );
  const accents = [colors.blue, colors.purple, colors.green];
  for (let column = 0; column < 3; column += 1) {
    const x = column * 420;
    elements.push(
      ...panel(
        origin,
        x,
        160,
        400,
        112,
        `OBJECTIVE ${column + 1}`,
        "Qualitative outcome\nWhy it matters · owner",
        accents[column]
      ),
      ...table(
        origin,
        x,
        286,
        [250, 75, 75],
        [
          ["Key result", "Base", "Target"],
          ["KR1 · measurable result", "__", "__"],
          ["KR2 · measurable result", "__", "__"],
          ["KR3 · measurable result", "__", "__"],
        ],
        { rowHeight: 46, headerBackground: accents[column] }
      ),
      ...panel(
        origin,
        x,
        484,
        400,
        104,
        "INITIATIVES & ASSUMPTIONS",
        "Top bets · dependencies · what must be true",
        colors.soft
      )
    );
  }
  elements.push(
    ...table(
      origin,
      0,
      620,
      [220, 250, 190, 190, 390],
      [
        [
          "Check-in",
          "Evidence reviewed",
          "Confidence",
          "Decision",
          "Owner + next action",
        ],
        [
          "Week __",
          "Dashboard / customer signal",
          "__ / 10",
          "Continue / adapt",
          "Name · action · due date",
        ],
        [
          "Week __",
          "Dashboard / customer signal",
          "__ / 10",
          "Continue / adapt",
          "Name · action · due date",
        ],
      ],
      { header: "OPERATING CADENCE", headerBackground: colors.blue }
    )
  );
  return elements;
}

function buildSwotAnalysis(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "SWOT to action",
    "Assess the situation, then convert evidence into owned strategic choices.",
    1180,
    [
      "Decision / objective",
      "Market / business unit",
      "Evidence date",
      "Facilitator",
    ]
  );
  const sections = [
    [
      0,
      160,
      "STRENGTHS",
      "Internal advantages\nProof / data\nHow to amplify",
      colors.green,
    ],
    [
      600,
      160,
      "WEAKNESSES",
      "Internal constraints\nProof / data\nHow to reduce",
      colors.red,
    ],
    [
      0,
      380,
      "OPPORTUNITIES",
      "External shifts\nPotential value\nTime window",
      colors.blue,
    ],
    [
      600,
      380,
      "THREATS",
      "External risks\nPotential impact\nEarly warning",
      colors.amber,
    ],
  ] as const;
  sections.forEach(([x, y, title, prompts, accent]) => {
    elements.push(...panel(origin, x, y, 580, 196, title, prompts, accent));
  });
  elements.push(
    ...table(
      origin,
      0,
      610,
      [190, 350, 170, 150, 160, 160],
      [
        [
          "Choice",
          "Strategic action",
          "Evidence",
          "Owner",
          "Due",
          "Success signal",
        ],
        [
          "SO / WO / ST / WT",
          "What will we do or stop?",
          "Fact / assumption",
          "Name",
          "Date",
          "Leading KPI",
        ],
        [
          "SO / WO / ST / WT",
          "What will we do or stop?",
          "Fact / assumption",
          "Name",
          "Date",
          "Leading KPI",
        ],
      ],
      { header: "PRIORITIZED RESPONSES", headerBackground: colors.purple }
    )
  );
  return elements;
}

function buildOperatingReview(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Operating review",
    "Review performance, isolate drivers, make decisions, and leave with owned actions.",
    1280,
    ["Period", "Business unit", "Review owner", "Data refreshed"]
  );
  [
    "Revenue / growth",
    "Margin / efficiency",
    "Customer health",
    "Delivery / quality",
  ].forEach((label, index) => {
    const x = index * 320;
    elements.push(
      box(
        origin,
        x,
        160,
        300,
        104,
        `${label}\nActual __ · Plan __\nTrend ↑ → ↓ · Status`,
        {
          background: [colors.green, colors.amber, colors.blue, colors.purple][
            index
          ],
          fontSize: 15,
        }
      )
    );
  });
  elements.push(
    ...table(
      origin,
      0,
      290,
      [260, 140, 140, 140, 160, 440],
      [
        [
          "Metric",
          "Actual",
          "Plan",
          "Variance",
          "Trend",
          "Commentary / driver",
        ],
        ["KPI 01", "__", "__", "__%", "↑ → ↓", "What changed and why?"],
        ["KPI 02", "__", "__", "__%", "↑ → ↓", "What changed and why?"],
        ["KPI 03", "__", "__", "__%", "↑ → ↓", "What changed and why?"],
      ],
      { header: "SCORECARD", headerBackground: colors.green, rowHeight: 44 }
    ),
    ...panel(
      origin,
      0,
      520,
      400,
      144,
      "DRIVERS & INSIGHTS",
      "What explains the variance?\nFact vs assumption · leading signals",
      colors.blue
    ),
    ...panel(
      origin,
      420,
      520,
      400,
      144,
      "RISKS & DECISIONS",
      "Risk / opportunity\nDecision needed · decision owner",
      colors.amber
    ),
    ...panel(
      origin,
      840,
      520,
      440,
      144,
      "CUSTOMER & TEAM SIGNALS",
      "Voice of customer\nCapacity / morale · operating friction",
      colors.purple
    ),
    ...table(
      origin,
      0,
      690,
      [450, 190, 180, 200, 260],
      [
        [
          "Committed action",
          "Owner",
          "Due",
          "Success measure",
          "Blocker / dependency",
        ],
        [
          "Verb + observable outcome",
          "Name",
          "Date",
          "Metric + target",
          "Team / decision",
        ],
        [
          "Verb + observable outcome",
          "Name",
          "Date",
          "Metric + target",
          "Team / decision",
        ],
      ],
      { header: "COMMITMENTS", headerBackground: colors.green }
    )
  );
  return elements;
}

function buildProcessSwimlane(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Cross-functional process",
    "Make handoffs, decision rights, controls, and service levels visible.",
    1320,
    [
      "Process / trigger",
      "Customer outcome",
      "Process owner",
      "Target lead time",
    ]
  );
  const stages = [
    "1 · INTAKE",
    "2 · QUALIFY",
    "3 · EXECUTE",
    "4 · VERIFY",
    "5 · CLOSE",
  ];
  elements.push(
    box(origin, 0, 160, 170, 44, "ROLE / SYSTEM", { background: colors.soft })
  );
  stages.forEach((stage, index) => {
    elements.push(
      box(origin, 180 + index * 228, 160, 216, 44, stage, {
        background: colors.cyan,
      })
    );
  });
  const lanes = [
    "Customer / requester",
    "Frontline team",
    "Operations",
    "Approver / system",
  ];
  lanes.forEach((lane, row) => {
    const y = 214 + row * 112;
    elements.push(
      box(origin, 0, y, 170, 100, lane, { background: colors.soft })
    );
    stages.forEach((_, column) => {
      const label =
        (row + column) % 3 === 0
          ? "Activity\nOwner · input / output"
          : (row + column) % 3 === 1
            ? "Handoff / wait\nSLA · system"
            : "Decision / control\nRule · evidence";
      elements.push(
        box(origin, 180 + column * 228, y, 216, 100, label, {
          background: row % 2 === 0 ? colors.surface : colors.blue,
          fontSize: 13,
        })
      );
      if (column < stages.length - 1) {
        elements.push(
          connector(origin, 396 + column * 228, y + 50, [
            [0, 0],
            [12, 0],
          ])
        );
      }
    });
  });
  elements.push(
    ...table(
      origin,
      0,
      690,
      [250, 240, 220, 210, 200, 200],
      [
        [
          "Control point",
          "Metric / SLA",
          "Target",
          "Owner",
          "Evidence",
          "Escalation",
        ],
        [
          "Where quality is checked",
          "Time / quality / cost",
          "Threshold",
          "Name",
          "Source",
          "Rule + path",
        ],
      ],
      { header: "PROCESS CONTROLS", headerBackground: colors.cyan }
    )
  );
  return elements;
}

function buildRaciMatrix(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "RACI matrix",
    "Clarify accountability before work begins and expose overloaded decision paths.",
    1260,
    [
      "Initiative / process",
      "Accountable sponsor",
      "Facilitator",
      "Review date",
    ]
  );
  elements.push(
    ...table(
      origin,
      0,
      160,
      [320, 156, 156, 156, 156, 156, 160],
      [
        [
          "Deliverable / decision",
          "Sponsor",
          "Product",
          "Operations",
          "Finance",
          "Technology",
          "Customer team",
        ],
        ["Outcome / scope approval", "A", "R", "C", "C", "I", "C"],
        ["Plan and requirements", "I", "A / R", "C", "C", "C", "C"],
        ["Execution and controls", "I", "C", "A / R", "C", "R", "I"],
        ["Launch readiness", "A", "R", "R", "C", "R", "C"],
        ["Benefits realization", "A", "R", "R", "C", "I", "C"],
        ["Add workstream / decision", "_", "_", "_", "_", "_", "_"],
      ],
      {
        header: "RESPONSIBILITY ASSIGNMENT",
        headerBackground: colors.green,
        rowHeight: 54,
      }
    ),
    ...panel(
      origin,
      0,
      606,
      400,
      130,
      "LEGEND",
      "R · Responsible   A · Accountable\nC · Consulted   I · Informed",
      colors.green
    ),
    ...panel(
      origin,
      420,
      606,
      400,
      130,
      "QUALITY CHECK",
      "One accountable owner per row?\nToo many consulted roles? Missing execution owner?",
      colors.amber
    ),
    ...panel(
      origin,
      840,
      606,
      420,
      130,
      "ESCALATION & HANDOFF",
      "Decision deadline · escalation path\nRequired evidence · communication channel",
      colors.blue
    )
  );
  return elements;
}

function buildRiskMatrix(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Risk assessment & response",
    "Prioritize exposure with explicit evidence, thresholds, owners, and response plans.",
    1280,
    ["Scope / portfolio", "Assessment date", "Risk owner", "Review cadence"]
  );
  const cell = 74;
  const matrixX = 170;
  const matrixY = 210;
  elements.push(
    textElement(origin, 0, 330, "LIKELIHOOD →", 15, colors.muted),
    textElement(origin, 285, 160, "IMPACT →", 15, colors.muted)
  );
  ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"].forEach(
    (label, row) => {
      elements.push(
        box(origin, 0, matrixY + row * cell, 150, cell, label, {
          background: colors.soft,
          fontSize: 13,
          round: false,
        })
      );
    }
  );
  ["Minimal", "Minor", "Moderate", "Major", "Severe"].forEach(
    (label, column) => {
      elements.push(
        box(origin, matrixX + column * cell, matrixY - 42, cell, 42, label, {
          background: colors.soft,
          fontSize: 11,
          round: false,
        })
      );
    }
  );
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const score = (row + 1) * (column + 1);
      const background =
        score >= 16
          ? colors.redStrong
          : score >= 9
            ? colors.amberStrong
            : score >= 4
              ? colors.amber
              : colors.greenStrong;
      elements.push(
        box(
          origin,
          matrixX + column * cell,
          matrixY + row * cell,
          cell,
          cell,
          `${score}\nR__`,
          { background, fontSize: 13, round: false }
        )
      );
    }
  }
  elements.push(
    ...panel(
      origin,
      580,
      168,
      700,
      126,
      "RISK STATEMENT",
      "Because of [cause], [event] may occur, leading to [impact].\nEvidence · assumptions · affected objective",
      colors.red
    ),
    ...table(
      origin,
      580,
      310,
      [100, 240, 130, 130, 200],
      [
        ["Risk", "Response", "Owner", "Due", "Trigger / early warning"],
        [
          "R01",
          "Avoid / reduce / transfer / accept",
          "Name",
          "Date",
          "Observable threshold",
        ],
        [
          "R02",
          "Avoid / reduce / transfer / accept",
          "Name",
          "Date",
          "Observable threshold",
        ],
        [
          "R03",
          "Avoid / reduce / transfer / accept",
          "Name",
          "Date",
          "Observable threshold",
        ],
        [
          "R04",
          "Avoid / reduce / transfer / accept",
          "Name",
          "Date",
          "Observable threshold",
        ],
      ],
      { header: "RISK REGISTER", headerBackground: colors.red, rowHeight: 52 }
    ),
    ...table(
      origin,
      0,
      650,
      [180, 300, 240, 170, 190, 200],
      [
        [
          "Exposure",
          "Meaning",
          "Required response",
          "Decision owner",
          "Review",
          "Escalation",
        ],
        [
          "LOW · green",
          "Within tolerance",
          "Monitor",
          "Risk owner",
          "Cadence",
          "Threshold",
        ],
        [
          "MEDIUM · amber",
          "Needs treatment",
          "Fund mitigation",
          "Function lead",
          "Date",
          "Threshold",
        ],
        [
          "HIGH / CRITICAL · red",
          "Outside tolerance",
          "Act / escalate now",
          "Executive",
          "Immediate",
          "Governance forum",
        ],
      ],
      {
        header: "RESPONSE STANDARD",
        headerBackground: colors.amber,
        rowHeight: 46,
      }
    )
  );
  return elements;
}

function buildProjectKickoff(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Project kickoff",
    "Align the team on value, scope, governance, delivery milestones, and first decisions.",
    1260,
    ["Project / initiative", "Sponsor", "Delivery lead", "Target date"]
  );
  elements.push(
    ...panel(
      origin,
      0,
      160,
      400,
      170,
      "BUSINESS CASE",
      "Problem / opportunity\nWhy now · evidence\nCost of doing nothing",
      colors.blue
    ),
    ...panel(
      origin,
      420,
      160,
      400,
      170,
      "OUTCOMES & MEASURES",
      "Target outcome\nLeading / lagging KPI\nBaseline · target · date",
      colors.green
    ),
    ...panel(
      origin,
      840,
      160,
      420,
      170,
      "CUSTOMER & STAKEHOLDERS",
      "Primary user / beneficiary\nDecision makers\nChange impact",
      colors.purple
    ),
    ...panel(
      origin,
      0,
      350,
      400,
      150,
      "IN SCOPE",
      "Deliverables · teams · markets\nMust-have constraints",
      colors.green
    ),
    ...panel(
      origin,
      420,
      350,
      400,
      150,
      "OUT OF SCOPE",
      "Explicit exclusions\nFuture phase / parking lot",
      colors.red
    ),
    ...panel(
      origin,
      840,
      350,
      420,
      150,
      "ASSUMPTIONS & RISKS",
      "What must be true\nTop risks · mitigations\nEscalation trigger",
      colors.amber
    ),
    ...table(
      origin,
      0,
      520,
      [210, 270, 210, 180, 180, 210],
      [
        [
          "Milestone",
          "Exit criteria",
          "Owner",
          "Target",
          "Status",
          "Dependency",
        ],
        [
          "Discover / align",
          "Evidence / approval",
          "Name",
          "Date",
          "Not started",
          "Team / decision",
        ],
        [
          "Build / validate",
          "Evidence / approval",
          "Name",
          "Date",
          "Not started",
          "Team / decision",
        ],
        [
          "Launch / realize",
          "Evidence / approval",
          "Name",
          "Date",
          "Not started",
          "Team / decision",
        ],
      ],
      { header: "DELIVERY PLAN", headerBackground: colors.blue, rowHeight: 46 }
    ),
    ...table(
      origin,
      0,
      752,
      [350, 200, 190, 220, 300],
      [
        [
          "First decision / action",
          "Owner",
          "Due",
          "Forum / channel",
          "Definition of done",
        ],
        ["Verb + outcome", "Name", "Date", "Where", "Observable evidence"],
      ],
      {
        header: "STARTING COMMITMENTS",
        headerBackground: colors.green,
        rowHeight: 44,
      }
    )
  );
  return elements;
}

function buildRoadmap(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Outcome roadmap",
    "Sequence outcomes and learning—not just features—across workstreams and horizons.",
    1320,
    ["Vision / outcome", "Planning horizon", "Roadmap owner", "Last reviewed"]
  );
  const horizons = ["NOW · committed", "NEXT · validated", "LATER · options"];
  elements.push(
    box(origin, 0, 160, 190, 46, "WORKSTREAM", { background: colors.soft })
  );
  horizons.forEach((label, index) => {
    elements.push(
      box(origin, 204 + index * 372, 160, 356, 46, label, {
        background: [colors.green, colors.blue, colors.purple][index],
      })
    );
  });
  [
    "Customer value",
    "Operations",
    "Data & technology",
    "People & change",
  ].forEach((lane, row) => {
    const y = 218 + row * 112;
    elements.push(
      box(origin, 0, y, 190, 100, lane, { background: colors.soft })
    );
    horizons.forEach((_, column) => {
      elements.push(
        box(
          origin,
          204 + column * 372,
          y,
          356,
          100,
          "Outcome / bet\nEvidence · owner\nSuccess metric",
          {
            background: row % 2 === 0 ? colors.surface : colors.blue,
            fontSize: 14,
          }
        )
      );
    });
  });
  elements.push(
    ...table(
      origin,
      0,
      690,
      [220, 300, 240, 180, 170, 210],
      [
        [
          "Milestone / gate",
          "Evidence required",
          "Dependency",
          "Owner",
          "Date",
          "Decision",
        ],
        [
          "M1 · validate",
          "Customer / operational proof",
          "Team / platform",
          "Name",
          "Date",
          "Advance / adapt",
        ],
        [
          "M2 · scale",
          "Customer / operational proof",
          "Team / platform",
          "Name",
          "Date",
          "Advance / adapt",
        ],
      ],
      {
        header: "MILESTONES & DEPENDENCIES",
        headerBackground: colors.blue,
        rowHeight: 44,
      }
    )
  );
  return elements;
}

function buildDecisionLog(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Decision log",
    "Preserve decision context, authority, trade-offs, and the point at which to revisit.",
    1280,
    ["Project / forum", "Decision authority", "Log owner", "Review cadence"]
  );
  elements.push(
    ...table(
      origin,
      0,
      160,
      [90, 110, 270, 260, 150, 170, 230],
      [
        [
          "ID",
          "Date",
          "Decision",
          "Rationale / evidence",
          "Owner",
          "Impact",
          "Revisit trigger",
        ],
        [
          "D-01",
          "YYYY-MM-DD",
          "We will / will not...",
          "Options + trade-off",
          "Name",
          "Teams / KPI",
          "Date / threshold",
        ],
        [
          "D-02",
          "YYYY-MM-DD",
          "We will / will not...",
          "Options + trade-off",
          "Name",
          "Teams / KPI",
          "Date / threshold",
        ],
        [
          "D-03",
          "YYYY-MM-DD",
          "We will / will not...",
          "Options + trade-off",
          "Name",
          "Teams / KPI",
          "Date / threshold",
        ],
        [
          "D-04",
          "YYYY-MM-DD",
          "We will / will not...",
          "Options + trade-off",
          "Name",
          "Teams / KPI",
          "Date / threshold",
        ],
        [
          "D-05",
          "YYYY-MM-DD",
          "We will / will not...",
          "Options + trade-off",
          "Name",
          "Teams / KPI",
          "Date / threshold",
        ],
      ],
      {
        header: "COMMITTED DECISIONS",
        headerBackground: colors.purple,
        rowHeight: 56,
      }
    ),
    ...panel(
      origin,
      0,
      580,
      400,
      146,
      "OPEN DECISIONS",
      "Question · decision deadline\nOptions · required evidence\nDecision owner / forum",
      colors.amber
    ),
    ...panel(
      origin,
      420,
      580,
      400,
      146,
      "ASSUMPTIONS TO TEST",
      "Assumption · confidence\nTest / evidence owner\nTrigger to revisit",
      colors.blue
    ),
    ...panel(
      origin,
      840,
      580,
      440,
      146,
      "COMMUNICATION & ACTION",
      "Who needs to know?\nWhat changes now?\nOwner · due · confirmation",
      colors.green
    )
  );
  return elements;
}

function buildIncidentReview(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Incident review",
    "Build a blameless account of impact, causes, response quality, and prevention work.",
    1280,
    ["Incident / severity", "Incident lead", "Start → resolved", "Review date"]
  );
  elements.push(
    ...panel(
      origin,
      0,
      160,
      620,
      130,
      "IMPACT & SCOPE",
      "Customers / teams affected\nDuration · financial / operational impact\nHow impact was measured",
      colors.red
    ),
    ...panel(
      origin,
      640,
      160,
      640,
      130,
      "EXECUTIVE SUMMARY",
      "What happened · current status\nCustomer communication\nImmediate containment",
      colors.amber
    ),
    ...table(
      origin,
      0,
      310,
      [170, 330, 260, 250, 270],
      [
        ["Time", "Event / signal", "Response", "Owner", "What we knew then"],
        [
          "T+00",
          "Trigger / first symptom",
          "Action",
          "Name",
          "Evidence / uncertainty",
        ],
        [
          "T+__",
          "Detection / escalation",
          "Action",
          "Name",
          "Evidence / uncertainty",
        ],
        [
          "T+__",
          "Containment / recovery",
          "Action",
          "Name",
          "Evidence / uncertainty",
        ],
      ],
      {
        header: "FACTUAL TIMELINE",
        headerBackground: colors.red,
        rowHeight: 44,
      }
    ),
    ...panel(
      origin,
      0,
      534,
      400,
      146,
      "ROOT CAUSE & 5 WHYS",
      "Proximate cause\nSystemic contributors\nControl that failed / was missing",
      colors.red
    ),
    ...panel(
      origin,
      420,
      534,
      400,
      146,
      "WHAT HELPED / HINDERED",
      "Detection · coordination · tooling\nWhat reduced impact?\nWhere did response slow?",
      colors.blue
    ),
    ...panel(
      origin,
      840,
      534,
      440,
      146,
      "LEARNING & GUARDRAILS",
      "What surprised us?\nHow will we detect earlier?\nWhat policy / design changes?",
      colors.green
    ),
    ...table(
      origin,
      0,
      704,
      [400, 190, 170, 180, 340],
      [
        [
          "Corrective / preventive action",
          "Owner",
          "Due",
          "Priority",
          "Verification / success measure",
        ],
        [
          "Action that changes the system",
          "Name",
          "Date",
          "P0–P3",
          "Evidence the risk is reduced",
        ],
        [
          "Action that changes the system",
          "Name",
          "Date",
          "P0–P3",
          "Evidence the risk is reduced",
        ],
      ],
      {
        header: "FOLLOW-THROUGH",
        headerBackground: colors.green,
        rowHeight: 44,
      }
    )
  );
  return elements;
}

function buildCustomerJourney(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Customer journey",
    "Trace customer goals, experience signals, operational ownership, and improvement bets.",
    1400,
    [
      "Persona / segment",
      "Journey scenario",
      "Business outcome",
      "Research date",
    ]
  );
  const stages = ["AWARE", "EVALUATE", "START", "USE", "RENEW / ADVOCATE"];
  const rowLabels = [
    "Customer goal",
    "Actions & questions",
    "Touchpoints",
    "Emotion / confidence",
    "Pain & friction",
    "Opportunity / owner",
    "Metric / evidence",
  ];
  const labelWidth = 190;
  const columnWidth = 238;
  elements.push(
    box(origin, 0, 160, labelWidth, 44, "JOURNEY LENS", {
      background: colors.soft,
    })
  );
  stages.forEach((stage, column) => {
    elements.push(
      box(
        origin,
        labelWidth + 10 + column * columnWidth,
        160,
        columnWidth - 10,
        44,
        stage,
        { background: colors.pink }
      )
    );
  });
  rowLabels.forEach((label, row) => {
    const y = 216 + row * 88;
    elements.push(
      box(origin, 0, y, labelWidth, 78, label, {
        background: colors.soft,
        fontSize: 14,
      })
    );
    stages.forEach((_, column) => {
      const prompt =
        row === 3
          ? "Low  ○  ○  ○  ○  ○  High\nEvidence / quote"
          : row === 5
            ? "Improvement idea\nOwner · impact"
            : "Observation / evidence\nAdd notes here";
      elements.push(
        box(
          origin,
          labelWidth + 10 + column * columnWidth,
          y,
          columnWidth - 10,
          78,
          prompt,
          {
            background:
              row === 4
                ? colors.red
                : row === 5
                  ? colors.green
                  : colors.surface,
            fontSize: 12,
          }
        )
      );
    });
  });
  elements.push(
    ...table(
      origin,
      0,
      848,
      [370, 180, 180, 180, 220, 270],
      [
        [
          "Priority improvement",
          "Journey stage",
          "Owner",
          "Due",
          "Success metric",
          "Research / experiment",
        ],
        [
          "Improvement idea",
          "Stage",
          "Name",
          "Date",
          "KPI + target",
          "Research question / test",
        ],
      ],
      {
        header: "IMPROVEMENT BACKLOG",
        headerBackground: colors.pink,
        rowHeight: 42,
      }
    )
  );
  return elements;
}

function buildBrainstorm(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Structured brainstorm",
    "Move from a focused challenge to evidence-backed ideas, selection criteria, and owners.",
    1200,
    ["How might we…?", "Target outcome", "Decision owner", "Timebox"]
  );
  const panels = [
    [
      0,
      160,
      "SIGNALS & FACTS",
      "Customer evidence\nOperating data\nWhat is known?",
      colors.blue,
    ],
    [
      610,
      160,
      "QUESTIONS & ASSUMPTIONS",
      "What is uncertain?\nWhat must be true?\nWhat should we ask?",
      colors.purple,
    ],
    [
      0,
      380,
      "IDEAS & OPTIONS",
      "One idea per note\nBuild on ideas\nInclude bold alternatives",
      colors.amber,
    ],
    [
      610,
      380,
      "CONSTRAINTS & TRADE-OFFS",
      "Policy / cost / time\nRisks and dependencies\nWhat will we stop?",
      colors.red,
    ],
  ] as const;
  panels.forEach(([x, y, title, prompts, accent]) => {
    elements.push(...panel(origin, x, y, 590, 194, title, prompts, accent));
  });
  elements.push(
    ...table(
      origin,
      0,
      610,
      [320, 150, 150, 170, 180, 230],
      [
        [
          "Shortlisted idea",
          "Impact",
          "Effort",
          "Confidence",
          "Owner",
          "Next experiment / action",
        ],
        [
          "Idea 01",
          "H / M / L",
          "H / M / L",
          "__ / 10",
          "Name",
          "Test · evidence · date",
        ],
        [
          "Idea 02",
          "H / M / L",
          "H / M / L",
          "__ / 10",
          "Name",
          "Test · evidence · date",
        ],
      ],
      {
        header: "PRIORITIZE & COMMIT",
        headerBackground: colors.amber,
        rowHeight: 48,
      }
    )
  );
  return elements;
}

function buildFlow(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Decision & approval flow",
    "Define the happy path, exception handling, ownership, service levels, and controls.",
    1200,
    ["Process / decision", "Trigger", "Process owner", "Target SLA"]
  );
  elements.push(
    box(origin, 0, 248, 160, 88, "START\nRequest received", {
      background: colors.green,
    }),
    connector(origin, 160, 292, [
      [0, 0],
      [72, 0],
    ]),
    box(origin, 232, 248, 180, 88, "TRIAGE\nOwner · completeness", {
      background: colors.blue,
    }),
    connector(origin, 412, 292, [
      [0, 0],
      [72, 0],
    ]),
    box(
      origin,
      484,
      226,
      190,
      132,
      "DECISION\nCriteria met?\nEvidence required",
      { background: colors.amber }
    ),
    connector(origin, 674, 260, [
      [0, 0],
      [78, -88],
    ]),
    connector(origin, 674, 292, [
      [0, 0],
      [78, 0],
    ]),
    connector(origin, 674, 326, [
      [0, 0],
      [78, 88],
    ]),
    box(origin, 752, 116, 210, 88, "APPROVE\nAuthority · record", {
      background: colors.green,
    }),
    box(origin, 752, 248, 210, 88, "REWORK\nFeedback · due", {
      background: colors.blue,
    }),
    box(origin, 752, 380, 210, 88, "ESCALATE\nTrigger · forum", {
      background: colors.red,
    }),
    connector(origin, 962, 160, [
      [0, 0],
      [78, 0],
      [78, 132],
    ]),
    connector(origin, 962, 292, [
      [0, 0],
      [78, 0],
    ]),
    connector(origin, 962, 424, [
      [0, 0],
      [78, 0],
      [78, -132],
    ]),
    box(origin, 1040, 248, 160, 88, "CLOSE\nNotify · measure", {
      background: colors.purple,
    }),
    ...panel(
      origin,
      0,
      520,
      380,
      130,
      "DECISION RULES",
      "Criteria · thresholds\nRequired evidence\nDecision rights",
      colors.amber
    ),
    ...panel(
      origin,
      400,
      520,
      380,
      130,
      "SERVICE LEVELS",
      "Stage owner · target time\nQueue / handoff signal\nEscalation timer",
      colors.blue
    ),
    ...panel(
      origin,
      800,
      520,
      400,
      130,
      "CONTROLS & METRICS",
      "Quality check · audit evidence\nLead time · rework rate\nCustomer outcome",
      colors.green
    )
  );
  return elements;
}

function buildRetrospective(origin: WhiteboardTemplateOrigin): Skeleton[] {
  const elements = boardHeader(
    origin,
    "Outcome retrospective",
    "Inspect results and the operating system, then commit to measurable experiments.",
    1200,
    [
      "Period / initiative",
      "Intended outcome",
      "Facilitator",
      "Team confidence",
    ]
  );
  const sections = [
    [
      0,
      "WINS & STRENGTHS",
      "What worked?\nEvidence / result\nPractice to repeat",
      colors.green,
    ],
    [
      305,
      "FRICTIONS & GAPS",
      "What slowed us?\nObserved impact\nSystem / process cause",
      colors.red,
    ],
    [
      610,
      "INSIGHTS & SURPRISES",
      "What did we learn?\nAssumption changed\nCustomer / team signal",
      colors.blue,
    ],
    [
      915,
      "EXPERIMENTS",
      "What will we try?\nHypothesis\nSuccess signal",
      colors.purple,
    ],
  ] as const;
  sections.forEach(([x, title, prompts, accent]) => {
    elements.push(...panel(origin, x, 160, 285, 300, title, prompts, accent));
  });
  elements.push(
    ...table(
      origin,
      0,
      490,
      [380, 170, 160, 210, 280],
      [
        [
          "Action / experiment",
          "Owner",
          "Due",
          "Success measure",
          "Check-in / evidence",
        ],
        [
          "Change we control",
          "Name",
          "Date",
          "Metric + target",
          "When / where reviewed",
        ],
        [
          "Change we control",
          "Name",
          "Date",
          "Metric + target",
          "When / where reviewed",
        ],
        [
          "Change we control",
          "Name",
          "Date",
          "Metric + target",
          "When / where reviewed",
        ],
      ],
      { header: "COMMITMENTS", headerBackground: colors.green, rowHeight: 48 }
    )
  );
  return elements;
}

const templateBuilders: Record<WhiteboardTemplateId, TemplateBuilder> = {
  "strategy-map": buildStrategyMap,
  "okr-planning": buildOkrPlanning,
  "swot-analysis": buildSwotAnalysis,
  "operating-review": buildOperatingReview,
  "process-swimlane": buildProcessSwimlane,
  "raci-matrix": buildRaciMatrix,
  "risk-matrix": buildRiskMatrix,
  "project-kickoff": buildProjectKickoff,
  roadmap: buildRoadmap,
  "decision-log": buildDecisionLog,
  "incident-review": buildIncidentReview,
  "customer-journey": buildCustomerJourney,
  brainstorm: buildBrainstorm,
  flow: buildFlow,
  retrospective: buildRetrospective,
};

function markTemplate(
  templateId: WhiteboardTemplateId,
  elements: Skeleton[]
): Skeleton[] {
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

export function getBuiltInWhiteboardTemplate(templateId: WhiteboardTemplateId) {
  const template = BuiltInWhiteboardTemplates.find(
    (candidate) => candidate.id === templateId
  );
  if (!template) throw new Error(`unknown_whiteboard_template:${templateId}`);
  return template;
}

export function createBuiltInTemplateSkeleton(
  templateId: WhiteboardTemplateId,
  origin: WhiteboardTemplateOrigin
): Skeleton[] {
  return markTemplate(templateId, templateBuilders[templateId](origin));
}
