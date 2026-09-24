// The rubric. Five criteria are deterministic checks over the trace and the
// final answer; one ("clear") is delegated to an LLM judge. Weights sum to 100.

import type { AgentRun, CriterionId, CriterionScore, JudgeResult, Outcome, Score } from "./types.ts";
import type { Task } from "./tasks.ts";
import { EXAMPLE_VOCAB } from "./agent.ts";
import { TOOLS, WORLD_VOCAB, normId, normName } from "./tools.ts";

export interface Criterion {
  id: CriterionId;
  label: string;
  weight: number;
  grader: "code" | "judge";
  question: string;
}

export const RUBRIC: Criterion[] = [
  { id: "correct", label: "Correct answer", weight: 40, grader: "code", question: "Does the final answer state the ground-truth fact, and nothing that contradicts it?" },
  { id: "tools", label: "Right tool calls", weight: 20, grader: "code", question: "Did the agent make every tool call a correct solution needs, with the right arguments?" },
  { id: "grounded", label: "Grounded", weight: 15, grader: "code", question: "Does every number and named entity in the answer appear in the question or a tool observation?" },
  { id: "efficient", label: "Efficient", weight: 10, grader: "code", question: "Did it finish in the optimal number of steps? Each extra step costs a quarter of the credit." },
  { id: "wellformed", label: "Well-formed steps", weight: 5, grader: "code", question: "Did every model turn parse as a valid step without repair?" },
  { id: "clear", label: "Clear reply", weight: 10, grader: "judge", question: "Is the answer a clear, direct reply to the customer? Graded by the LLM judge." },
];

const numbersIn = (s: string) => (s.replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(\.\d+)?/g) ?? []).map(Number);

function successfulCalls(run: AgentRun) {
  return run.steps.filter((s) => s.call && s.call.tool !== "finish" && !s.toolError);
}

function checkCorrect(task: Task, answer: string | null): CriterionScore {
  if (answer === null) return { id: "correct", score: 0, detail: "No final answer was given." };
  const missing = task.mustMatch.filter((re) => !re.test(answer));
  const forbidden = (task.mustNotMatch ?? []).filter((re) => re.test(answer));
  if (missing.length) return { id: "correct", score: 0, detail: `Answer does not state the expected fact (${task.reference})` };
  if (forbidden.length) return { id: "correct", score: 0, detail: "Answer asserts something the ground truth rules out." };
  return { id: "correct", score: 1, detail: "Answer states the expected fact." };
}

function checkTools(task: Task, run: AgentRun): CriterionScore {
  // A call with the right argument counts even if the tool answered "not found":
  // for the missing-order task that error IS the expected observation.
  const calls = run.steps.filter((s) => s.call);
  const made = task.requiredCalls.filter((req) =>
    calls.some((s) => {
      if (s.call!.tool !== req.tool) return false;
      if (req.arg === undefined) return !s.toolError;
      const param = TOOLS.find((t) => t.name === req.tool)!.param;
      const value = s.call!.args[param];
      return req.tool === "get_product" ? normName(value).replace(/s$/, "") === req.arg : normId(value) === req.arg;
    }),
  );
  const missing = task.requiredCalls.filter((r) => !made.includes(r)).map((r) => (r.arg ? `${r.tool}(${r.arg})` : r.tool));
  if (task.requiredCalls.length === 0) return { id: "tools", score: 1, detail: "No tool can answer this; nothing was required." };
  return {
    id: "tools",
    score: made.length / task.requiredCalls.length,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : `All ${task.requiredCalls.length} required call(s) made.`,
  };
}

function checkGrounded(task: Task, run: AgentRun): CriterionScore {
  if (run.answer === null) return { id: "grounded", score: 0, detail: "No final answer was given." };
  if (task.requiredCalls.length > 0 && successfulCalls(run).length === 0 && !run.steps.some((s) => s.call && s.toolError)) {
    return { id: "grounded", score: 0, detail: "Answered without consulting any tool." };
  }
  // Evidence accumulates in order. A calculate result only counts if every number fed
  // into it was already evidence; otherwise an invented price could be laundered
  // through the calculator ("4 * 10" -> 40) and come out looking grounded.
  let evidence = task.question;
  let laundered = false;
  for (const s of run.steps) {
    if (s.call?.tool === "calculate" && !s.toolError) {
      const known = new Set(numbersIn(evidence));
      if (!numbersIn(String(s.call.args.expression ?? "")).every((n) => known.has(n))) {
        laundered = true;
        continue;
      }
    }
    evidence += `\n${s.observation ?? ""}`;
  }
  const evidenceNumbers = new Set(numbersIn(evidence));
  const evidenceLower = evidence.toLowerCase();
  const answerLower = run.answer.toLowerCase();

  const claims: { text: string; grounded: boolean }[] = [
    ...numbersIn(run.answer).map((n) => ({ text: String(n), grounded: evidenceNumbers.has(n) })),
    ...[...WORLD_VOCAB, ...EXAMPLE_VOCAB]
      .filter((term) => new RegExp(`\\b${term.toLowerCase()}\\b`).test(answerLower))
      .map((term) => ({ text: term, grounded: evidenceLower.includes(term.toLowerCase()) })),
  ];
  const ungrounded = claims.filter((c) => !c.grounded);
  if (claims.length === 0) return { id: "grounded", score: 1, detail: "No checkable claims in the answer." };
  return {
    id: "grounded",
    score: 1 - ungrounded.length / claims.length,
    detail: ungrounded.length
      ? `Not in any observation: ${ungrounded.map((c) => `"${c.text}"`).join(", ")}${laundered ? " (calculate was fed a number no tool returned)" : ""}`
      : `All ${claims.length} checkable claim(s) trace back to an observation.`,
  };
}

function checkEfficient(task: Task, run: AgentRun): CriterionScore {
  if (run.stopReason !== "finished") return { id: "efficient", score: 0, detail: `Did not finish (${run.stopReason.replace("_", " ")}).` };
  const extra = Math.max(0, run.steps.length - task.optimalSteps);
  // Fewer steps than optimal means it skipped a needed call; "tools" penalises that, not this.
  return {
    id: "efficient",
    score: Math.max(0, 1 - 0.25 * extra),
    detail: `${run.steps.length} step(s); optimal is ${task.optimalSteps}.`,
  };
}

function checkWellFormed(run: AgentRun): CriterionScore {
  if (run.steps.length === 0) return { id: "wellformed", score: 0, detail: "No steps." };
  const value = { ok: 1, repaired: 0.5, failed: 0 };
  const score = run.steps.reduce((sum, s) => sum + value[s.parse], 0) / run.steps.length;
  const bad = run.steps.filter((s) => s.parse !== "ok").length;
  return { id: "wellformed", score, detail: bad ? `${bad} of ${run.steps.length} step(s) needed repair or failed to parse.` : "Every step parsed cleanly." };
}

function checkClear(run: AgentRun, judge: JudgeResult | null): CriterionScore {
  if (run.answer === null) return { id: "clear", score: 0, detail: "No final answer was given." };
  if (!judge) return { id: "clear", score: 0, detail: "Not judged yet." };
  return { id: "clear", score: judge.clear.verdict ? 1 : 0, detail: `Judge: ${judge.clear.reasoning}` };
}

export function scoreRun(task: Task, run: AgentRun, judge: JudgeResult | null): Score {
  const criteria = [
    checkCorrect(task, run.answer),
    checkTools(task, run),
    checkGrounded(task, run),
    checkEfficient(task, run),
    checkWellFormed(run),
    checkClear(run, judge),
  ];
  const byId = Object.fromEntries(criteria.map((c) => [c.id, c.score]));
  const total = RUBRIC.reduce((sum, c) => sum + c.weight * byId[c.id], 0);

  let outcome: Outcome;
  if (run.answer === null) outcome = "no_answer";
  else if (byId.correct === 1) outcome = "correct";
  else outcome = byId.grounded < 1 ? "fabricated" : "wrong";

  return { criteria, total: Math.round(total * 10) / 10, success: byId.correct === 1, outcome };
}
