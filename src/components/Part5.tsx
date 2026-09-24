// Part 5: every result in parts 1-4 came from one greedy decoding per cell. These
// figures resample the baseline harness and ask how much that single choice decided.

import type { ExperimentResults } from "../lib/types.ts";
import { FORMAT_LABEL, solveCounts, varianceStats, type VarianceCell } from "../lib/stats.ts";
import { TASKS, taskById } from "../lib/tasks.ts";
import { modelLabel } from "../lib/models.ts";
import { PREDICTIONS_VAR } from "../lib/variants.ts";
import { Figure, Heatmap, useTip } from "./charts.tsx";

export const SAMPLED_TEMP = 0.7;

export const hasPart5 = (results: ExperimentResults) => results.runs.some((r) => (r.temperature ?? 0) === SAMPLED_TEMP);

const useVariance = (results: ExperimentResults) => varianceStats(results, TASKS, SAMPLED_TEMP);

/** Greedy as a point against the range of sampled trials, per configuration. */
export function SpreadFigure({ results }: { results: ExperimentResults }) {
  const tip = useTip();
  const rows = useVariance(results);
  if (!rows.length) return null;
  const max = TASKS.length;
  const x = (v: number) => `${(v / max) * 100}%`;
  const trials = rows[0].samples.length;

  return (
    <Figure
      title="One greedy run against five sampled ones"
      sub={`Baseline harness, original ${max} tasks. The bar spans the worst and best of ${trials} samples at temperature ${SAMPLED_TEMP}; the dot is their mean, the ring is the greedy result every earlier part reports.`}
      table={{
        columns: ["Model", "Format", "Greedy", ...rows[0].samples.map((_, i) => `Trial ${i + 1}`), "Mean", "SD", "Range"],
        rows: rows.map((r) => [modelLabel(r.modelId), FORMAT_LABEL[r.format], r.greedy ?? "-", ...r.samples, r.mean.toFixed(1), r.sd.toFixed(2), r.max - r.min]),
      }}
    >
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: "var(--series-v2)" }} />
          Sampled range and mean
        </span>
        <span>
          <i className="swatch" style={{ background: "transparent", border: "2px solid var(--ink)", borderRadius: "50%", width: 11, height: 11 }} />
          Greedy (temperature 0)
        </span>
      </div>
      <div className="hbars">
        {rows.map((r) => (
          <div key={`${r.modelId}|${r.format}`} style={{ display: "contents" }}>
            <div className="hbars-label">
              {modelLabel(r.modelId)}
              <small>{FORMAT_LABEL[r.format]}</small>
            </div>
            <div className="hbars-plot">
              <div className="hbars-gridlines">
                {[0, 3, 6, 9, 12].map((t) => (
                  <i key={t} style={{ left: x(t) }} />
                ))}
              </div>
              <div
                className="hbars-track hit"
                {...tip(`${modelLabel(r.modelId)} · ${FORMAT_LABEL[r.format]}\nGreedy ${r.greedy ?? "-"}/${r.tasks}\nSampled ${r.samples.join(", ")} (mean ${r.mean.toFixed(1)}, SD ${r.sd.toFixed(2)})`)}
                style={{ height: 18 }}
              >
                {/* range */}
                <div style={{ position: "absolute", left: x(r.min), width: x(r.max - r.min), top: 7, height: 4, background: "var(--series-v2)", borderRadius: 2, minWidth: 3 }} />
                {/* mean */}
                <div style={{ position: "absolute", left: x(r.mean), top: 3, width: 12, height: 12, marginLeft: -6, borderRadius: "50%", background: "var(--series-v2)", boxShadow: "0 0 0 2px var(--surface)" }} />
                {/* greedy */}
                {r.greedy !== null && (
                  <div style={{ position: "absolute", left: x(r.greedy), top: 2, width: 14, height: 14, marginLeft: -7, borderRadius: "50%", border: "2px solid var(--ink)", background: "transparent", boxShadow: "0 0 0 2px var(--surface)" }} />
                )}
                {/* clear the 14px greedy ring, which sits at the same x as the label anchor */}
                <div className="hbar-value" style={{ left: x(Math.max(r.max, r.greedy ?? 0)), paddingLeft: 13 }}>
                  {r.min === r.max ? `${r.mean.toFixed(0)}` : `${r.min}–${r.max}`}
                  <span className="muted"> vs {r.greedy ?? "-"}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        <div />
        <div className="hbars-axis">
          {[0, 3, 6, 9, 12].map((t) => (
            <span key={t} style={{ left: x(t) }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </Figure>
  );
}

/** Is a task a coin flip, or is it decided? */
export function BimodalFigure({ results }: { results: ExperimentResults }) {
  const tip = useTip();
  const cells = solveCounts(results, TASKS, SAMPLED_TEMP);
  if (!cells.length) return null;
  const of = cells[0].of;
  const buckets = Array.from({ length: of + 1 }, (_, k) => ({ k, n: cells.filter((c) => c.solved === k).length }));
  const max = Math.max(...buckets.map((b) => b.n), 1);
  const decided = buckets[0].n + buckets[of].n;

  return (
    <Figure
      title="Is a task decided, or a coin flip?"
      sub={`Each of the ${cells.length} model × format × task cells was sampled ${of} times. If the eval measured luck, the middle bars would dominate.`}
      table={{ columns: [`Solved (of ${of})`, "Cells", "Share"], rows: buckets.map((b) => [b.k, b.n, `${Math.round((b.n / cells.length) * 100)}%`]) }}
    >
      <div className="hbars">
        {buckets.map((b) => (
          <div key={b.k} style={{ display: "contents" }}>
            <div className="hbars-label">
              {b.k} of {of}
              <small>{b.k === 0 ? "never solved" : b.k === of ? "always solved" : "sometimes"}</small>
            </div>
            <div className="hbars-plot">
              <div className="hbars-track hit" {...tip(`Solved ${b.k} of ${of} times: ${b.n} cells (${Math.round((b.n / cells.length) * 100)}%)`)}>
                <div className="hbar" style={{ width: `${(b.n / max) * 100}%`, background: "var(--series-v2)" }} />
                <div className="hbar-value" style={{ left: `${(b.n / max) * 100}%` }}>{b.n}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {decided} of {cells.length} cells ({Math.round((decided / cells.length) * 100)}%) came out the same way every time.
      </p>
    </Figure>
  );
}

/** Which tasks are stable and which are not, per configuration. */
export function StabilityFigure({ results }: { results: ExperimentResults }) {
  const cells = solveCounts(results, TASKS, SAMPLED_TEMP);
  if (!cells.length) return null;
  const of = cells[0].of;
  const cols = [...new Map(cells.map((c) => [`${c.modelId}|${c.format}`, c])).values()];
  const find = (taskId: string, key: string) => cells.find((c) => c.taskId === taskId && `${c.modelId}|${c.format}` === key);

  return (
    <Figure
      title="Times each task was solved, out of five"
      sub="Dark is reliable, pale is never. The mid-tones are the cells where a single greedy run could have gone either way."
      table={{
        columns: ["Task", ...cols.map((c) => `${modelLabel(c.modelId)} ${c.format}`)],
        rows: TASKS.map((t) => [t.question, ...cols.map((c) => `${find(t.id, `${c.modelId}|${c.format}`)?.solved ?? "-"}/${of}`)]),
      }}
    >
      <Heatmap
        rows={TASKS.map((t) => ({ key: t.id, label: t.question }))}
        columns={cols.map((c) => ({ key: `${c.modelId}|${c.format}`, label: modelLabel(c.modelId), sub: c.format }))}
        cell={(taskId, key) => {
          const c = find(taskId, key);
          if (!c) return null;
          return { value: c.solved / of, text: String(c.solved), tip: `${taskById(taskId)?.question}\n${modelLabel(c.modelId)} · ${FORMAT_LABEL[c.format]}\nsolved ${c.solved} of ${of} samples` };
        }}
        scaleLabel={[`0 of ${of}`, `${of} of ${of}`]}
        wideLabels
      />
    </Figure>
  );
}

export function PredictionsVar({ verdicts }: { verdicts: { verdict: string; evidence: string }[] }) {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Prediction, written before the run</th>
            <th>Verdict</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {PREDICTIONS_VAR.map((p, i) => (
            <tr key={i}>
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

export type { VarianceCell };
