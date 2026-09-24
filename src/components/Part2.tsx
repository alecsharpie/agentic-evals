// Part 2 figures: the same tasks and models under different harnesses. Decoding is
// greedy, so each (model, format, task) is a true pair across harnesses and the
// honest summary is which pairs flipped, not a difference of two noisy rates.

import { useState } from "react";
import type { ExperimentResults, Outcome, ScoredRun, VariantId } from "../lib/types.ts";
import { MODELS, modelLabel } from "../lib/models.ts";
import { FORMATS, FORMAT_LABEL, flips, pct, signTest, variantsPresent } from "../lib/stats.ts";
import { TASKS, taskById, type Task } from "../lib/tasks.ts";
import { VARIANTS, variantLabel } from "../lib/variants.ts";
import { Figure, HBars, Heatmap, StackRows, useTip } from "./charts.tsx";
import { TaskMatrix } from "./ResultsViz.tsx";
import { OUTCOME } from "./Scorecard.tsx";

const OUTCOMES: Outcome[] = ["correct", "wrong", "fabricated", "no_answer"];
const isVariant = (v: VariantId) => (r: ScoredRun) => (r.variant ?? "base") === v;
const solved = (runs: ScoredRun[]) => runs.filter((r) => r.score.success).length;

const idsOfPart = (part: 2 | 3) => VARIANTS.filter((v) => v.part === part).map((v) => v.id);
export const PART2: VariantId[] = ["base", ...idsOfPart(2)];
/** Part 3 is read against both the baseline and part 2's two-example harness, which it dissects. */
export const PART3: VariantId[] = ["base", "shots", ...idsOfPart(3)];

export const hasPart = (results: ExperimentResults, part: 2 | 3) => variantsPresent(results.runs).some((v) => idsOfPart(part).includes(v));
export const hasPart2 = (results: ExperimentResults) => hasPart(results, 2);

/** The requested variants that actually have runs, in canonical order. */
function usePresent(results: ExperimentResults, ids: VariantId[]) {
  const present = new Set(variantsPresent(results.runs));
  return VARIANTS.filter((v) => ids.includes(v.id) && present.has(v.id));
}

interface PartProps {
  /** Already restricted to one task set (see taskSubset). */
  results: ExperimentResults;
  ids: VariantId[];
  tasks?: Task[];
}

// ------------------------------------------------------------ success grid

export function InterventionGrid({ results, ids }: PartProps) {
  const variants = usePresent(results, ids);
  const rows = MODELS.flatMap((m) => FORMATS.map((f) => ({ key: `${m.id}|${f}`, label: m.label, sub: FORMAT_LABEL[f], modelId: m.id, format: f }))).filter((row) =>
    results.runs.some((r) => r.modelId === row.modelId && r.format === row.format),
  );
  const cellRuns = (rowKey: string, v: VariantId) => results.runs.filter((r) => `${r.modelId}|${r.format}` === rowKey && isVariant(v)(r));

  return (
    <Figure
      title="Task success under each harness"
      sub="Tasks solved, per model and step format. Empty cells are harnesses that have no free-text arm."
      table={{
        columns: ["Model", "Format", ...variants.map((v) => v.label)],
        rows: rows.map((row) => [row.label, row.sub, ...variants.map((v) => (cellRuns(row.key, v.id).length ? `${solved(cellRuns(row.key, v.id))}/${cellRuns(row.key, v.id).length}` : "n/a"))]),
      }}
    >
      <Heatmap
        rows={rows}
        columns={variants.map((v) => ({ key: v.id, label: v.label }))}
        cell={(rowKey, v) => {
          const runs = cellRuns(rowKey, v as VariantId);
          if (!runs.length) return null;
          const row = rows.find((r) => r.key === rowKey)!;
          return { value: solved(runs) / runs.length, text: `${solved(runs)}/${runs.length}`, tip: `${row.label} · ${row.sub}\n${variantLabel(v as VariantId)}: ${solved(runs)} of ${runs.length} solved` };
        }}
        scaleLabel={["none solved", "all solved"]}
      />
    </Figure>
  );
}

// ------------------------------------------------------------ paired flips (diverging bars)

const describe = (r: ScoredRun) => `${modelLabel(r.modelId)} ${r.format}: ${taskById(r.taskId)?.id}`;

export function FlipsFigure({ results, ids }: PartProps) {
  const tip = useTip();
  const rows = usePresent(results, ids)
    .filter((v) => v.id !== "base")
    .map((v) => ({ v, f: flips(results.runs, v.id) }));
  const max = Math.max(4, ...rows.flatMap(({ f }) => [f.fixed.length, f.broken.length]));
  // 42, not 50: leaves room for the value label beyond the longest bar.
  const half = (n: number) => `${(n / max) * 42}%`;
  const list = (runs: ScoredRun[]) => (runs.length ? runs.map(describe).join("\n") : "none");

  return (
    <Figure
      title="What each harness change fixed, and what it broke"
      sub="Paired against the baseline run of the same model, format and task. Only pairs whose outcome changed are drawn."
      table={{
        columns: ["Harness", "Pairs", "Baseline solved", "Harness solved", "Fixed", "Broken", "Net", "Sign test p"],
        rows: rows.map(({ v, f }) => [v.label, f.pairs, f.baseSuccesses, f.variantSuccesses, f.fixed.length, f.broken.length, f.fixed.length - f.broken.length, signTest(f.fixed.length, f.broken.length).toFixed(3)]),
      }}
    >
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: "var(--critical)" }} />← Broken: solved at baseline, failed under the harness
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--series-text)" }} />
          Fixed: failed at baseline, solved under the harness →
        </span>
      </div>
      <div className="hbars">
        {rows.map(({ v, f }) => {
          const p = signTest(f.fixed.length, f.broken.length);
          const net = f.fixed.length - f.broken.length;
          return (
            <div key={v.id} style={{ display: "contents" }}>
              <div className="hbars-label">
                {v.label}
                <small>
                  {f.baseSuccesses} → {f.variantSuccesses} of {f.pairs} · p {p < 0.001 ? "< 0.001" : `= ${p.toFixed(3)}`}
                </small>
              </div>
              <div style={{ position: "relative", height: 24, margin: "8px 0" }}>
                <i style={{ position: "absolute", left: "50%", top: -6, bottom: -6, width: 1, background: "var(--axis)" }} />
                <div
                  className="hit"
                  {...tip(`${v.label} broke ${f.broken.length}:\n${list(f.broken)}`)}
                  style={{ position: "absolute", right: "50%", top: 4, height: 16, width: half(f.broken.length), background: "var(--critical)", borderRadius: "4px 0 0 4px", marginRight: 1 }}
                />
                <div
                  className="hit"
                  {...tip(`${v.label} fixed ${f.fixed.length}:\n${list(f.fixed)}`)}
                  style={{ position: "absolute", left: "50%", top: 4, height: 16, width: half(f.fixed.length), background: "var(--series-text)", borderRadius: "0 4px 4px 0", marginLeft: 1 }}
                />
                <span className="hbar-value" style={{ right: `calc(50% + ${half(f.broken.length)})`, paddingRight: 8, paddingLeft: 0 }}>
                  {f.broken.length ? `−${f.broken.length}` : ""}
                </span>
                <span className="hbar-value" style={{ left: `calc(50% + ${half(f.fixed.length)})` }}>
                  +{f.fixed.length}
                  <span className="muted"> · net {net >= 0 ? "+" : "−"}{Math.abs(net)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Figure>
  );
}

// ------------------------------------------------------------ outcomes by harness

export function VariantOutcomes({ results, ids }: PartProps) {
  const variants = usePresent(results, ids);
  const row = (key: string, label: string, sub: string, runs: ScoredRun[]) => ({
    key,
    label,
    sub,
    segments: OUTCOMES.map((o) => {
      const count = runs.filter((r) => r.score.outcome === o).length;
      return { key: o, count, color: OUTCOME[o].color, ink: OUTCOME[o].ink, tip: `${label} (${sub})\n${OUTCOME[o].label}: ${count} of ${runs.length} runs (${pct(count / runs.length)})` };
    }),
  });
  // Two comparable groups: harnesses with both formats, and JSON-only harnesses against the JSON half of the baseline.
  const both = variants.filter((v) => v.formats.length === 2);
  const jsonOnly = variants.filter((v) => v.formats.length === 1);
  const rows = [
    ...both.map((v) => row(v.id, v.label, "all models, both formats", results.runs.filter(isVariant(v.id)))),
    ...(jsonOnly.length ? [row("base-json", "Baseline", "JSON runs only", results.runs.filter((r) => isVariant("base")(r) && r.format === "json"))] : []),
    ...jsonOnly.map((v) => row(v.id, v.label, "JSON runs only", results.runs.filter(isVariant(v.id)))),
  ].filter((r) => r.segments.some((s) => s.count));

  return (
    <Figure
      title="How runs end under each harness"
      sub="Every run lands in exactly one bucket. An intervention that produces more answers has not necessarily produced more right ones."
      table={{ columns: ["Harness", "Scope", ...OUTCOMES.map((o) => OUTCOME[o].label)], rows: rows.map((r) => [r.label, r.sub, ...r.segments.map((s) => s.count)]) }}
    >
      <div className="legend">
        {OUTCOMES.map((o) => (
          <span key={o}>
            <i className="swatch" style={{ background: OUTCOME[o].color }} />
            {OUTCOME[o].glyph} {OUTCOME[o].label}
          </span>
        ))}
      </div>
      <StackRows rows={rows} />
    </Figure>
  );
}

// ------------------------------------------------------------ per task

export function TaskByVariant({ results, ids, tasks = TASKS }: PartProps) {
  const variants = usePresent(results, ids);
  const cellRuns = (taskId: string, v: VariantId) => results.runs.filter((r) => r.taskId === taskId && isVariant(v)(r));
  return (
    <Figure
      title="Which tasks moved"
      sub="Configurations (model × format) that solved each task, out of 8, or out of 4 for JSON-only harnesses."
      table={{
        columns: ["Task", ...variants.map((v) => v.label)],
        rows: tasks.map((t) => [t.question, ...variants.map((v) => `${solved(cellRuns(t.id, v.id))}/${cellRuns(t.id, v.id).length}`)]),
      }}
    >
      <Heatmap
        rows={tasks.map((t) => ({ key: t.id, label: t.question }))}
        columns={variants.map((v) => ({ key: v.id, label: v.label }))}
        cell={(taskId, v) => {
          const runs = cellRuns(taskId, v as VariantId);
          if (!runs.length) return null;
          return { value: solved(runs) / runs.length, text: `${solved(runs)}/${runs.length}`, tip: `${taskById(taskId)!.question}\n${variantLabel(v as VariantId)}: solved by ${solved(runs)} of ${runs.length} configurations` };
        }}
        scaleLabel={["solved by none", "solved by all"]}
        wideLabels
      />
    </Figure>
  );
}

// ------------------------------------------------------------ traces, per harness

export function VariantMatrix({ results, ids, tasks = TASKS }: PartProps) {
  const variants = usePresent(results, ids).filter((v) => v.id !== "base");
  const [variant, setVariant] = useState<VariantId>(variants.at(-1)?.id ?? "base");
  if (!variants.length) return null;
  return (
    <>
      <div className="segmented" style={{ maxWidth: 720, margin: "0 0 -12px" }} role="group" aria-label="Harness">
        {variants.map((v) => (
          <button key={v.id} aria-pressed={variant === v.id} onClick={() => setVariant(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <TaskMatrix results={results} variant={variant} tasks={tasks} />
    </>
  );
}

// ------------------------------------------------------------ mechanism: premature finishing

const missedACall = (r: ScoredRun) => (r.score.criteria.find((c) => c.id === "tools")?.score ?? 0) < 1;

/** Of the runs that gave an answer, how many gave it before making every call a correct solution needs. */
export function PrematureFigure({ results, ids }: PartProps) {
  const rows = usePresent(results, ids).map((v) => {
    const answered = results.runs.filter((r) => isVariant(v.id)(r) && r.answer !== null);
    const early = answered.filter(missedACall);
    return { v, answered: answered.length, early: early.length, rate: answered.length ? early.length / answered.length : 0 };
  });
  return (
    <Figure
      title="Answering too early"
      sub="Share of answered runs that finished before making every tool call a correct solution needs. This is the mechanism part 2 blamed."
      table={{ columns: ["Harness", "Answered runs", "Answered too early", "Share"], rows: rows.map((r) => [r.v.label, r.answered, r.early, pct(r.rate)]) }}
    >
      <HBars
        rows={rows.map((r) => ({
          key: r.v.id,
          label: r.v.label,
          sub: `${r.early} of ${r.answered} answers`,
          bars: [{ series: "early", value: r.rate, label: pct(r.rate), tip: `${r.v.label}\n${r.early} of ${r.answered} answered runs skipped a required call (${pct(r.rate)})` }],
        }))}
        series={[{ key: "early", label: "Answered too early", color: "var(--series-text)" }]}
        max={1}
        ticks={[0, 0.25, 0.5, 0.75, 1]}
        formatTick={pct}
      />
    </Figure>
  );
}
