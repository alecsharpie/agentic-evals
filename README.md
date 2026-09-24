# Tiny Agent Evals

An agentic evaluation that runs entirely in the browser. Small language models (360M to 1.5B parameters) run a ReAct loop on your GPU through WebGPU, call mocked tools to answer customer-support questions, and are scored against a rubric. The app contains the live demo, the batch experiment, and the write-up with charts.

```
npm install
npm run dev        # http://localhost:5183
npm test           # drives the agent loop with a scripted fake model
```

Needs a browser with WebGPU (recent Chrome or Edge). Models download on first use and are cached by the browser. There is no backend and no API key.

## The three tabs

| Tab | What it does |
| --- | --- |
| **Write-up** | The four-part experiment report: setup, rubric, charts over the recorded run, clickable traces, findings, limitations. Works without a GPU. |
| **Live agent** | Pick a model, a step format and a task, then watch the ReAct loop stream token by token, followed by the rubric scorecard. |
| **Experiment** | Runs every model × format × task, then a judging pass, and draws the same charts live. A finished run can be saved as the write-up's recorded run. |

## How it works

| Piece | File | Notes |
| --- | --- | --- |
| Model | `src/lib/llm.ts` | WebLLM engine in a web worker. Real weights, real inference. |
| Mock tools | `src/lib/tools.ts` | `get_order`, `track_shipment`, `get_product`, `calculate`, `finish` over a tiny fixed dataset. |
| Tasks | `src/lib/tasks.ts` | Two sets of 12 questions in four tiers, each with ground truth and required tool calls. |
| Harness variants | `src/lib/variants.ts` | The nine prompt/harness configurations tested in parts 2-4, plus the committed predictions. |
| ReAct loop | `src/lib/agent.ts` | Thought → action → observation, in two wire formats: free text, or JSON decoded under a grammar. |
| Rubric | `src/lib/rubric.ts` | Six weighted criteria. Five are deterministic code checks; one is an LLM judge. |
| Judge | `src/lib/judge.ts` | Grades clarity for the rubric, and correctness so the judge can be compared with ground truth. |
| Runner | `src/lib/experiment.ts` | Batch grid, resumable, with checkpoints. |
| Stats | `src/lib/stats.ts` | Success rates, Wilson intervals, judge agreement. |

## Recorded results

`public/results/recorded.json` holds the run the write-up reports on. To replace it, run the Experiment tab to completion and click **Use as the write-up's recorded run**. Saving uses a small dev-server endpoint defined in `vite.config.ts`; on a static host, use **Download JSON** and put the file there yourself.

## What the recorded run found

96 runs (4 models × 2 step formats × 12 tasks), greedy decoding, Apple M3, about 9 minutes of agent time.

| Model | Free-text ReAct | Constrained JSON | Median s/task |
| --- | --- | --- | --- |
| SmolLM2 360M | 2/12 | 2/12 | ~5 |
| Qwen2.5 0.5B | 7/12 | 7/12 | ~2.5 |
| Llama 3.2 1B | 8/12 | 5/12 | ~4 |
| Qwen2.5 1.5B | 9/12 | 9/12 | ~6 |

- The usable floor for this task is about 0.5B parameters.
- Grammar-constrained JSON did not help: models from 0.5B up already wrote parseable free text on every turn, and Llama 1B got worse because it looped inside the unconstrained `thought` string until the token limit truncated the JSON.
- Most failures (23 of 29 unanswered runs) are the agent repeating a call it already made. It does not recognise that it can stop.
- Tasks shaped like the single few-shot example were solved; the three-hop "order total" task went 0 for 8, usually with an invented price.
- The 1.5B LLM judge passed 47 of 49 correct answers but also 9 of 18 wrong ones.
- Reading traces found two bugs in the grader itself (`$0.39` matching `$39`; invented numbers laundered through `calculate`). Both are fixed with regression tests, and `scripts/rescore.ts` re-scored the stored traces without re-running any model.

Small n: one task is worth 8 percentage points, and the intervals in the write-up are wide.

## Part 2: three fixes, none of which worked

Each part 1 diagnosis implied a cheap harness fix. Part 2 ran them: 384 more runs, same models, tasks and rubric. Decoding is greedy, so every comparison is a matched pair against the baseline run of the same model, format and task.

| Harness | Solved (baseline → harness) | Fixed | Broken |
| --- | --- | --- | --- |
| Loop guard: refuse a repeated call | 49 → 49 of 96 | 1 | 1 |
| Two examples: add lookup → calculate | 49 → 38 of 96 | 5 | 16 (p = 0.027) |
| Guard + examples | 49 → 39 of 96 | 6 | 16 |
| Thought cap, JSON only | 23 → 24 of 48 | 1 | 0 |
| All three, JSON only | 23 → 19 of 48 | 4 | 8 |

- The guard fired in 61 runs. In 39 of them the very next step was the same call again. The models do not read the refusal.
- The second example was copied as a template, not learned as a skill. Models began finishing after one call ("the parcel is currently in the water bottle"), and four runs computed a desk-lamp total as `3 * 89`, the tent price from the example.
- The thought cap eliminated truncated JSON (4 stops → 0) but recovered one task. The loop was a symptom, not the cause.
- The two tasks that need `get_order` then `get_product` were solved 0 times in 80 attempts across all six harnesses.

## Part 3: why the second example hurt

Part 3 varies only which worked examples the prompt contains, and in what order: 288 more runs. Predictions were committed to `src/lib/variants.ts` before the runs and are graded in the write-up (three confirmed, one half right).

| Example set | Solved of 96 | vs baseline (fixed / broken) |
| --- | --- | --- |
| Baseline: chain example only | 49 | |
| Two examples, calc last (part 2) | 38 | 5 / 16 |
| Calc only | 24 | 3 / 28 (p < 0.001) |
| Reversed: calc first, chain last | 50 | 7 / 6 |
| Three-hop: chain, then order → product → calculate | 42 | 15 / 22 |

- **The example is the program.** Removing the chain example, with the instructions and tool list untouched, cut chained lookups from 16 of 18 to 2 of 18. Only Qwen2.5 1.5B in free text held up without a relevant example.
- **Order is worth twelve tasks.** The same two examples solve 38 tasks with the short one last and 50 with the chain one last (14 fixed, 2 broken, p = 0.004). Part 2's damage came from which example was last, not from adding one.
- **Demonstrated paths get replayed, even where they do not fit.** The three-hop example took "total value of order A1004" from 0 of 80 to 6 of 8. It also made models open with `get_order("B3000")` on questions that mention no order, and "how much do 3 desk lamps cost" fell from 5 of 8 to 0.
- **Constants leak.** 19 runs multiplied by 89, the price of the tent in the example. None did at baseline.
- No single example set wins. Choosing the best one per task would solve 63 of 96 against 50 for the best single prompt, an optimistic ceiling that makes an example router the next hypothesis to test.

Pick a harness in the Live tab to watch any of these happen.

## Part 4: does any of it replicate?

Parts 1-3 all used the same 12 tasks, and parts 2-3 were designed by studying their failures. Part 4 writes 12 fresh questions on three new orders, with shapes no worked example demonstrates, and reruns the five example harnesses on them: 480 more runs. Six predictions were committed to `src/lib/variants.ts` first (four confirmed, one half right, one refuted).

| Harness | Original tasks | Fresh tasks |
| --- | --- | --- |
| Baseline (chain example) | 49/96 | 28/96 |
| Two examples, calc last | 38/96 (p = 0.027 vs base) | 29/96 (n.s.) |
| Calc only | 24/96 (p < 0.001) | 21/96 (n.s.) |
| Reversed, chain last | 50/96 | 28/96 |
| Three-hop | 42/96 | 28/96 |

**Not one effect replicates.** On the original tasks the harnesses spread from 24 to 50; on the fresh ones they sit between 21 and 29, every difference a coin flip (smallest p = 0.230). Part 3's headline result, that example order is worth twelve tasks, was 14 pairs fixed against 2 on the original set and is 5 against 6 here.

The reason is visible in the task lists: three of the twelve original tasks need exactly the call sequence the chain example demonstrates, and two more match the three-hop example. Only one of the twelve fresh tasks does. Parts 2 and 3 were measuring the overlap between the example and the benchmark, not a general property of prompting.

Other findings:

- Fresh tasks are much harder at the same nominal tiers: 28/96 against 49/96, with every tier down.
- Two tasks were solved by nobody in 40 attempts each: date arithmetic ("how many days until A1005 arrives"), and the one question no tool can answer, where the right reply is to ask for the order number. Not a single run asked a clarifying question.
- Asked about a shipment by its tracking number, 6 of 8 baseline runs still started with `get_order`, the first call of the example. None started with `track_shipment`.
- Auditing found a flaw in one of my own new tasks: "is it still in Chicago?" names the answer in the question, so 8 of 23 runs passed it without ever checking. Binary success could not tell them apart; the weighted rubric could (80 vs 90 average). A second, clearer bug was fixed with a test and re-scored.

## Reproducing the numbers

`public/results/recorded.json` (5 MB) holds all 1248 runs with full traces: every model turn's raw output, the parsed tool call, the mock's observation, timings and token counts, plus the final answer, judge verdicts with reasoning, and per-criterion scores. Every figure and every number in the write-up derives from this one file.

```
npm run analyse     # prints every number quoted in the write-up
npm run rescore     # re-applies the current rubric to stored traces
npm test            # 21 tests, incl. an ideal agent scoring 90 on all 24 tasks
```

`analyse.ts` imports the same `stats.ts` the page uses, so the terminal figures and the charts cannot drift apart. Scoring is separate from running, so a rubric fix never needs the models re-run.

## License

MIT. The models it downloads are separately licensed by their publishers (Qwen2.5 and SmolLM2 under Apache-2.0, Llama 3.2 under the Llama 3.2 Community License).

## Long runs

A background browser tab is throttled and may be suspended, which stalled part 3 midway; long headless runs can also lose the WebGPU context. `scripts/run-headless.mjs` drives the same Experiment page in headless Chromium with WebGPU, resumes from the recorded run, retries if the renderer crashes, and saves the result. `scripts/check-determinism.mjs` replays recorded runs and compares every token; 24 of 24 Qwen2.5 1.5B baseline runs reproduced exactly across browser builds, which is what licenses the paired comparisons.

```
CHROME=/path/to/chrome node scripts/run-headless.mjs
```
