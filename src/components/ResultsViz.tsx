// Every figure in the write-up and the Experiment tab. Each takes results (or
// stats derived from them) and nothing else, so live and recorded runs render identically.

import { useEffect, useMemo, useState } from "react";
import type { ExperimentResults, Outcome, ScoredRun, VariantId } from "../lib/types.ts";
import { MODELS, modelLabel } from "../lib/models.ts";
import { RUBRIC } from "../lib/rubric.ts";
import { FORMAT_LABEL, configStats, judgeAgreement, pct, type ConfigStats } from "../lib/stats.ts";
import { TASKS, TIER_LABEL, taskById, type Task, type Tier } from "../lib/tasks.ts";
import { variantLabel } from "../lib/variants.ts";
import { Figure, HBars, Heatmap, Legend, StackRows, Tiles, seqStyle, useTip, type BarRow, type Series } from "./charts.tsx";
import { OUTCOME, Scorecard } from "./Scorecard.tsx";
import { Trace } from "./Trace.tsx";

const FORMAT_SERIES: Series[] = [
  { key: "text", label: FORMAT_LABEL.text, color: "var(--series-text)" },
  { key: "json", label: FORMAT_LABEL.json, color: "var(--series-json)" },
];

const TIERS = Object.keys(TIER_LABEL) as Tier[];
const OUTCOMES: Outcome[] = ["correct", "wrong", "fabricated", "no_answer"];
const configRows = (stats: ConfigStats[]) => stats.map((s) => ({ key: s.key, label: modelLabel(s.modelId), sub: FORMAT_LABEL[s.format] }));

export const useStats = (results: ExperimentResults, variant: VariantId = "base", tasks: Task[] = TASKS) => useMemo(() => configStats(results, variant, tasks), [results, variant, tasks]);

/** Part 1 is the baseline harness only; part 2 runs live in the same file under other variants. */
export const baselineOnly = (results: ExperimentResults): ExperimentResults => ({ ...results, runs: results.runs.filter((r) => (r.variant ?? "base") === "base") });

/** Parts 1-4 are all greedy. A sampled sweep lives in the same file and must not leak into them. */
export const atTemperature = (results: ExperimentResults, t: number): ExperimentResults => ({ ...results, runs: results.runs.filter((r) => (r.temperature ?? 0) === t) });

function byModel(stats: ConfigStats[], bar: (s: ConfigStats) => BarRow["bars"][number]): BarRow[] {
  return MODELS.filter((m) => stats.some((s) => s.modelId === m.id)).map((m) => ({
    key: m.id,
    label: m.label,
    sub: `${m.params} params`,
    bars: stats.filter((s) => s.modelId === m.id).map(bar),
  }));
}

// ------------------------------------------------------------ headline tiles

export function Headline({ results }: { results: ExperimentResults }) {
  const stats = useStats(results);
  if (!stats.length) return null;
  const best = [...stats].sort((a, b) => b.successRate - a.successRate || b.meanScore - a.meanScore)[0];
  const rate = (format: "text" | "json") => {
    const s = stats.filter((x) => x.format === format);
    const n = s.reduce((a, x) => a + x.n, 0);
    return n ? s.reduce((a, x) => a + x.successes, 0) / n : null;
  };
  const text = rate("text");
  const json = rate("json");
  const agreement = judgeAgreement(results.runs);
  return (
    <Tiles
      tiles={[
        { label: "Agent runs scored", value: String(results.runs.length), note: `${TASKS.length} tasks × ${stats.length} configurations` },
        { label: "Best task success", value: pct(best.successRate), note: `${modelLabel(best.modelId)}, ${FORMAT_LABEL[best.format].toLowerCase()}` },
        ...(text !== null && json !== null
          ? [{ label: "Constrained JSON vs free text", value: `${json >= text ? "+" : "−"}${Math.abs(Math.round((json - text) * 100))} pts`, note: `${pct(json)} vs ${pct(text)} success, all models` }]
          : []),
        ...(agreement.n ? [{ label: "Judge agrees with ground truth", value: pct(agreement.agree / agreement.n), note: `${modelLabel(results.meta.judgeModelId)} on ${agreement.n} answers` }] : []),
      ]}
    />
  );
}

// ------------------------------------------------------------ figures

export function SuccessFigure({ stats }: { stats: ConfigStats[] }) {
  return (
    <Figure
      title="Task success by model and step format"
      sub="Share of tasks whose final answer matched ground truth. Thin line: 95% Wilson interval."
      table={{
        columns: ["Model", "Format", "Correct", "Runs", "Success", "95% interval"],
        rows: stats.map((s) => [modelLabel(s.modelId), FORMAT_LABEL[s.format], s.successes, s.n, pct(s.successRate), `${pct(s.ci[0])}–${pct(s.ci[1])}`]),
      }}
    >
      <Legend series={FORMAT_SERIES} />
      <HBars
        rows={byModel(stats, (s) => ({
          series: s.format,
          value: s.successRate,
          lo: s.ci[0],
          hi: s.ci[1],
          label: pct(s.successRate),
          tip: `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\n${s.successes} of ${s.n} correct (${pct(s.successRate)})\n95% interval ${pct(s.ci[0])}–${pct(s.ci[1])}`,
        }))}
        series={FORMAT_SERIES}
        max={1}
        ticks={[0, 0.25, 0.5, 0.75, 1]}
        formatTick={pct}
      />
    </Figure>
  );
}

export function ScoreFigure({ stats }: { stats: ConfigStats[] }) {
  return (
    <Figure
      title="Mean rubric score"
      sub="Average of the 100-point rubric. Partial credit separates configurations that tie on raw success."
      table={{ columns: ["Model", "Format", "Mean score"], rows: stats.map((s) => [modelLabel(s.modelId), FORMAT_LABEL[s.format], s.meanScore.toFixed(1)]) }}
    >
      <Legend series={FORMAT_SERIES} />
      <HBars
        rows={byModel(stats, (s) => ({ series: s.format, value: s.meanScore, label: s.meanScore.toFixed(0), tip: `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\nMean rubric score ${s.meanScore.toFixed(1)} / 100` }))}
        series={FORMAT_SERIES}
        max={100}
        ticks={[0, 25, 50, 75, 100]}
        formatTick={String}
      />
    </Figure>
  );
}

export function TierFigure({ stats }: { stats: ConfigStats[] }) {
  return (
    <Figure
      title="Where they break: success by task tier"
      sub="Tiers get harder left to right: one lookup, two chained lookups, lookups plus arithmetic, then cases where the right answer is “I can't”."
      table={{
        columns: ["Model", "Format", ...TIERS.map((t) => TIER_LABEL[t])],
        rows: stats.map((s) => [modelLabel(s.modelId), FORMAT_LABEL[s.format], ...TIERS.map((t) => `${s.byTier[t].successes}/${s.byTier[t].n}`)]),
      }}
    >
      <Heatmap
        rows={configRows(stats)}
        columns={TIERS.map((t) => ({ key: t, label: TIER_LABEL[t], sub: `${TASKS.filter((x) => x.tier === t).length} tasks` }))}
        cell={(rowKey, tier) => {
          const s = stats.find((x) => x.key === rowKey)!;
          const t = s.byTier[tier as Tier];
          return { value: t.successes / t.n, text: `${t.successes}/${t.n}`, tip: `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\n${TIER_LABEL[tier as Tier]}: ${t.successes} of ${t.n} correct` };
        }}
        scaleLabel={["none correct", "all correct"]}
      />
    </Figure>
  );
}

export function CriteriaFigure({ stats }: { stats: ConfigStats[] }) {
  return (
    <Figure
      title="Rubric breakdown"
      sub="Mean credit earned on each criterion, as a percentage of that criterion's weight."
      table={{
        columns: ["Model", "Format", ...RUBRIC.map((c) => `${c.label} (${c.weight})`)],
        rows: stats.map((s) => [modelLabel(s.modelId), FORMAT_LABEL[s.format], ...RUBRIC.map((c) => pct(s.criteria[c.id]))]),
      }}
    >
      <Heatmap
        rows={configRows(stats)}
        columns={RUBRIC.map((c) => ({ key: c.id, label: c.label, sub: `${c.weight} pts · ${c.grader}` }))}
        cell={(rowKey, id) => {
          const s = stats.find((x) => x.key === rowKey)!;
          const c = RUBRIC.find((x) => x.id === id)!;
          const v = s.criteria[c.id];
          return { value: v, text: String(Math.round(v * 100)), tip: `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\n${c.label}: ${pct(v)} of available credit\n${c.question}` };
        }}
        scaleLabel={["0% of credit", "100%"]}
      />
    </Figure>
  );
}

export function OutcomeFigure({ stats }: { stats: ConfigStats[] }) {
  return (
    <Figure
      title="How runs end"
      sub="Every run lands in exactly one bucket. “Fabricated” means the answer was wrong and cited a fact no tool returned."
      table={{
        columns: ["Model", "Format", ...OUTCOMES.map((o) => OUTCOME[o].label)],
        rows: stats.map((s) => [modelLabel(s.modelId), FORMAT_LABEL[s.format], ...OUTCOMES.map((o) => s.outcomes[o])]),
      }}
    >
      <div className="legend">
        {OUTCOMES.map((o) => (
          <span key={o}>
            <i className="swatch" style={{ background: OUTCOME[o].color }} />
            {OUTCOME[o].glyph} {OUTCOME[o].label}
          </span>
        ))}
      </div>
      <StackRows
        rows={stats.map((s) => ({
          key: s.key,
          label: modelLabel(s.modelId),
          sub: FORMAT_LABEL[s.format],
          segments: OUTCOMES.map((o) => ({ key: o, count: s.outcomes[o], color: OUTCOME[o].color, ink: OUTCOME[o].ink, tip: `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\n${OUTCOME[o].label}: ${s.outcomes[o]} of ${s.n} runs\n${OUTCOME[o].blurb}` })),
        }))}
      />
    </Figure>
  );
}

export function SpeedFigure({ stats }: { stats: ConfigStats[] }) {
  const max = Math.max(1, ...stats.map((s) => s.medianMs / 1000));
  const top = Math.ceil(max / 2) * 2;
  return (
    <Figure
      title="Seconds per task"
      sub="Median wall-clock time for the whole agent loop, all model turns included."
      table={{
        columns: ["Model", "Format", "Median s/task", "Mean steps", "Decode tokens/s"],
        rows: stats.map((s) => [modelLabel(s.modelId), FORMAT_LABEL[s.format], (s.medianMs / 1000).toFixed(1), s.meanSteps.toFixed(1), s.tokensPerSecond.toFixed(0)]),
      }}
    >
      <Legend series={FORMAT_SERIES} />
      <HBars
        rows={byModel(stats, (s) => ({
          series: s.format,
          value: s.medianMs / 1000,
          label: `${(s.medianMs / 1000).toFixed(1)}s`,
          tip: `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\nMedian ${(s.medianMs / 1000).toFixed(1)}s per task\n${s.meanSteps.toFixed(1)} steps on average · ${s.tokensPerSecond.toFixed(0)} tokens/s`,
        }))}
        series={FORMAT_SERIES}
        max={top}
        ticks={[0, top / 4, top / 2, (3 * top) / 4, top]}
        formatTick={(v) => `${v}s`}
      />
    </Figure>
  );
}

export function JudgeFigure({ results }: { results: ExperimentResults }) {
  const a = judgeAgreement(results.runs);
  if (!a.n) return null;
  const cells: Record<string, { n: number; label: string }> = {
    "yes|right": { n: a.truePos, label: "Judge passed a correct answer" },
    "yes|wrong": { n: a.falsePos, label: "Judge passed a wrong answer" },
    "no|right": { n: a.falseNeg, label: "Judge failed a correct answer" },
    "no|wrong": { n: a.trueNeg, label: "Judge failed a wrong answer" },
  };
  return (
    <Figure
      title="Judging the judge"
      sub={`${modelLabel(results.meta.judgeModelId)} was shown each answer with the reference and asked if it was correct. Its verdicts against the deterministic check:`}
      table={{ columns: ["Judge verdict", "Ground truth", "Answers"], rows: Object.entries(cells).map(([k, v]) => [k.split("|")[0], k.split("|")[1], v.n]) }}
    >
      <Heatmap
        rows={[
          { key: "yes", label: "Judge said correct" },
          { key: "no", label: "Judge said incorrect" },
        ]}
        columns={[
          { key: "right", label: "Actually correct", sub: `${a.truePos + a.falseNeg} answers` },
          { key: "wrong", label: "Actually wrong", sub: `${a.falsePos + a.trueNeg} answers` },
        ]}
        cell={(r, c) => {
          const d = cells[`${r}|${c}`];
          return { value: d.n / a.n, text: String(d.n), tip: `${d.label}: ${d.n} of ${a.n}` };
        }}
        scaleLabel={["few answers", "many"]}
      />
    </Figure>
  );
}

// ------------------------------------------------------------ task matrix + drill-down

export function RunDrawer({ run, onClose }: { run: ScoredRun; onClose: () => void }) {
  const task = taskById(run.taskId)!;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Run detail" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="kicker">
              {modelLabel(run.modelId)} · {FORMAT_LABEL[run.format]} · {variantLabel(run.variant ?? "base")} · {(run.totalMs / 1000).toFixed(1)}s
            </div>
            <h2 className="question">{task.question}</h2>
            <div className="small muted">Ground truth: {task.reference}</div>
          </div>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <Trace run={run} />
        <h3 style={{ margin: "8px 0 12px", fontSize: 15 }}>Evaluation</h3>
        <Scorecard score={run.score} judge={run.judge} />
      </div>
    </div>
  );
}

export function TaskMatrix({ results, variant = "base", tasks = TASKS }: { results: ExperimentResults; variant?: VariantId; tasks?: Task[] }) {
  const stats = useStats(results, variant, tasks);
  const tip = useTip();
  const [open, setOpen] = useState<ScoredRun | null>(null);
  const runsFor = (key: string, taskId: string) => results.runs.filter((r) => `${r.modelId}|${r.format}` === key && r.taskId === taskId && (r.variant ?? "base") === variant);

  return (
    <Figure
      title="Every run"
      sub="Rubric score for each task under each configuration. Click a cell to read the full trace and scorecard."
      table={{
        columns: ["Task", ...stats.map((s) => `${modelLabel(s.modelId)} ${s.format}`)],
        rows: tasks.map((t) => [t.question, ...stats.map((s) => runsFor(s.key, t.id).map((r) => `${OUTCOME[r.score.outcome].glyph} ${r.score.total}`).join(", "))]),
      }}
    >
      <div className="scroll-x">
        <table className="heat matrix">
          <thead>
            <tr>
              <th />
              {stats.map((s) => (
                <th key={s.key}>
                  {modelLabel(s.modelId)}
                  <small>
                    <i className="swatch" style={{ background: `var(--series-${s.format})`, width: 7, height: 7, marginRight: 4 }} />
                    {s.format}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <FragmentRows key={tier}>
                <tr className="tier-row">
                  <th colSpan={stats.length + 1}>{TIER_LABEL[tier]}</th>
                </tr>
                {tasks.filter((t) => t.tier === tier).map((t) => (
                  <tr key={t.id}>
                    <th>{t.question}</th>
                    {stats.map((s) => {
                      const runs = runsFor(s.key, t.id);
                      if (!runs.length) return <td key={s.key} />;
                      const mean = runs.reduce((a, r) => a + r.score.total, 0) / runs.length;
                      const first = runs[0];
                      const label = runs.length === 1 ? `${OUTCOME[first.score.outcome].glyph} ${Math.round(mean)}` : `${runs.filter((r) => r.score.success).length}/${runs.length}`;
                      const text = `${modelLabel(s.modelId)} · ${FORMAT_LABEL[s.format]}\n${OUTCOME[first.score.outcome].label} · score ${Math.round(mean)}\n${first.answer ? `“${first.answer}”` : "(no answer)"}`;
                      return (
                        <td
                          key={s.key}
                          className="clickable"
                          style={seqStyle(mean / 100)}
                          {...tip(text)}
                          onClick={() => setOpen(first)}
                          onKeyDown={(e) => e.key === "Enter" && setOpen(first)}
                        >
                          {label}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </FragmentRows>
            ))}
          </tbody>
        </table>
        <div className="scale">
          score 0 <i /> 100 · ✓ correct · ✗ wrong · ! fabricated · – no answer
        </div>
      </div>
      {open && <RunDrawer run={open} onClose={() => setOpen(null)} />}
    </Figure>
  );
}

const FragmentRows = ({ children }: { children: React.ReactNode }) => <>{children}</>;
