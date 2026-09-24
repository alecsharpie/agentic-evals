// LLM-as-judge pass. It grades two things per run:
//   clear    feeds the rubric (there is no deterministic check for tone)
//   correct  does NOT feed the rubric; it is compared against the deterministic
//            ground truth to measure how far a tiny judge can be trusted.

import type { AgentRun, JudgeResult, JudgeVerdict, LLM } from "./types.ts";
import type { Task } from "./tasks.ts";

const VERDICT_SCHEMA = {
  type: "object",
  properties: { reasoning: { type: "string" }, verdict: { enum: ["yes", "no"] } },
  required: ["reasoning", "verdict"],
  additionalProperties: false,
};

const SYSTEM = `You are a strict grader of customer support replies. Reply with one JSON object: {"reasoning": "one short sentence", "verdict": "yes" or "no"}.`;

export function correctnessPrompt(task: Task, answer: string): string {
  return `Customer question: ${task.question}
Reference answer (ground truth): ${task.reference}
Agent reply: ${answer}

Does the agent reply state the same facts as the reference answer, without contradicting it? Answer "yes" or "no".`;
}

export function clarityPrompt(task: Task, answer: string): string {
  return `Customer question: ${task.question}
Agent reply: ${answer}

Is the agent reply a clear, direct answer to the customer's question, written as a normal sentence? Answer "no" if it is evasive, off-topic, raw data, or does not address the question. Answer "yes" or "no".`;
}

async function ask(llm: LLM, prompt: string): Promise<JudgeVerdict> {
  const completion = await llm.complete(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    { temperature: 0, maxTokens: 120, jsonSchema: VERDICT_SCHEMA },
  );
  try {
    const parsed = JSON.parse(completion.text) as { reasoning?: string; verdict?: string };
    return { verdict: parsed.verdict === "yes", reasoning: parsed.reasoning ?? "", ms: completion.ms };
  } catch {
    return { verdict: false, reasoning: "Judge output did not parse.", ms: completion.ms };
  }
}

export async function judgeRun(llm: LLM, modelId: string, task: Task, run: AgentRun): Promise<JudgeResult | null> {
  if (run.answer === null) return null;
  const correct = await ask(llm, correctnessPrompt(task, run.answer));
  const clear = await ask(llm, clarityPrompt(task, run.answer));
  return { modelId, correct, clear };
}
