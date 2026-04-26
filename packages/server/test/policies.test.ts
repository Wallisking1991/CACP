import { describe, expect, it } from "vitest";
import type { Participant, Policy } from "@cacp/protocol";
import { evaluateQuestionPolicy } from "../src/policies.js";

const participants: Participant[] = [
  { id: "owner", type: "human", display_name: "Owner", role: "owner" },
  { id: "member", type: "human", display_name: "Member", role: "member" },
  { id: "observer", type: "observer", display_name: "Watcher", role: "observer" },
  { id: "agent", type: "agent", display_name: "AI", role: "agent" }
];

function result(policy: Policy, responses: Array<{ respondent_id: string; response: unknown }>) {
  return evaluateQuestionPolicy({ policy, participants, responses });
}

describe("question policy evaluation", () => {
  it("closes owner approval when the owner chooses an option", () => {
    expect(result({ type: "owner_approval" }, [{ respondent_id: "owner", response: "A" }])).toEqual({ status: "closed", selected_response: "A", decided_by: ["owner"] });
  });

  it("closes majority only when an option has more than half of eligible human voters", () => {
    expect(result({ type: "majority" }, [{ respondent_id: "owner", response: "A" }]).status).toBe("open");
    expect(result({ type: "majority" }, [
      { respondent_id: "owner", response: "B" },
      { respondent_id: "member", response: "B" }
    ])).toEqual({ status: "closed", selected_response: "B", decided_by: ["owner", "member"] });
  });

  it("requires unanimous agreement from all eligible human voters", () => {
    expect(result({ type: "unanimous" }, [{ respondent_id: "owner", response: "A" }]).status).toBe("open");
    expect(result({ type: "unanimous" }, [
      { respondent_id: "owner", response: "A" },
      { respondent_id: "member", response: "B" }
    ]).status).toBe("open");
    expect(result({ type: "unanimous" }, [
      { respondent_id: "owner", response: "A" },
      { respondent_id: "member", response: "A" }
    ])).toEqual({ status: "closed", selected_response: "A", decided_by: ["owner", "member"] });
  });

  it("ignores observer and agent responses and uses the latest response per voter", () => {
    expect(result({ type: "majority" }, [
      { respondent_id: "observer", response: "A" },
      { respondent_id: "agent", response: "A" },
      { respondent_id: "owner", response: "A" },
      { respondent_id: "owner", response: "B" },
      { respondent_id: "member", response: "B" }
    ])).toEqual({ status: "closed", selected_response: "B", decided_by: ["owner", "member"] });
  });
});
