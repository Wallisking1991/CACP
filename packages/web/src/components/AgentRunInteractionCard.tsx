import { useState } from "react";
import type { AgentRunNodeView } from "../room-state.js";

export interface AgentRunInteractionCardProps {
  runId: string;
  node: AgentRunNodeView;
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multi_select?: boolean;
}

function isQuestionArray(value: unknown): value is QuestionItem[] {
  return Array.isArray(value) && value.every((q) =>
    q && typeof q === "object" && typeof (q as Record<string, unknown>).question === "string"
  );
}

export function AgentRunInteractionCard({
  runId,
  node,
  onResolveApproval,
  onResolveElicitation
}: AgentRunInteractionCardProps) {
  if (node.kind === "approval") {
    return (
      <div className="agent-run-interaction">
        <button type="button" onClick={() => onResolveApproval?.(runId, node.node_id, "allow")}>Allow</button>
        <button type="button" onClick={() => onResolveApproval?.(runId, node.node_id, "deny")}>Deny</button>
      </div>
    );
  }

  if (node.kind === "elicitation") {
    const questions = node.detail?.questions;
    if (isQuestionArray(questions) && questions.length > 0) {
      return (
        <KimiQuestionForm
          runId={runId}
          nodeId={node.node_id}
          questions={questions}
          onResolveElicitation={onResolveElicitation}
        />
      );
    }

    return (
      <div className="agent-run-interaction">
        <button type="button" onClick={() => onResolveElicitation?.(runId, node.node_id, "accept", {})}>Accept</button>
        <button type="button" onClick={() => onResolveElicitation?.(runId, node.node_id, "decline")}>Decline</button>
        <button type="button" onClick={() => onResolveElicitation?.(runId, node.node_id, "cancel")}>Cancel</button>
      </div>
    );
  }

  return null;
}

interface KimiQuestionFormProps {
  runId: string;
  nodeId: string;
  questions: QuestionItem[];
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}

function KimiQuestionForm({ runId, nodeId, questions, onResolveElicitation }: KimiQuestionFormProps) {
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (let i = 0; i < questions.length; i++) {
      initial[i] = "";
    }
    return initial;
  });

  const handleOptionChange = (questionIndex: number, label: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      if (multiSelect) {
        const current = prev[questionIndex] ? prev[questionIndex].split(",") : [];
        const exists = current.includes(label);
        const next = exists ? current.filter((l) => l !== label) : [...current, label];
        return { ...prev, [questionIndex]: next.join(",") };
      }
      return { ...prev, [questionIndex]: label };
    });
  };

  const handleTextChange = (questionIndex: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionIndex]: value }));
  };

  const handleSubmit = () => {
    const payloadAnswers: Record<string, string> = {};
    for (let i = 0; i < questions.length; i++) {
      payloadAnswers[String(i)] = answers[i] ?? "";
    }
    onResolveElicitation?.(runId, nodeId, "accept", { answers: payloadAnswers });
  };

  const handleCancel = () => {
    onResolveElicitation?.(runId, nodeId, "cancel");
  };

  return (
    <div className="agent-run-interaction agent-run-interaction--questions">
      {questions.map((q, qi) => {
        const hasOptions = q.options && q.options.length > 0;
        const isMulti = !!q.multi_select;
        return (
          <div key={qi} className="agent-run-interaction__question">
            <div className="agent-run-interaction__question-text">{q.question}</div>
            {hasOptions ? (
              <div className="agent-run-interaction__options">
                {q.options!.map((opt) => (
                  <label key={opt.label} className="agent-run-interaction__option">
                    <input
                      type={isMulti ? "checkbox" : "radio"}
                      name={`question_${nodeId}_${qi}`}
                      value={opt.label}
                      checked={isMulti
                        ? (answers[qi] ?? "").split(",").includes(opt.label)
                        : answers[qi] === opt.label}
                      onChange={() => handleOptionChange(qi, opt.label, isMulti)}
                    />
                    <span>{opt.label}</span>
                    {opt.description && <span className="agent-run-interaction__option-desc">{opt.description}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                className="agent-run-interaction__text-input"
                value={answers[qi] ?? ""}
                onChange={(e) => handleTextChange(qi, e.target.value)}
                placeholder={q.header ?? "Your answer"}
              />
            )}
          </div>
        );
      })}
      <div className="agent-run-interaction__actions">
        <button type="button" onClick={handleSubmit}>Submit</button>
        <button type="button" onClick={handleCancel}>Cancel</button>
      </div>
    </div>
  );
}
