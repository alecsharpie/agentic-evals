import type { ExperimentResults } from "../lib/types.ts";
import { MAX_STEPS, renderStep } from "../lib/agent.ts";
import { MODELS, modelLabel } from "../lib/models.ts";
import { RUBRIC } from "../lib/rubric.ts";
import { TASKS, TIER_LABEL, type Tier } from "../lib/tasks.ts";
import { TOOLS } from "../lib/tools.ts";
import { useMemo } from "react";
import { VARIANTS } from "../lib/variants.ts";
import { Findings } from "./Findings.tsx";
import { Findings2 } from "./Findings2.tsx";
import { Findings3, Predictions } from "./Findings3.tsx";
import { Findings4, VERDICTS_V2 } from "./Findings4.tsx";
import { Findings5, VERDICTS_VAR } from "./Findings5.tsx";
import { BimodalFigure, PredictionsVar, SAMPLED_TEMP, SpreadFigure, StabilityFigure, hasPart5 } from "./Part5.tsx";
import { LadderFigure, PredictionsV2, ReplicationFigure, hasPart4 } from "./Part4.tsx";
import { taskSubset } from "../lib/stats.ts";
import { TASKS_V2 } from "../lib/tasks.ts";
import { FlipsFigure, InterventionGrid, PART2, PART3, PrematureFigure, TaskByVariant, VariantMatrix, VariantOutcomes, hasPart } from "./Part2.tsx";
import { CriteriaFigure, Headline, JudgeFigure, OutcomeFigure, SpeedFigure, SuccessFigure, TaskMatrix, TierFigure, atTemperature, baselineOnly, useStats } from "./ResultsViz.tsx";

type SectionKey = "setup" | "format" | "rubric" | "results" | "traces" | "judge" | "findings" | "p2" | "p2f" | "p3" | "p3f" | "p4" | "p4f" | "p5" | "p5f" | "limits" | "repro";

/**
 * Section numbers are derived from which parts are present, so omitting a part can
 * never leave a gap or a duplicate. Computed as pure data, not by a render-time
 * counter: H2 renders twice under StrictMode, and a counter would double-count.
 */
function numbering(present: Partial<Record<SectionKey, boolean>>) {
  const order: SectionKey[] = ["setup", "format", "rubric", "results", "traces", "judge", "findings", "p2", "p2f", "p3", "p3f", "p4", "p4f", "p5", "p5f", "limits", "repro"];
  const shown = order.filter((k) => present[k] ?? true);
  return (key: SectionKey) => shown.indexOf(key) + 1;
}

const Section = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h2>
    <span className="num">{n}</span>
    {children}
  </h2>
);

function LoopDiagram() {
  return (
    <>
      <div className="loop">
        <div className="loop-stage">
          <span className="mock">Fixed</span>
          <b>Question</b>
          One of {TASKS.length} customer questions with known ground truth.
        </div>
        <div className="loop-stage">
          <span className="real">Real model</span>
          <b>Thought + action</b>
          A sub-2B model on WebGPU writes a thought and picks a tool.
        </div>
        <div className="loop-stage">
          <span className="mock">Mocked</span>
          <b>Tool call</b>
          Deterministic JavaScript over a five-order dataset.
        </div>
        <div className="loop-stage">
          <span className="mock">Mocked</span>
          <b>Observation</b>
          Tool JSON goes back into the chat as the next user turn.
        </div>
        <div className="loop-stage">
          <span className="real">Real model</span>
          <b>finish(answer)</b>
          One sentence for the customer ends the loop.
        </div>
      </div>
      <p className="loop-back">↺ Stages 2–4 repeat, up to {MAX_STEPS} model turns. The full trace and the final answer then go to the evaluation pass.</p>
    </>
  );
}

function Rubric() {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Weight</th>
            <th>Graded by</th>
            <th>What it asks</th>
          </tr>
        </thead>
        <tbody>
          {RUBRIC.map((c) => (
            <tr key={c.id}>
              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{c.label}</td>
              <td>{c.weight}</td>
              <td>{c.grader === "code" ? "Code" : "LLM judge"}</td>
              <td>{c.question}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WriteUp({ results: raw, goTo }: { results: ExperimentResults | null; goTo: (tab: "live" | "experiment") => void }) {
  // Parts 1-4 report greedy decoding only; the sampled sweep is part 5.
  const all = useMemo(() => (raw ? atTemperature(raw, 0) : null), [raw]);
  // Parts 1 and 2 share one results file. Part 1 reads only the baseline harness.
  const results = useMemo(() => (all ? baselineOnly(taskSubset(all, TASKS)) : null), [all]);
  const part2 = all !== null && hasPart(all, 2);
  const part3 = all !== null && hasPart(all, 3);
  const part4 = all !== null && hasPart4(all);
  const part5 = raw !== null && hasPart5(raw);
  const fresh = all ? taskSubset(all, TASKS_V2) : null;
  const runsIn = (part: 2 | 3) => all?.runs.filter((r) => VARIANTS.some((v) => v.part === part && v.id === r.variant)).length ?? 0;
  const stats = useStats(results ?? { meta: {} as ExperimentResults["meta"], runs: [] });
  // Section numbers shift as parts are added.
  const hasResults = results !== null && stats.length > 0;
  const n = numbering({ results: hasResults, traces: hasResults, judge: hasResults, findings: hasResults, p2: part2, p2f: part2, p3: part3, p3f: part3, p4: part4, p4f: part4, p5: part5, p5f: part5 });
  const tiers = Object.keys(TIER_LABEL) as Tier[];
  const example = { tool: "track_shipment", args: { tracking_id: "TRK-501" } };
  const thought = "The order has tracking ID TRK-501. I will track it.";

  return (
    <article className="article wide">
      <div className="article">
        <div className="kicker">An in-browser agent evaluation</div>
        <h1 className="hero-title">How small can a tool-using agent get?</h1>
        <p className="lede">
          Four language models between 360 million and 1.5 billion parameters run a ReAct loop entirely inside this browser tab. They answer customer
          questions by calling mocked shop tools, and every run is scored against a six-part rubric. Part 1 measures them. Part 2 tries three fixes for what
          went wrong, and none of them work. Part 3 finds out why: the worked example in the prompt matters more than everything else in it. Part 4 runs
          the same harnesses on twelve questions none of this was designed against, and part 3's effects vanish. This page is the experiment, its results,
          and the working demo.
        </p>
        <p>
          <button className="btn primary" onClick={() => goTo("live")}>
            Watch one agent run live
          </button>{" "}
          <button className="btn" onClick={() => goTo("experiment")}>
            Re-run the whole experiment
          </button>
        </p>
      </div>

      {results ? <Headline results={results} /> : <div className="notice">No recorded run found yet. Open the Experiment tab, run it, and save the result to populate the charts below.</div>}

      <div className="article">
        <Section n={n("setup")}>The setup</Section>
        <p>
          The agent plays a support rep for an online shop. The <strong>model is real</strong>: weights are downloaded once and executed on your GPU through
          WebGPU (via WebLLM), with no server and no API key. The <strong>tools are mocks</strong>: plain functions over a tiny fixed dataset of five orders,
          four shipments and five products. Mocking the world is what makes the evaluation exact, because every question has one known right answer and one
          known set of tool calls that reaches it.
        </p>
      </div>
      <LoopDiagram />
      <div className="article">
        <p>The agent has {TOOLS.length} tools, each taking a single string argument:</p>
        <ul>
          {TOOLS.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code>: {t.description}
            </li>
          ))}
        </ul>
        <p>
          The {TASKS.length} tasks come in four tiers of increasing difficulty:{" "}
          {tiers.map((t, i) => (
            <span key={t}>
              <strong>{TIER_LABEL[t].toLowerCase()}</strong> ({TASKS.filter((x) => x.tier === t).map((x) => `“${x.question}”`)[0]}){i < tiers.length - 1 ? ", " : ". "}
            </span>
          ))}
          The edge cases are the interesting ones: an order that does not exist, and an order that has not shipped so has no arrival date. The right answer
          is to say so, and the tempting answer is to make something up.
        </p>
        <p>
          The prompt holds the tool list, five rules and <strong>one worked example</strong> given as real chat turns: a chained lookup on a fictional order
          that appears in no task. Decoding is greedy (temperature 0), so each configuration is deterministic and runs once per task.
        </p>

        <Section n={n("format")}>The variable: how the model writes a step</Section>
        <p>
          A ReAct agent has to emit something a program can execute. That is the first thing to break in a small model, so it is the variable tested here.
          Both formats carry the same three fields and the same prompt otherwise.
        </p>
      </div>
      <div className="formats">
        <div className="card">
          <h4>
            <i className="swatch" style={{ background: "var(--series-text)" }} /> Free-text ReAct
          </h4>
          <pre>{renderStep("text", thought, example)}</pre>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The classic format. Parsed with regexes; generation stops at “Observation:” so the model cannot invent its own tool result. Light repairs are
            allowed (a bare value instead of JSON) but cost rubric points.
          </p>
        </div>
        <div className="card">
          <h4>
            <i className="swatch" style={{ background: "var(--series-json)" }} /> Constrained JSON
          </h4>
          <pre>{renderStep("json", thought, example)}</pre>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Decoded under a JSON-schema grammar: at each token, anything that would break the schema is masked out. The action must be a real tool and the
            input must have that tool's parameter. In principle it cannot fail to parse; section 7 covers how it still did.
          </p>
        </div>
      </div>

      <div className="article">
        <Section n={n("rubric")}>The rubric</Section>
        <p>
          Each run is scored out of 100. Five criteria are <strong>deterministic code checks</strong> over the trace and the answer, which is possible only
          because the world is mocked. The sixth has no mechanical test, so it goes to an <strong>LLM judge</strong>: after all agents finish, one fixed model (
          {modelLabel(results?.meta.judgeModelId ?? MODELS[3].id)}) grades every answer, so scores are comparable across agents.
        </p>
      </div>
      <Rubric />
      <div className="article">
        <p>
          “Task success” below means full marks on the first criterion. The remaining 60 points describe <em>how</em> the agent got there: a lucky guess with
          no tool calls scores 40 for the answer and little else. The judge is also asked a second question, whether the answer is correct, which does not
          count toward the score. Its only purpose is to be compared with ground truth in section 6.
        </p>
      </div>

      {results && stats.length > 0 && (
        <>
          <div className="article">
            <Section n={n("results")}>Results</Section>
            <p>
              Part 1 is {results.runs.length} runs: {stats.length / 2} models × 2 formats × {TASKS.length} tasks, on {results.meta.gpu || "WebGPU"}. With {TASKS.length}{" "}
              tasks per configuration one task is worth {Math.round(100 / TASKS.length)} percentage points, so read the intervals, not just the bars.
            </p>
          </div>
          <SuccessFigure stats={stats} />
          <TierFigure stats={stats} />
          <CriteriaFigure stats={stats} />
          <OutcomeFigure stats={stats} />

          <div className="article">
            <Section n={n("traces")}>Read the traces</Section>
            <p>Aggregates hide the texture. Every cell below opens the full trace: what the model thought, what it called, what the mock returned, and how each rubric line was scored.</p>
          </div>
          <TaskMatrix results={results} />
          <SpeedFigure stats={stats} />

          <div className="article">
            <Section n={n("judge")}>Can a small model grade the answers?</Section>
            <p>
              Because ground truth is known, the judge itself can be evaluated. It saw the question, the reference answer and the agent's answer, and returned
              a yes/no verdict under the same grammar-constrained JSON.
            </p>
          </div>
          <JudgeFigure results={results} />

          <div className="article">
            <Section n={n("findings")}>Findings</Section>
            <Findings results={results} />
          </div>
        </>
      )}

      {all && part2 && (
        <>
          <div className="article">
            <Section n={n("p2")}>Part 2: three fixes, tested</Section>
            <p>
              Part 1 ended with three diagnoses, and each one implies a cheap fix to the harness around the model. Part 2 runs them. Nothing about the models,
              tasks or rubric changes; {runsIn(2)} further runs cover every combination below.
            </p>
            <ul>
              {VARIANTS.filter((v) => v.part === 2).map((v) => (
                <li key={v.id}>
                  <strong>{v.label}.</strong> {v.blurb}
                </li>
              ))}
            </ul>
            <p>
              Because decoding is greedy, the same model on the same task under two harnesses is a true matched pair: any change in outcome is caused by the
              harness. So the comparison below counts pairs that flipped, in each direction, and tests the split with an exact sign test.
            </p>
          </div>
          <InterventionGrid results={all} ids={PART2} />
          <FlipsFigure results={all} ids={PART2} />
          <VariantOutcomes results={all} ids={PART2} />
          <TaskByVariant results={all} ids={PART2} />
          <div className="article">
            <p>As in part 1, every run is open to inspection. Pick a harness, then click a cell. Refused calls are marked in the trace.</p>
          </div>
          <VariantMatrix results={all} ids={PART2} />

          <div className="article">
            <Section n={n("p2f")}>What part 2 found</Section>
            <Findings2 />
          </div>
        </>
      )}

      {all && part3 && (
        <>
          <div className="article">
            <Section n={n("p3")}>Part 3: why did the second example hurt?</Section>
            <p>
              Part 2's strangest result was that adding a relevant worked example made the agents worse. Three explanations were on the table: a short
              example teaches early stopping, the last example dominates whatever came before, or any extra context is a burden. They predict different
              things, so part 3 varies only which examples the prompt contains and in what order. {runsIn(3)} further runs:
            </p>
            <ul>
              {VARIANTS.filter((v) => v.part === 3).map((v) => (
                <li key={v.id}>
                  <strong>{v.label}.</strong> {v.blurb}
                </li>
              ))}
            </ul>
            <p>
              After part 2, intuition had a poor record here, so the predictions were written into the code before any of these runs were made. Here they
              are, graded.
            </p>
          </div>
          <Predictions />
          <div className="article">
            <p>
              The charts read part 3 against two references: the one-example baseline, and part 2's two-example harness, which it is dissecting. The paired
              bars are still drawn against the baseline.
            </p>
          </div>
          <InterventionGrid results={all} ids={PART3} />
          <TaskByVariant results={all} ids={PART3} />
          <FlipsFigure results={all} ids={PART3} />
          <PrematureFigure results={all} ids={PART3} />
          <VariantOutcomes results={all} ids={PART3} />
          <VariantMatrix results={all} ids={PART3} />

          <div className="article">
            <Section n={n("p3f")}>What part 3 found</Section>
            <Findings3 />
          </div>
        </>
      )}

      {all && fresh && part4 && (
        <>
          <div className="article">
            <Section n={n("p4")}>Part 4: does any of it replicate?</Section>
            <p>
              Everything so far rests on the same 12 questions, and parts 2 and 3 were designed by staring at their failures. Part 4 writes 12 new questions,
              on three new orders, with shapes no worked example demonstrates: a shipment asked about by tracking number directly, two product lookups that
              must be added, a yes/no that needs a chain, and a customer named instead of an order, which no tool can look up. Then it reruns the five
              example harnesses on them, {fresh.runs.length} runs, with predictions committed first.
            </p>
          </div>
          <PredictionsV2 verdicts={VERDICTS_V2} />
          <ReplicationFigure results={all} />
          <LadderFigure results={all} />
          <TaskByVariant results={fresh} ids={PART3} tasks={TASKS_V2} />
          <FlipsFigure results={fresh} ids={PART3} />
          <PrematureFigure results={fresh} ids={PART3} />
          <VariantMatrix results={fresh} ids={PART3} tasks={TASKS_V2} />
          <div className="article">
            <Section n={n("p4f")}>What part 4 found</Section>
            <Findings4 />
          </div>
        </>
      )}

      {raw && part5 && (
        <>
          <div className="article">
            <Section n={n("p5")}>Part 5: how much did one decoding decide?</Section>
            <p>
              Every number in parts 1 to 4 comes from greedy decoding: exactly one run per cell, reproducible to the token. That makes the paired
              comparisons exact, and it leaves one question open. Greedy is a single sample from the space of things the model might have said, so how much
              of the structure in those four parts would survive if it had sampled differently? Part 5 reruns the baseline harness on the original twelve
              tasks at temperature {SAMPLED_TEMP}, five times per cell, and compares the spread with the effects the earlier parts report.
            </p>
          </div>
          <PredictionsVar verdicts={VERDICTS_VAR} />
          <SpreadFigure results={raw} />
          <BimodalFigure results={raw} />
          <StabilityFigure results={raw} />
          <div className="article">
            <Section n={n("p5f")}>What part 5 found</Section>
            <Findings5 />
          </div>
        </>
      )}

      <div className="article">
        <Section n={n("limits")}>Limitations</Section>
        <ul>
          <li>
            <strong>Small n.</strong> {TASKS.length} tasks per configuration, one greedy run each. Differences of one or two tasks are inside the noise; the
            intervals in the first chart are wide on purpose.
          </li>
          <li>
            <strong>The example leaks a pattern.</strong> The single worked example is a chained lookup, which favours the chain tier over the arithmetic tier.
          </li>
          <li>
            <strong>Regex ground truth.</strong> Correctness is pattern matching on the answer. The patterns were written before any model output existed and
            were changed only to fix the false positive described in the findings. They are not tuned to rescue borderline answers: Qwen2.5 1.5B's “the tracking
            ID is null, so it cannot be tracked” stays marked wrong for “when will it arrive?”, which a human grader might accept. Open the traces to audit it.
          </li>
          <li>
            <strong>Groundedness is shallow.</strong> It checks numbers and a closed vocabulary of names, places and dates against the observations. It will not
            catch a fabricated claim made entirely of ordinary words.
          </li>
          <li>
            <strong>One wording per fix.</strong> Part 2 tests one refusal message, one second example and one cap length. The result is that <em>these</em>{" "}
            fixes failed, not that no guard or no cap could work. Part 3 exists because the same caveat applied to the second example, and there it mattered.
          </li>
          <li>
            <strong>Two small task sets.</strong> Parts 1 to 3 reuse one set of 12 tasks and part 4 adds 12 more. The paired design removes sampling noise
            from the comparison between harnesses, since a replay of 24 recorded runs in a different browser build reproduced every token, but with 12
            tasks per set the replication in part 4 can only catch large effects.
          </li>
          <li>
            <strong>One quantisation, one machine.</strong> All models are 4-bit (q4f16). Timings depend on the GPU and should not be compared across machines. Parts 2 and 3 ran partly in a throttled background tab and partly in headless Chromium, so no timings are reported for them.
          </li>
        </ul>

        <Section n={n("repro")}>Reproduce it</Section>
        <p>
          Everything on this page runs client-side. The Experiment tab re-runs the full grid in your browser and draws the same charts from your results. The
          agent loop, mock tools, rubric and judge are each a single short file under <code>src/lib</code>, and <code>npm test</code> drives the loop with a
          scripted fake model to check the rubric itself. For long runs, <code>scripts/run-headless.mjs</code> drives the same page in headless Chromium, where
          it cannot be throttled, and <code>scripts/check-determinism.mjs</code> replays recorded runs to confirm they reproduce.
        </p>
      </div>
    </article>
  );
}
