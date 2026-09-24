// Re-scores stored traces with the current rubric. Scoring is deterministic given a
// trace and its judge verdicts, so a rubric fix never requires re-running the models.
//   node --experimental-strip-types scripts/rescore.ts <in.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import type { ExperimentResults } from "../src/lib/types.ts";
import { scoreRun } from "../src/lib/rubric.ts";
import { taskById } from "../src/lib/tasks.ts";

const [input, output] = process.argv.slice(2);
const results = JSON.parse(readFileSync(input, "utf8")) as ExperimentResults;
let changed = 0;
for (const run of results.runs) {
  const next = scoreRun(taskById(run.taskId)!, run, run.judge);
  if (next.total !== run.score.total || next.outcome !== run.score.outcome) {
    console.log(`${run.modelId.split("-q4")[0]} ${run.format} ${run.taskId}: ${run.score.outcome} ${run.score.total} -> ${next.outcome} ${next.total}`);
    changed++;
  }
  run.score = next;
}
writeFileSync(output, JSON.stringify(results, null, 1));
console.log(`${changed} of ${results.runs.length} runs changed.`);
