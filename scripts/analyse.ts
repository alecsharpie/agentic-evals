// Reproduces every number quoted in the write-up, from the recorded run.
// It imports the same stats/rubric/task code the app uses, so there is no second
// implementation to drift from the page.
//   node --experimental-strip-types scripts/analyse.ts [results.json]
import { readFileSync } from "node:fs";
import type { ExperimentResults, ScoredRun, VariantId } from "../src/lib/types.ts";
import { flips, pct, signTest, solveCounts, varianceStats, wilson } from "../src/lib/stats.ts";
import { TASKS, TASKS_V2, taskById } from "../src/lib/tasks.ts";
import { MODELS, modelLabel } from "../src/lib/models.ts";
import { VARIANTS, variantLabel } from "../src/lib/variants.ts";

const file = process.argv[2] ?? "public/results/recorded.json";
const all = JSON.parse(readFileSync(file, "utf8")) as ExperimentResults;
for (const r of all.runs) r.variant ??= "base";
const greedy = all.runs.filter((r) => (r.temperature ?? 0) === 0);
const sampled = all.runs.filter((r) => (r.temperature ?? 0) > 0);

const V1 = new Set(TASKS.map((t) => t.id));
const V2 = new Set(TASKS_V2.map((t) => t.id));
const setOf = (name: "v1" | "v2") => greedy.filter((r) => (name === "v1" ? V1 : V2).has(r.taskId));
const solved = (rs: ScoredRun[]) => rs.filter((r) => r.score.success).length;
const of = (rs: ScoredRun[], v: VariantId) => rs.filter((r) => r.variant === v);
const h = (s: string) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 66 - s.length))}`);
const p = (x: number) => (x < 0.001 ? "<0.001" : x.toFixed(3));

console.log(`${file}: ${all.runs.length} runs, ${new Set(all.runs.map((r) => r.taskId)).size} tasks, ${new Set(all.runs.map((r) => r.variant)).size} harnesses`);
console.log(`judged ${all.runs.filter((r) => r.judge).length} of ${all.runs.filter((r) => r.answer !== null).length} answered · ${all.meta.gpu} · temperature ${all.meta.temperature}`);

// ── part 1 ────────────────────────────────────────────────────────────────────
h("Part 1: models x step format (original tasks, baseline harness)");
for (const m of MODELS) {
  const row = (["text", "json"] as const).map((f) => {
    const rs = of(setOf("v1"), "base").filter((r) => r.modelId === m.id && r.format === f);
    const ci = wilson(solved(rs), rs.length);
    return `${f} ${String(solved(rs)).padStart(2)}/${rs.length} [${pct(ci[0])}-${pct(ci[1])}]`;
  });
  console.log(`  ${m.label.padEnd(14)} ${row.join("   ")}`);
}
const judged = all.runs.filter((r) => r.judge && V1.has(r.taskId) && r.variant === "base");
const agree = judged.filter((r) => r.judge!.correct.verdict === r.score.success).length;
const falsePass = judged.filter((r) => r.judge!.correct.verdict && !r.score.success).length;
console.log(`  judge: agrees on ${agree}/${judged.length}; passed ${falsePass} of ${judged.filter((r) => !r.score.success).length} wrong answers`);

// ── parts 2-4: every harness, both task sets, paired against baseline ─────────
for (const [name, label] of [
  ["v1", "Parts 2-3: harness variants (original tasks)"],
  ["v2", "Part 4: the same harnesses on fresh tasks"],
] as const) {
  h(label);
  const runs = setOf(name);
  const base = of(runs, "base");
  console.log(`  ${"baseline".padEnd(16)} ${String(solved(base)).padStart(2)}/${base.length}`);
  for (const v of VARIANTS) {
    if (v.id === "base") continue;
    const rs = of(runs, v.id);
    if (!rs.length) continue;
    const f = flips(runs, v.id);
    console.log(`  ${v.label.padEnd(16)} ${String(solved(rs)).padStart(2)}/${rs.length}   fixed ${String(f.fixed.length).padStart(2)} broken ${String(f.broken.length).padStart(2)}   p ${p(signTest(f.fixed.length, f.broken.length))}`);
  }
  // Part 3's headline comparison is between two variants, not against baseline.
  const chainLast = of(runs, "shots-rev");
  if (chainLast.length) {
    const key = (r: ScoredRun) => `${r.modelId}|${r.format}|${r.taskId}`;
    const short = new Map(of(runs, "shots").map((r) => [key(r), r]));
    let fixed = 0;
    let broken = 0;
    for (const r of chainLast) {
      const o = short.get(key(r));
      if (!o) continue;
      if (!o.score.success && r.score.success) fixed++;
      if (o.score.success && !r.score.success) broken++;
    }
    console.log(`  chain-last vs calc-last: fixed ${fixed} broken ${broken}   p ${p(signTest(fixed, broken))}`);
  }
}

// ── the size ladder, both sets ────────────────────────────────────────────────
h("Does the size ladder replicate? (baseline harness, both formats)");
for (const m of MODELS) {
  const cell = (name: "v1" | "v2") => {
    const rs = of(setOf(name), "base").filter((r) => r.modelId === m.id);
    return `${String(solved(rs)).padStart(2)}/${rs.length}`;
  };
  console.log(`  ${m.label.padEnd(14)} original ${cell("v1")}   fresh ${cell("v2")}`);
}

// ── per-task, every harness ───────────────────────────────────────────────────
for (const [name, tasks] of [
  ["Original tasks", TASKS],
  ["Fresh tasks", TASKS_V2],
] as const) {
  h(`${name}: configurations solving each task, by harness`);
  const present = VARIANTS.filter((v) => greedy.some((r) => r.variant === v.id && tasks.some((t) => t.id === r.taskId)));
  console.log(`  ${"".padEnd(20)}${present.map((v) => v.label.slice(0, 11).padEnd(12)).join("")}`);
  for (const t of tasks) {
    const cells = present.map((v) => {
      const rs = greedy.filter((r) => r.taskId === t.id && r.variant === v.id);
      return `${solved(rs)}/${rs.length}`.padEnd(12);
    });
    console.log(`  ${t.id.padEnd(20)}${cells.join("")}`);
  }
}

// ── claims made in prose that no chart shows ──────────────────────────────────
h("Trace-level claims quoted in the findings");
const firstCall = (r: ScoredRun) => r.steps[0]?.call?.tool;
const count = (rs: ScoredRun[], fn: (r: ScoredRun) => boolean) => rs.filter(fn).length;

const guarded = greedy.filter((r) => r.steps.some((s) => s.guarded));
const nextAfterGuard = guarded.map((r) => {
  const i = r.steps.findIndex((s) => s.guarded);
  return r.steps[i + 1]?.guarded ? "repeated it" : r.steps[i + 1]?.call?.tool ?? "(none)";
});
console.log(`  P2 loop guard fired in ${guarded.length} runs; next step repeated the call in ${nextAfterGuard.filter((x) => x === "repeated it").length}; ${count(guarded, (r) => r.answer === null)} still never answered`);

const tentPrice = greedy.filter((r) => r.steps.some((s) => s.call?.tool === "calculate" && /(?<!\d)89(?!\d)/.test(String(s.call.args.expression ?? ""))));
console.log(`  P3 runs multiplying by 89 (the example's tent price): ${count(tentPrice, (r) => V1.has(r.taskId))} on the original tasks, ${tentPrice.length} counting part 4; baseline: ${count(tentPrice, (r) => r.variant === "base")}`);

const productOnly = ["price", "stock", "bulk-total"];
for (const v of ["base", "three-hop"] as const) {
  const rs = greedy.filter((r) => r.variant === v && productOnly.includes(r.taskId) && firstCall(r));
  console.log(`  P3 first call on product-only tasks (${v}): get_order ${count(rs, (r) => firstCall(r) === "get_order")}, get_product ${count(rs, (r) => firstCall(r) === "get_product")}, of ${rs.length}`);
}

const direct = greedy.filter((r) => r.taskId === "b-direct" && r.variant === "base" && firstCall(r));
console.log(`  P4 "where is TRK-505" first call: get_order ${count(direct, (r) => firstCall(r) === "get_order")}, track_shipment ${count(direct, (r) => firstCall(r) === "track_shipment")}, other ${count(direct, (r) => !["get_order", "track_shipment"].includes(firstCall(r)!))}, of ${direct.length}`);

const byName = greedy.filter((r) => r.taskId === "b-by-name");
console.log(`  P4 "did Luis Ortega's order ship": solved ${solved(byName)}/${byName.length}; ${count(byName, (r) => r.steps.some((s) => s.call?.tool === "get_order" && /ortega/i.test(JSON.stringify(s.call.args))))} passed a name to get_order (${count(byName, (r) => r.steps.some((s) => /ortega/i.test(JSON.stringify(s.call?.args ?? {}))))} to any tool); ${count(byName, (r) => r.answer === null)} never answered`);

// The echo flaw: a task whose question names its own answer.
const still = greedy.filter((r) => r.taskId === "b-still" && r.score.success);
const unverified = still.filter((r) => !r.steps.some((s) => s.call?.tool === "track_shipment" && !s.toolError));
const mean = (rs: ScoredRun[]) => (rs.length ? rs.reduce((a, r) => a + r.score.total, 0) / rs.length : 0);
console.log(`  P4 "still in Chicago" marked correct: ${still.length}, of which ${unverified.length} never called track_shipment`);
console.log(`     their mean rubric total ${mean(unverified).toFixed(0)} vs ${mean(still.filter((r) => !unverified.includes(r))).toFixed(0)} for the rest`);

const nobody = [...TASKS, ...TASKS_V2].filter((t) => solved(greedy.filter((r) => r.taskId === t.id)) === 0);
console.log(`  Tasks solved by nobody, in any harness: ${nobody.map((t) => `${t.id} (0/${greedy.filter((r) => r.taskId === t.id).length})`).join(", ") || "none"}`);
console.log(`  Best single harness ${Math.max(...VARIANTS.map((v) => solved(of(setOf("v1"), v.id))))}/96 vs per-task oracle ${TASKS.reduce((n, t) => n + Math.max(...VARIANTS.map((v) => solved(greedy.filter((r) => r.taskId === t.id && r.variant === v.id)))), 0)}/96 (original tasks)`);
console.log(`  (the oracle picks the best harness per task on the same runs it scores, so it is a ceiling, not an estimate)`);
console.log(`\nTasks referenced above: ${[...TASKS, ...TASKS_V2].length} total; taskById resolves ${taskById("b-still") ? "both sets" : "v1 only"}.`);

// ── part 5: sampling variance ─────────────────────────────────────────────────
if (sampled.length) {
  const temp = sampled[0].temperature;
  h(`Part 5: greedy vs ${sampled.filter((r) => r.taskId === TASKS[0].id && r.modelId === MODELS[0].id && r.format === "text").length} samples at temperature ${temp}`);
  const cells = varianceStats(all, TASKS, temp);
  for (const c of cells) {
    console.log(`  ${modelLabel(c.modelId).padEnd(14)} ${c.format.padEnd(5)} greedy ${String(c.greedy).padStart(2)}/${c.tasks}   sampled [${c.samples.join(", ")}] mean ${c.mean.toFixed(1)} sd ${c.sd.toFixed(2)}`);
  }
  const trials = [...new Set(sampled.map((r) => r.trial))].sort();
  const base = sampled.filter((r) => r.variant === "base" && V1.has(r.taskId));
  const totals = trials.map((t) => base.filter((r) => r.trial === t && r.score.success).length);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const sd = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / (totals.length - 1));
  const greedyTotal = solved(of(setOf("v1"), "base"));
  console.log(`  aggregate of 96: greedy ${greedyTotal}, sampled [${totals.join(", ")}] mean ${mean.toFixed(1)} sd ${sd.toFixed(2)}`);
  console.log(`  effect sizes from parts 2-3, in units of that sd:`);
  for (const [label, effect] of [["calc-only", -25], ["two examples", -11], ["chain-last vs calc-last", 12], ["three-hop", -7], ["reversed", 1], ["loop guard", 0]] as const) {
    console.log(`    ${label.padEnd(24)} ${String(effect).padStart(3)} → ${(Math.abs(effect) / sd).toFixed(1)} sd`);
  }
  const counts = solveCounts(all, TASKS, temp);
  const n = counts[0]?.of ?? 0;
  const decided = counts.filter((c) => c.solved === 0 || c.solved === n).length;
  console.log(`  cells decided (0 or ${n} of ${n}): ${decided} of ${counts.length} (${pct(decided / counts.length)})`);
  const bucket = Array.from({ length: n + 1 }, (_, k) => `${k}:${counts.filter((c) => c.solved === k).length}`);
  console.log(`  distribution of times solved: ${bucket.join("  ")}`);
  for (const [label, rs] of [["greedy", of(setOf("v1"), "base")], ["sampled", base]] as const) {
    const share = (f: (r: ScoredRun) => boolean) => pct(rs.filter(f).length / rs.length);
    console.log(`  ${label.padEnd(8)} correct ${share((r) => r.score.outcome === "correct")}  wrong ${share((r) => r.score.outcome === "wrong")}  fabricated ${share((r) => r.score.outcome === "fabricated")}  no answer ${share((r) => r.answer === null)}  hit step limit ${share((r) => r.stopReason === "max_steps")}`);
  }
}
