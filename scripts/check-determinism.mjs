// Re-runs one model's baseline runs in headless Chromium and compares every step with
// the recorded traces. The paired analysis assumes greedy decoding is reproducible,
// including across browser builds on the same GPU; this checks that assumption.
//   CHROME=/path/to/chrome PROFILE=/tmp/profile MODEL="Qwen2.5 1.5B" node scripts/check-determinism.mjs
import { chromium } from "playwright-core";

const model = process.env.MODEL ?? "Qwen2.5 1.5B";
const ctx = await chromium.launchPersistentContext(process.env.PROFILE ?? ".chrome-profile", {
  executablePath: process.env.CHROME,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-gpu"],
});
const page = await ctx.newPage();
await page.goto(process.env.URL ?? "http://localhost:5183/#experiment");
await page.getByRole("button", { name: /^Run \d+ agent runs$/ }).waitFor();
await page.waitForTimeout(2000);

// Only this model, only the baseline harness, and from scratch rather than reusing recorded runs.
const aside = page.locator(".exp-grid aside");
for (const box of await aside.locator("label.check").all()) {
  const text = (await box.textContent()) ?? "";
  const keep = text.includes(model) || text.includes("Baseline") || text.includes("ReAct") || text.includes("JSON") && !text.includes("JSON only");
  const input = box.locator("input");
  if ((await input.isChecked()) !== keep) await input.click();
}
const run = page.getByRole("button", { name: /^Run \d+ agent runs$/ });
console.log(await run.textContent());
await run.click();
for (;;) {
  await page.waitForTimeout(5000);
  const phase = await page.locator("#exp-status").getAttribute("data-phase");
  if (phase === "done") break;
  if (phase === "stopped") throw new Error("run stopped");
}

const report = await page.evaluate(async () => {
  const recorded = await (await fetch("/results/recorded.json")).json();
  const key = (r) => `${r.modelId}|${r.format}|${r.variant ?? "base"}|${r.taskId}`;
  const trace = (r) => JSON.stringify([r.steps.map((s) => s.raw), r.answer]);
  const old = new Map(recorded.runs.map((r) => [key(r), r]));
  const out = { compared: 0, identical: 0, sameOutcome: 0, differing: [] };
  for (const r of window.__results.runs) {
    const o = old.get(key(r));
    if (!o) continue;
    out.compared++;
    if (trace(o) === trace(r)) out.identical++;
    else out.differing.push(`${r.format}/${r.taskId}: ${o.score.outcome} -> ${r.score.outcome}`);
    if (o.score.success === r.score.success) out.sameOutcome++;
  }
  return out;
});
console.log(JSON.stringify(report, null, 1));
await ctx.close();
