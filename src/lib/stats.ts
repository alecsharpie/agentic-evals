// Aggregations over experiment results. Pure functions; the charts only render what these return.

import type { CriterionId, ExperimentResults, Format, Outcome, ScoredRun, VariantId } from "./types.ts";
import { MODELS } from "./models.ts";
import { RUBRIC } from "./rubric.ts";
import { TASKS, type Task, type Tier } from "./tasks.ts";

export interface ConfigStats {
  key: string;
  modelId: string;
  format: Format;
  n: number;
  successes: number;
  successRate: number;
  ci: [number, number];
  meanScore: number;
  criteria: Record<CriterionId, number>;
  outcomes: Record<Outcome, number>;
  byTier: Record<Tier, { n: number; successes: number }>;
  medianMs: number;
  meanSteps: number;
  tokensPerSecond: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 95% Wilson score interval for a proportion. */
export function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

export const FORMATS: Format[] = ["text", "json"];
export const FORMAT_LABEL: Record<Format, string> = { text: "Free-text ReAct", json: "Constrained JSON" };

/** Per model x format aggregates for one harness variant (part 1 is all "base"). */
export function configStats(results: ExperimentResults, variant: VariantId = "base", tasks: Task[] = TASKS): ConfigStats[] {
  const inSet = new Set(tasks.map((t) => t.id));
  const out: ConfigStats[] = [];
  // Fixed model order (smallest first) so colour and position follow the entity, not the data.
  for (const model of MODELS) {
    for (const format of FORMATS) {
      const runs = results.runs.filter((r) => r.modelId === model.id && r.format === format && (r.variant ?? "base") === variant && inSet.has(r.taskId));
      if (!runs.length) continue;
      const successes = runs.filter((r) => r.score.success).length;
      const criteria = Object.fromEntries(
        RUBRIC.map((c) => [c.id, mean(runs.map((r) => r.score.criteria.find((x) => x.id === c.id)?.score ?? 0))]),
      ) as Record<CriterionId, number>;
      const outcomes: Record<Outcome, number> = { correct: 0, wrong: 0, fabricated: 0, no_answer: 0 };
      for (const r of runs) outcomes[r.score.outcome]++;
      const byTier = {} as ConfigStats["byTier"];
      for (const task of tasks) {
        const tierRuns = runs.filter((r) => r.taskId === task.id);
        const t = (byTier[task.tier] ??= { n: 0, successes: 0 });
        t.n += tierRuns.length;
        t.successes += tierRuns.filter((r) => r.score.success).length;
      }
      const genMs = runs.reduce((s, r) => s + r.steps.reduce((a, st) => a + st.ms, 0), 0);
      out.push({
        key: `${model.id}|${format}`,
        modelId: model.id,
        format,
        n: runs.length,
        successes,
        successRate: successes / runs.length,
        ci: wilson(successes, runs.length),
        meanScore: mean(runs.map((r) => r.score.total)),
        criteria,
        outcomes,
        byTier,
        medianMs: median(runs.map((r) => r.totalMs)),
        meanSteps: mean(runs.map((r) => r.steps.length)),
        tokensPerSecond: genMs ? runs.reduce((s, r) => s + r.completionTokens, 0) / (genMs / 1000) : 0,
      });
    }
  }
  return out;
}

export interface JudgeAgreement {
  n: number;
  agree: number;
  /** judge said yes / code said yes, etc. */
  truePos: number;
  falsePos: number;
  falseNeg: number;
  trueNeg: number;
}

/** How often the LLM judge's correctness verdict matches the deterministic ground-truth check. */
export function judgeAgreement(runs: ScoredRun[]): JudgeAgreement {
  const a: JudgeAgreement = { n: 0, agree: 0, truePos: 0, falsePos: 0, falseNeg: 0, trueNeg: 0 };
  for (const r of runs) {
    if (!r.judge) continue;
    const truth = r.score.success;
    const said = r.judge.correct.verdict;
    a.n++;
    if (truth === said) a.agree++;
    if (truth && said) a.truePos++;
    else if (!truth && said) a.falsePos++;
    else if (truth && !said) a.falseNeg++;
    else a.trueNeg++;
  }
  return a;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

// ------------------------------------------------------------ part 2: paired comparisons

/** Decoding is greedy, so the same (model, format, task) under two harnesses is a true pair. */
export interface Flips {
  pairs: number;
  fixed: ScoredRun[]; // failed under baseline, solved under the variant
  broken: ScoredRun[]; // solved under baseline, failed under the variant
  baseSuccesses: number;
  variantSuccesses: number;
}

export function flips(runs: ScoredRun[], variant: VariantId, filter: (r: ScoredRun) => boolean = () => true): Flips {
  const key = (r: ScoredRun) => `${r.modelId}|${r.format}|${r.taskId}|${r.trial}@${r.temperature ?? 0}`;
  const base = new Map(runs.filter((r) => (r.variant ?? "base") === "base").map((r) => [key(r), r]));
  const out: Flips = { pairs: 0, fixed: [], broken: [], baseSuccesses: 0, variantSuccesses: 0 };
  for (const r of runs) {
    if (r.variant !== variant || !filter(r)) continue;
    const b = base.get(key(r));
    if (!b) continue;
    out.pairs++;
    if (b.score.success) out.baseSuccesses++;
    if (r.score.success) out.variantSuccesses++;
    if (!b.score.success && r.score.success) out.fixed.push(r);
    if (b.score.success && !r.score.success) out.broken.push(r);
  }
  return out;
}

/** Exact two-sided sign test on the discordant pairs (McNemar's exact test). */
export function signTest(fixed: number, broken: number): number {
  const n = fixed + broken;
  if (n === 0) return 1;
  const choose = (k: number) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c;
  };
  let tail = 0;
  for (let k = 0; k <= Math.min(fixed, broken); k++) tail += choose(k);
  return Math.min(1, (2 * tail) / 2 ** n);
}

export const variantsPresent = (runs: ScoredRun[]) => [...new Set(runs.map((r) => r.variant ?? "base"))];

/** The runs of one task set only. Parts 1-3 use v1; part 4 uses v2. */
export function taskSubset(results: ExperimentResults, tasks: Task[]): ExperimentResults {
  const inSet = new Set(tasks.map((t) => t.id));
  return { ...results, runs: results.runs.filter((r) => inSet.has(r.taskId)) };
}
