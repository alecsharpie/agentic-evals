// Batch runner: every model x format x task x trial, then a separate judging
// pass with one fixed judge model so "clear" scores are comparable across agents.

import type { AgentRun, ExperimentResults, Format, ScoredRun, VariantId } from "./types.ts";
import type { WebLLM } from "./llm.ts";
import { MAX_STEPS, runAgent } from "./agent.ts";
import { judgeRun } from "./judge.ts";
import { modelLabel } from "./models.ts";
import { scoreRun } from "./rubric.ts";
import { TASK_SETS, taskById, type TaskSetId } from "./tasks.ts";
import { VARIANTS, variantLabel } from "./variants.ts";

export interface ExperimentConfig {
  modelIds: string[];
  formats: Format[];
  variants: VariantId[];
  taskSet: TaskSetId;
  trials: number;
  temperature: number;
  judgeModelId: string;
}

export interface Progress {
  phase: "loading" | "agent" | "judging" | "done" | "stopped";
  message: string;
  done: number;
  total: number;
}

export interface ExperimentCallbacks {
  onProgress: (p: Progress) => void;
  onResults: (r: ExperimentResults) => void;
  /** Called at safe points (after each model, and at the end) so the caller can persist. */
  onCheckpoint: (r: ExperimentResults) => void;
  signal: AbortSignal;
}

// Temperature is part of the identity: one results file can hold a greedy run and a
// sampled sweep of the same cells without them colliding.
export const runKey = (r: Pick<AgentRun, "modelId" | "format" | "variant" | "taskId" | "trial" | "temperature">) =>
  `${r.modelId}|${r.format}|${r.variant}|${r.taskId}|${r.trial}@${r.temperature}`;

/** Every (variant, format) arm the config asks for. Variants that live in the JSON grammar have no free-text arm. */
export function arms(config: Pick<ExperimentConfig, "formats" | "variants">) {
  return VARIANTS.filter((v) => config.variants.includes(v.id)).flatMap((v) => v.formats.filter((f) => config.formats.includes(f)).map((format) => ({ variant: v.id, format })));
}

/** The key of every run the config asks for. */
export function plannedKeys(config: ExperimentConfig): string[] {
  return config.modelIds.flatMap((modelId) =>
    arms(config).flatMap((arm) => TASK_SETS[config.taskSet].flatMap((task) => Array.from({ length: config.trials }, (_, trial) => runKey({ modelId, ...arm, taskId: task.id, trial, temperature: config.temperature })))),
  );
}

/** Runs recorded before part 2 have no variant field; they are all baseline. */
export function normalise(results: ExperimentResults): ExperimentResults {
  for (const r of results.runs) r.variant ??= "base";
  return results;
}

export function emptyResults(config: ExperimentConfig, gpu: string): ExperimentResults {
  return {
    meta: {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      temperature: config.temperature,
      trials: config.trials,
      maxSteps: MAX_STEPS,
      judgeModelId: config.judgeModelId,
      gpu,
      userAgent: navigator.userAgent,
    },
    runs: [],
  };
}

/** Runs the experiment, skipping any run already present in `results` (so a stopped run can resume). */
export async function runExperiment(llm: WebLLM, config: ExperimentConfig, results: ExperimentResults, cb: ExperimentCallbacks): Promise<ExperimentResults> {
  const wanted = new Set(plannedKeys(config));
  const total = wanted.size;
  const have = new Set(results.runs.map(runKey));
  const publish = () => cb.onResults({ ...results, runs: [...results.runs] });
  const stopped = () => {
    cb.onProgress({ phase: "stopped", message: "Stopped. Run again to resume where it left off.", done: done(), total });
    return results;
  };
  const done = () => results.runs.filter((r) => wanted.has(runKey(r))).length;

  for (const modelId of config.modelIds) {
    const pending = arms(config)
      .flatMap(({ variant, format }) => TASK_SETS[config.taskSet].flatMap((task) => Array.from({ length: config.trials }, (_, trial) => ({ variant, format, task, trial }))))
      .filter(({ variant, format, task, trial }) => !have.has(runKey({ modelId, format, variant, taskId: task.id, trial, temperature: config.temperature })));
    if (pending.length === 0) continue;

    await llm.load(modelId, (p) =>
      cb.onProgress({ phase: "loading", message: `Loading ${modelLabel(modelId)}: ${p.text}`, done: done(), total }),
    );

    for (const { variant, format, task, trial } of pending) {
      if (cb.signal.aborted) return stopped();
      cb.onProgress({ phase: "agent", message: `${modelLabel(modelId)} · ${variantLabel(variant)} · ${format} · ${task.id}`, done: done(), total });
      const run = await runAgent(llm, task, { modelId, format, variant, trial, temperature: config.temperature });
      results.runs.push({ ...run, judge: null, score: scoreRun(task, run, null) });
      publish();
    }
    cb.onCheckpoint(results);
  }

  const unjudged = results.runs.filter((r) => r.answer !== null && r.judge?.modelId !== config.judgeModelId);
  if (unjudged.length) {
    await llm.load(config.judgeModelId, (p) =>
      cb.onProgress({ phase: "loading", message: `Loading judge ${modelLabel(config.judgeModelId)}: ${p.text}`, done: 0, total: unjudged.length }),
    );
    for (const [i, run] of unjudged.entries()) {
      if (cb.signal.aborted) return stopped();
      cb.onProgress({ phase: "judging", message: `Judging ${modelLabel(run.modelId)} · ${run.format} · ${run.taskId}`, done: i, total: unjudged.length });
      const task = taskById(run.taskId)!;
      const judged: ScoredRun = run;
      judged.judge = await judgeRun(llm, config.judgeModelId, task, run);
      judged.score = scoreRun(task, run, judged.judge);
      publish();
    }
  }

  results.meta.finishedAt = new Date().toISOString();
  results.meta.judgeModelId = config.judgeModelId;
  publish();
  cb.onCheckpoint(results);
  cb.onProgress({ phase: "done", message: "Experiment complete.", done: total, total });
  return results;
}

export async function saveResults(results: ExperimentResults, name: string): Promise<boolean> {
  try {
    const res = await fetch(`/__save-results?name=${name}`, { method: "POST", body: JSON.stringify(results) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadRecorded(name = "recorded"): Promise<ExperimentResults | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}results/${name}.json`, { cache: "no-store" });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return normalise((await res.json()) as ExperimentResults);
  } catch {
    return null;
  }
}
