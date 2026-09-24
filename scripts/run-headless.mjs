// Runs (or resumes) the Experiment tab in headless Chromium with WebGPU, then saves the
// result as the write-up's recorded run. Useful because a background browser tab gets
// throttled or suspended; a headless page does not. Needs `npm run dev` running.
//
// Long runs sometimes lose the renderer (a WebGPU context crash after many model
// loads). Each attempt resumes from the checkpoint, so the driver just relaunches.
//   CHROME=/path/to/chrome PROFILE=/tmp/profile node scripts/run-headless.mjs
import { chromium } from "playwright-core";

const url = process.env.URL ?? "http://localhost:5183/#experiment";
const MAX_ATTEMPTS = Number(process.env.ATTEMPTS ?? 6);
const VARIANT_NAMES = ["Baseline", "Loop guard", "Two examples", "Guard + examples", "Thought cap", "All three", "Calc only", "Reversed", "Three-hop"];

/** One launch-to-finish attempt. Returns true when the experiment completed. */
async function attempt() {
  const ctx = await chromium.launchPersistentContext(process.env.PROFILE ?? ".chrome-profile", {
    executablePath: process.env.CHROME,
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-gpu"],
  });
  try {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.goto(url);

    const run = page.getByRole("button", { name: /^(Run \d+ agent runs|Judge \d+ answers)$/ });
    await run.waitFor();
    await page.waitForTimeout(2000); // let the recorded run load so the count reflects what is left

    // Optional: TASKSET="Fresh tasks (part 4)" picks a task set; VARIANTS="Baseline,Two examples" picks harnesses.
    if (process.env.TASKSET) await page.locator(".exp-grid aside .segmented button", { hasText: process.env.TASKSET }).click();
    if (process.env.VARIANTS) {
      const wanted = process.env.VARIANTS.split(",").map((s) => s.trim());
      for (const box of await page.locator(".exp-grid aside label.check").all()) {
        const name = ((await box.textContent()) ?? "").trim().replace(/\s*(JSON only|~\d+ MB)\s*$/, "").trim();
        if (!VARIANT_NAMES.includes(name)) continue;
        const input = box.locator("input");
        if ((await input.isChecked()) !== wanted.includes(name)) await input.click();
      }
    }
    await page.waitForTimeout(300);

    console.log(await run.textContent());
    await run.click();

    let last = "";
    for (;;) {
      await page.waitForTimeout(5000);
      const status = page.locator("#exp-status");
      const [text, phase] = [await status.textContent(), await status.getAttribute("data-phase")];
      const line = `[${phase}] ${text?.replace(/\d+% completed.*/, "…")}`;
      if (line !== last) console.log(new Date().toISOString().slice(11, 19), (last = line));
      if (phase === "done") break;
      if (phase === "stopped") throw new Error(`run stopped: ${text}`);
    }

    await page.getByRole("button", { name: "Use as the write-up's recorded run" }).click();
    await page.getByText("Saved. The Write-up tab now shows this run.").waitFor();
    console.log("saved as recorded run");
    return true;
  } finally {
    await ctx.close().catch(() => {});
  }
}

for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  try {
    await attempt();
    process.exit(0);
  } catch (e) {
    // A lost renderer leaves the checkpoint intact, so the next attempt resumes from it.
    console.log(`attempt ${i} failed: ${e.message.split("\n")[0]}`);
    if (i === MAX_ATTEMPTS) process.exit(1);
    console.log("relaunching…");
  }
}
