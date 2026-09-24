export type Format = "text" | "json";

/** Harness interventions tested in part 2. "base" is the original harness. */
export type VariantId = "base" | "guard" | "shots" | "guard+shots" | "cap" | "all" | "calc-only" | "shots-rev" | "three-hop";

/** Worked examples available to the prompt. */
export type ExampleId = "chain" | "calc" | "threehop";

export interface Harness {
  /** Refuse a repeated identical tool call and nudge the model to move on. */
  guard: boolean;
  /** Worked examples, in the order they appear in the prompt. */
  examples: ExampleId[];
  /** JSON only: cap the length of the free-form `thought` string in the grammar. */
  thoughtCap: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOpts {
  temperature: number;
  maxTokens: number;
  stop?: string[];
  /** JSON schema; when set, decoding is grammar-constrained to match it. */
  jsonSchema?: object;
  seed?: number;
  onToken?: (textSoFar: string) => void;
}

export interface Completion {
  text: string;
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

/** The only thing the agent and judge need from a model. */
export interface LLM {
  complete(messages: ChatMessage[], opts: CompletionOpts): Promise<Completion>;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type ParseStatus = "ok" | "repaired" | "failed";

export interface Step {
  index: number;
  raw: string;
  thought: string;
  parse: ParseStatus;
  parseNote?: string;
  call?: ToolCall;
  observation?: string;
  toolError?: boolean;
  /** The loop guard refused this call because it repeated an earlier one. */
  guarded?: boolean;
  ms: number;
  promptTokens: number;
  completionTokens: number;
}

export type StopReason = "finished" | "max_steps" | "parse_failures" | "error";

export interface AgentRun {
  taskId: string;
  modelId: string;
  format: Format;
  variant: VariantId;
  trial: number;
  temperature: number;
  steps: Step[];
  answer: string | null;
  stopReason: StopReason;
  error?: string;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
}

export type CriterionId = "correct" | "tools" | "grounded" | "efficient" | "wellformed" | "clear";

export interface CriterionScore {
  id: CriterionId;
  score: number; // 0..1
  detail: string;
}

export interface JudgeVerdict {
  verdict: boolean;
  reasoning: string;
  ms: number;
}

export interface JudgeResult {
  modelId: string;
  correct: JudgeVerdict;
  clear: JudgeVerdict;
}

export type Outcome = "correct" | "wrong" | "fabricated" | "no_answer";

export interface Score {
  criteria: CriterionScore[];
  total: number; // 0..100
  success: boolean;
  outcome: Outcome;
}

export interface ScoredRun extends AgentRun {
  judge: JudgeResult | null;
  score: Score;
}

export interface ExperimentMeta {
  startedAt: string;
  finishedAt: string | null;
  temperature: number;
  trials: number;
  maxSteps: number;
  judgeModelId: string;
  gpu: string;
  userAgent: string;
}

export interface ExperimentResults {
  meta: ExperimentMeta;
  runs: ScoredRun[];
}
