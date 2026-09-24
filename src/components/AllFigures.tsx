// Everything the Experiment tab draws for a live or finished run.

import type { ExperimentResults } from "../lib/types.ts";
import { TASKS_V2 } from "../lib/tasks.ts";
import { taskSubset } from "../lib/stats.ts";
import { FlipsFigure, InterventionGrid, PART2, PART3, PrematureFigure, TaskByVariant, VariantMatrix, VariantOutcomes, hasPart } from "./Part2.tsx";
import { TASKS } from "../lib/tasks.ts";
import { CriteriaFigure, Headline, JudgeFigure, OutcomeFigure, SpeedFigure, SuccessFigure, TaskMatrix, TierFigure, atTemperature, baselineOnly, useStats } from "./ResultsViz.tsx";

export function AllFigures({ results: raw }: { results: ExperimentResults }) {
  // Parts 1-4 are greedy; a sampled sweep in the same file is drawn separately.
  const all = atTemperature(raw, 0);
  const results = taskSubset(all, TASKS);
  const fresh = taskSubset(all, TASKS_V2);
  const base = baselineOnly(results);
  const stats = useStats(base);
  return (
    <>
      {stats.length > 0 && (
        <>
          <Headline results={base} />
          <SuccessFigure stats={stats} />
          <TierFigure stats={stats} />
          <CriteriaFigure stats={stats} />
          <OutcomeFigure stats={stats} />
          <TaskMatrix results={base} />
          <SpeedFigure stats={stats} />
          <JudgeFigure results={base} />
        </>
      )}
      {([2, 3] as const).map((part) => {
        const ids = part === 2 ? PART2 : PART3;
        return (
          hasPart(results, part) && (
            <div key={part}>
              <h3 style={{ margin: "40px 0 0", fontSize: 17 }}>{part === 2 ? "Part 2: harness fixes" : "Part 3: worked-example ablation"}</h3>
              <InterventionGrid results={results} ids={ids} />
              <FlipsFigure results={results} ids={ids} />
              {part === 3 && <PrematureFigure results={results} ids={ids} />}
              <VariantOutcomes results={results} ids={ids} />
              <TaskByVariant results={results} ids={ids} />
              <VariantMatrix results={results} ids={ids} />
            </div>
          )
        );
      })}
      {fresh.runs.length > 0 && (
        <div>
          <h3 style={{ margin: "40px 0 0", fontSize: 17 }}>Part 4: fresh task set</h3>
          <InterventionGrid results={fresh} ids={PART3} />
          <FlipsFigure results={fresh} ids={PART3} />
          <TaskByVariant results={fresh} ids={PART3} tasks={TASKS_V2} />
          <VariantMatrix results={fresh} ids={PART3} tasks={TASKS_V2} />
        </div>
      )}
    </>
  );
}
