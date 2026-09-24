// Part 4: the same harnesses on a fresh task set. Does anything from parts 1-3 replicate?

import type { ExperimentResults, ScoredRun, VariantId } from "../lib/types.ts";
import { FORMATS, FORMAT_LABEL, pct, taskSubset, wilson } from "../lib/stats.ts";
import { TASKS, TASKS_V2, TASK_SET_LABEL, type Task, type TaskSetId } from "../lib/tasks.ts";
import { MODELS } from "../lib/models.ts";
import { PREDICTIONS_V2, VARIANTS, variantLabel } from "../lib/variants.ts";
import { Figure, HBars, Legend, type Series } from "./charts.tsx";

const SETS: { id: TaskSetId; tasks: Task[] }[] = [
  { id: "v1", tasks: TASKS },
  { id: "v2", tasks: TASKS_V2 },
];
const SET_SERIES: Series[] = SETS.map((s) => ({ key: s.id, label: TASK_SET_LABEL[s.id], color: `var(--series-${s.id})` }));

export const hasPart4 = (results: ExperimentResults) => taskSubset(results, TASKS_V2).runs.length > 0;

const solved = (runs: ScoredRun[]) => runs.filter((r) => r.score.success).length;

/** Success per harness on each task set, side by side. */
export function ReplicationFigure({ results }: { results: ExperimentResults }) {
  const cell = (v: VariantId, set: (typeof SETS)[number]) => taskSubset(results, set.tasks).runs.filter((r) => (r.variant ?? "base") === v);
  // Only harnesses that were run on both sets can be compared across them.
  const rows = VARIANTS.map((v) => ({ v: v.id, cells: SETS.map((set) => ({ set, runs: cell(v.id, set) })) })).filter((row) => row.cells.every((c) => c.runs.length));
  return (
    <Figure
      title="Does it replicate? Success by harness on the original and fresh task sets"
      sub="All four models, both formats: 96 runs per bar. Thin line: 95% Wilson interval."
      table={{
        columns: ["Harness", ...SETS.map((s) => TASK_SET_LABEL[s.id])],
        rows: rows.map((row) => [variantLabel(row.v), ...row.cells.map((c) => `${solved(c.runs)}/${c.runs.length}`)]),
      }}
    >
      <Legend series={SET_SERIES} />
      <HBars
        rows={rows.map((row) => ({
          key: row.v,
          label: variantLabel(row.v),
          bars: row.cells.map((c) => {
            const n = c.runs.length;
            const k = solved(c.runs);
            const ci = wilson(k, n);
            return { series: c.set.id, value: k / n, lo: ci[0], hi: ci[1], label: `${k}/${n}`, tip: `${variantLabel(row.v)} · ${TASK_SET_LABEL[c.set.id]}\n${k} of ${n} solved (${pct(k / n)})\n95% interval ${pct(ci[0])}–${pct(ci[1])}` };
          }),
        }))}
        series={SET_SERIES}
        max={1}
        ticks={[0, 0.25, 0.5, 0.75, 1]}
        formatTick={pct}
      />
    </Figure>
  );
}

/** Baseline success per model on each set: is the size ladder the same? */
export function LadderFigure({ results }: { results: ExperimentResults }) {
  const rows = MODELS.flatMap((m) =>
    FORMATS.map((f) => ({
      key: `${m.id}|${f}`,
      label: m.label,
      sub: FORMAT_LABEL[f],
      cells: SETS.map((set) => ({ set, runs: taskSubset(results, set.tasks).runs.filter((r) => r.modelId === m.id && r.format === f && (r.variant ?? "base") === "base") })),
    })),
  ).filter((row) => row.cells.every((c) => c.runs.length));
  return (
    <Figure
      title="The size ladder, on both task sets"
      sub="Baseline harness only. Each bar is 12 tasks."
      table={{ columns: ["Model", "Format", ...SETS.map((s) => TASK_SET_LABEL[s.id])], rows: rows.map((r) => [r.label, r.sub, ...r.cells.map((c) => `${solved(c.runs)}/${c.runs.length}`)]) }}
    >
      <Legend series={SET_SERIES} />
      <HBars
        rows={rows.map((row) => ({
          key: row.key,
          label: row.label,
          sub: row.sub,
          bars: row.cells.map((c) => ({ series: c.set.id, value: solved(c.runs) / c.runs.length, label: `${solved(c.runs)}/${c.runs.length}`, tip: `${row.label} · ${row.sub} · ${TASK_SET_LABEL[c.set.id]}\n${solved(c.runs)} of ${c.runs.length} solved` })),
        }))}
        series={SET_SERIES}
        max={1}
        ticks={[0, 0.25, 0.5, 0.75, 1]}
        formatTick={pct}
      />
    </Figure>
  );
}

export function PredictionsV2({ verdicts }: { verdicts: { verdict: string; evidence: string }[] }) {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Harness</th>
            <th>Prediction, written before the runs</th>
            <th>Verdict</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {PREDICTIONS_V2.map((p, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{variantLabel(p.variant)}</td>
              <td>{p.claim}</td>
              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{verdicts[i]?.verdict ?? "Pending"}</td>
              <td>{verdicts[i]?.evidence ?? "Awaiting the run."}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
