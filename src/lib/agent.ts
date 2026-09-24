// The ReAct loop: the model writes a thought and an action, we execute the
// (mocked) tool, feed the observation back, and repeat until it calls `finish`.
//
// Two wire formats are supported so they can be compared:
//   text  classic free-text "Thought / Action / Action Input", parsed with regexes
//   json  one JSON object per step, decoded under a grammar so it always parses

import type { AgentRun, ChatMessage, ExampleId, Format, Harness, LLM, ParseStatus, Step, ToolCall, VariantId } from "./types.ts";
import type { Task } from "./tasks.ts";
import { TOOLS, executeTool } from "./tools.ts";
import { variantById } from "./variants.ts";

export const MAX_STEPS = 8;
const MAX_TOKENS_PER_STEP = 160;
const MAX_CONSECUTIVE_PARSE_FAILURES = 2;
export const THOUGHT_CAP = 120;

const GUARD_MESSAGE =
  "You already made this exact call. Its result is in an earlier Observation. Do not repeat it: use that result to call a different tool, or use finish to answer.";

// ---------------------------------------------------------------- prompts

const toolList = TOOLS.map((t) => `- ${t.name}: ${t.description}. Input: {"${t.param}": "${t.example}"}`).join("\n");

const RULES = `Rules:
- Take one step at a time. After each step you will receive an Observation with the tool result.
- Never guess. Every fact in your answer must come from an Observation.
- Always use calculate for arithmetic.
- If a tool returns an error, tell the customer what could not be found.
- When you know the answer, use the finish action with one clear sentence.`;

const FORMAT_INSTRUCTIONS: Record<Format, string> = {
  text: `Use exactly this format for every step:
Thought: what you need to do next
Action: one tool name
Action Input: JSON input for the tool`,
  json: `Reply with exactly one JSON object for every step:
{"thought": "what you need to do next", "action": "one tool name", "input": {JSON input for the tool}}`,
};

export function systemPrompt(format: Format): string {
  return `You are a customer support agent for an online shop. Answer the customer's question by calling tools.

Tools:
${toolList}

${FORMAT_INSTRUCTIONS[format]}

${RULES}`;
}

export function renderStep(format: Format, thought: string, call: ToolCall): string {
  return format === "json"
    ? JSON.stringify({ thought, action: call.tool, input: call.args })
    : `Thought: ${thought}\nAction: ${call.tool}\nAction Input: ${JSON.stringify(call.args)}`;
}

/** Entities that exist only in the worked example. An answer that mentions them copied the prompt. */
export const EXAMPLE_VOCAB = ["B2000", "B3000", "TRK-900", "TRK-901", "Sam Lee", "Kim Cho", "Boise", "April 2", "tent", "tents"];

// Worked examples, given as real chat turns, all about fictional entities that appear
// in no task. Which ones a run sees, and in what order, is part of the harness.
//   chain     get_order -> track_shipment: carry an ID out of one observation into the next call
//   calc      get_product -> calculate: a looked-up price feeds the calculator
//   threehop  get_order -> get_product -> calculate: the full order-total path
function example(format: Format, id: ExampleId): ChatMessage[] {
  const a = (thought: string, tool: string, args: Record<string, unknown>): ChatMessage => ({
    role: "assistant",
    content: renderStep(format, thought, { tool, args }),
  });
  const u = (content: string): ChatMessage => ({ role: "user", content });
  switch (id) {
    case "chain":
      return [
        u("Question: Where is the parcel for order B2000 right now?"),
        a("I need the order to find its tracking ID.", "get_order", { order_id: "B2000" }),
        u('Observation: {"order_id":"B2000","customer":"Sam Lee","item":"tent","quantity":1,"status":"shipped","tracking_id":"TRK-900"}'),
        a("The tracking ID is TRK-900. I will track the shipment.", "track_shipment", { tracking_id: "TRK-900" }),
        u('Observation: {"tracking_id":"TRK-900","carrier":"NorthPost","location":"Boise","eta":"April 2"}'),
        a("The parcel is in Boise. I can answer now.", "finish", { answer: "The parcel for order B2000 is currently in Boise." }),
      ];
    case "calc":
      return [
        u("Question: How much do 2 tents cost in total?"),
        a("I need the price of a tent.", "get_product", { name: "tent" }),
        u('Observation: {"name":"tent","price":89,"in_stock":true}'),
        a("One tent costs 89. I will multiply by 2 with the calculator.", "calculate", { expression: "2 * 89" }),
        u('Observation: {"result":178}'),
        a("The total is 178. I can answer now.", "finish", { answer: "2 tents cost $178 in total." }),
      ];
    case "threehop":
      return [
        u("Question: What is the total value of order B3000?"),
        a("I need the order to see the item and the quantity.", "get_order", { order_id: "B3000" }),
        u('Observation: {"order_id":"B3000","customer":"Kim Cho","item":"tent","quantity":2,"status":"delivered","tracking_id":"TRK-901"}'),
        a("The order is 2 tents. I need the price of a tent.", "get_product", { name: "tent" }),
        u('Observation: {"name":"tent","price":89,"in_stock":true}'),
        a("One tent costs 89 and the quantity is 2. I will multiply with the calculator.", "calculate", { expression: "2 * 89" }),
        u('Observation: {"result":178}'),
        a("The total is 178. I can answer now.", "finish", { answer: "The total value of order B3000 is $178." }),
      ];
  }
}

export function initialMessages(format: Format, question: string, examples: ExampleId[] = ["chain"]): ChatMessage[] {
  return [{ role: "system", content: systemPrompt(format) }, ...examples.flatMap((id) => example(format, id)), { role: "user", content: `Question: ${question}` }];
}

/** Grammar for json mode: `action` picks the tool and pins the shape of `input` to that tool's parameter. */
export function stepSchema(thoughtCap = false): object {
  return {
    anyOf: TOOLS.map((t) => ({
      type: "object",
      properties: {
        thought: thoughtCap ? { type: "string", maxLength: THOUGHT_CAP } : { type: "string" },
        action: { enum: [t.name] },
        input: {
          type: "object",
          properties: { [t.param]: { type: "string" } },
          required: [t.param],
          additionalProperties: false,
        },
      },
      required: ["thought", "action", "input"],
      additionalProperties: false,
    })),
  };
}

// ---------------------------------------------------------------- parsing

export interface ParsedStep {
  parse: ParseStatus;
  note?: string;
  thought: string;
  call?: ToolCall;
  /** What goes back into the chat history as the assistant turn. */
  canonical: string;
}

/** First balanced {...} in `s`, respecting string literals. */
export function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseText(raw: string): ParsedStep {
  const failed = (note: string): ParsedStep => ({ parse: "failed", note, thought: raw.trim(), canonical: raw.trim() });

  const action = /Action\s*:\s*`?([A-Za-z_]+)/.exec(raw);
  if (!action) {
    // Classic ReAct ends with "Final Answer:". We asked for `finish`, so accept it as a repair.
    const final = /Final Answer\s*:\s*([\s\S]+)/i.exec(raw);
    if (!final) return failed("no 'Action:' line");
    const thought = (/Thought\s*:\s*([\s\S]*?)(?=Final Answer)/i.exec(raw)?.[1] ?? "").trim();
    const call = { tool: "finish", args: { answer: final[1].trim() } };
    return { parse: "repaired", note: "used 'Final Answer:' instead of the finish action", thought, call, canonical: renderStep("text", thought, call) };
  }

  const tool = action[1];
  const thought = (/Thought\s*:\s*([\s\S]*?)(?=\n?\s*Action\s*:)/.exec(raw)?.[1] ?? "").trim();
  const inputMatch = /Action\s*Input\s*:\s*([\s\S]*)/.exec(raw.slice(action.index));
  if (!inputMatch) return failed("no 'Action Input:' line");

  let args: Record<string, unknown> | null = null;
  let parse: ParseStatus = "ok";
  let note: string | undefined;

  const json = extractJsonObject(inputMatch[1]);
  if (json) {
    try {
      const value: unknown = JSON.parse(json);
      if (isRecord(value)) args = value;
    } catch {
      /* fall through to the bare-string repair */
    }
  }
  if (!args) {
    const param = TOOLS.find((t) => t.name === tool)?.param;
    const bare = inputMatch[1].split("\n")[0].trim().replace(/^["'`]|["'`]$/g, "");
    if (!param || !bare) return failed("Action Input is not valid JSON");
    args = { [param]: bare };
    parse = "repaired";
    note = "Action Input was not JSON; treated it as a bare value";
  }

  const call = { tool, args };
  return { parse, note, thought, call, canonical: renderStep("text", thought, call) };
}

function parseJson(raw: string): ParsedStep {
  const failed = (note: string): ParsedStep => ({ parse: "failed", note, thought: raw.trim(), canonical: raw.trim() });
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw) ?? raw);
  } catch {
    return failed("not valid JSON (truncated?)");
  }
  if (!isRecord(value) || typeof value.action !== "string") return failed("missing 'action'");
  const call = { tool: value.action, args: isRecord(value.input) ? value.input : {} };
  const thought = typeof value.thought === "string" ? value.thought : "";
  return { parse: "ok", thought, call, canonical: renderStep("json", thought, call) };
}

export const parseStep = (format: Format, raw: string): ParsedStep => (format === "json" ? parseJson(raw) : parseText(raw));

// ---------------------------------------------------------------- the loop

export interface AgentConfig {
  modelId: string;
  format: Format;
  variant?: VariantId;
  trial: number;
  temperature: number;
  maxSteps?: number;
}

export interface AgentEvents {
  /** Fires as tokens stream in for the step being generated. */
  onToken?: (stepIndex: number, textSoFar: string) => void;
  /** Fires after each completed step. */
  onStep?: (run: AgentRun) => void;
}

export async function runAgent(llm: LLM, task: Task, config: AgentConfig, events: AgentEvents = {}): Promise<AgentRun> {
  const maxSteps = config.maxSteps ?? MAX_STEPS;
  const variant = config.variant ?? "base";
  const harness: Harness = variantById(variant).harness;
  const messages = initialMessages(config.format, task.question, harness.examples);
  const seenCalls = new Set<string>();
  const run: AgentRun = {
    taskId: task.id,
    modelId: config.modelId,
    format: config.format,
    variant,
    trial: config.trial,
    temperature: config.temperature,
    steps: [],
    answer: null,
    stopReason: "max_steps",
    totalMs: 0,
    promptTokens: 0,
    completionTokens: 0,
  };
  const started = performance.now();
  let consecutiveParseFailures = 0;

  try {
    for (let index = 0; index < maxSteps; index++) {
      const completion = await llm.complete(messages, {
        temperature: config.temperature,
        maxTokens: MAX_TOKENS_PER_STEP,
        // Tiny models love to write their own Observation. Cut them off before they can.
        stop: config.format === "text" ? ["Observation:", "\nQuestion:"] : undefined,
        jsonSchema: config.format === "json" ? stepSchema(harness.thoughtCap) : undefined,
        seed: config.trial,
        onToken: events.onToken && ((text) => events.onToken!(index, text)),
      });

      const parsed = parseStep(config.format, completion.text);
      const step: Step = {
        index,
        raw: completion.text,
        thought: parsed.thought,
        parse: parsed.parse,
        parseNote: parsed.note,
        call: parsed.call,
        ms: completion.ms,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
      };
      run.steps.push(step);
      run.promptTokens += completion.promptTokens;
      run.completionTokens += completion.completionTokens;
      messages.push({ role: "assistant", content: parsed.canonical });

      if (!parsed.call) {
        step.observation = JSON.stringify({ error: `Could not read your step (${parsed.note}). Reply using exactly the required format.` });
        step.toolError = true;
        if (++consecutiveParseFailures >= MAX_CONSECUTIVE_PARSE_FAILURES) {
          run.stopReason = "parse_failures";
          events.onStep?.(run);
          break;
        }
      } else if (parsed.call.tool === "finish") {
        const answer = parsed.call.args.answer;
        run.answer = typeof answer === "string" ? answer.trim() : JSON.stringify(answer ?? "");
        run.stopReason = "finished";
        events.onStep?.(run);
        break;
      } else {
        consecutiveParseFailures = 0;
        const callKey = JSON.stringify([parsed.call.tool, parsed.call.args]);
        if (harness.guard && seenCalls.has(callKey)) {
          step.observation = JSON.stringify({ error: GUARD_MESSAGE });
          step.toolError = true;
          step.guarded = true;
        } else {
          seenCalls.add(callKey);
          const result = executeTool(parsed.call);
          step.observation = result.output;
          step.toolError = !result.ok;
        }
      }

      messages.push({ role: "user", content: `Observation: ${step.observation}` });
      events.onStep?.(run);
    }
  } catch (e) {
    run.stopReason = "error";
    run.error = (e as Error).message;
  }

  run.totalMs = Math.round(performance.now() - started);
  return run;
}
