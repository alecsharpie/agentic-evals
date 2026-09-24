import type { ExperimentResults } from "../lib/types.ts";

// The prose below describes one specific recorded run. If a different run is
// saved over it the charts update but these sentences would not, so say so.
const ANALYSED_RUN = "2026-09-20T16:12:04.967Z";

const FINDINGS: { title: string; body: React.ReactNode }[] = [
  {
    title: "The floor for this task is about half a billion parameters",
    body: (
      <>
        SmolLM2 360M solved 2 of 12 tasks in either format and ended 15 of its 24 runs without an answer. Qwen2.5 0.5B, barely larger, solved 7 of 12, and
        it did so in about 2.5 seconds per task at roughly 45 tokens per second. Success then climbs slowly: 8 of 12 for Llama 3.2 1B and 9 of 12 for Qwen2.5
        1.5B, which costs about two and a half times the latency of the 0.5B model for two more tasks. No configuration's interval clears 95%. <strong>Part 5 adds a caveat to every figure in part 1:</strong> these are greedy numbers, and sampling the same
        harness at temperature 0.7 scores about 15 points of 96 lower.
      </>
    ),
  },
  {
    title: "Constrained decoding fixed a problem these models did not have",
    body: (
      <>
        Across all models, free text solved 26 of 48 tasks and constrained JSON solved 23. Every model from 0.5B up wrote a parseable free-text step on all
        130 of its turns, so there was no formatting failure for the grammar to remove. Only the 360M model gained anything, and only in partial credit (mean
        score 30 to 41). For Llama 3.2 1B the grammar did harm, dropping it from 8 tasks to 5, and most of that drop has one cause. The grammar guarantees syntax only if generation ends: the{" "}
        <code>thought</code> field is an unconstrained string, and four runs (three of them Llama's) fell into a repetition loop inside it (“I will get the carrier. The order is
        A1005. I will get the carrier…”) until the token limit cut the JSON off mid-string. A length cap on that field is the obvious next experiment, and part 2 runs it.
      </>
    ),
  },
  {
    title: "The dominant failure is not knowing when to stop",
    body: (
      <>
        Of 29 runs that never answered, 23 were stuck re-issuing calls they had already made, with the same arguments and the same observation coming back
        each time. Qwen2.5 0.5B had the order status in hand after one call and asked for it seven more times. The models can pick a tool and fill its
        argument; what they lack is the judgement that the observation in front of them already answers the question. Part 5 shows temperature does break
        some of these loops, and that it converts them into wrong answers rather than right ones. The obvious harness-level fix is to refuse a repeated call with a nudge to finish. Part 2 tests exactly that, and it does not work.
      </>
    ),
  },
  {
    title: "Small models follow the example, not the instructions",
    body: (
      <>
        The one worked example chains <code>get_order</code> into <code>track_shipment</code>, and the three chained-lookup tasks that share that shape were
        solved by every model from 0.5B up in free text. The tasks that need a different second hop were not: “total value of order A1004” went 0 for 8, and
        only one of those eight runs ever called <code>get_product</code>. Most of the rest invented a price, and the larger models then fed it to the calculator
        (<code>4 * 10</code>), which makes a fabricated number look computed. The two edge cases, where the right answer is “that order doesn't exist” or
        “it hasn't shipped”, went 4 for 16. Apart from one SmolLM2 run, only Qwen2.5 1.5B reported the missing order; the other models retried the failing lookup until they ran out of
        steps.
      </>
    ),
  },
  {
    title: "The 1.5B judge cannot be trusted to catch wrong answers",
    body: (
      <>
        The judge agreed with ground truth on 56 of 67 answers (84%), which sounds usable until it is split by class. It passed 47 of 49 correct answers but
        also 9 of the 18 wrong ones, a coin flip. Its stated reasoning shows why: shown the reference “$49.00 in total” and the reply “$5”, it wrote that the
        reply “matches the reference”; twice it quoted the reference value as though the agent had said it. A judge this size is safe for a soft criterion
        like clarity, and is not a substitute for a mechanical check wherever one can be written.
      </>
    ),
  },
  {
    title: "Reading traces found two bugs in the grader, not just in the agents",
    body: (
      <>
        The first scoring pass had two errors, both found by reading the traces behind results that looked too good. The pattern for “$39” accepted “$0.39”, because a
        decimal point counts as a word boundary, so one wrong answer was marked correct. And the groundedness check accepted any number that appeared in a
        tool observation, including the output of <code>calculate</code> on invented inputs. Both were fixed with regression tests, and the stored traces were
        re-scored without re-running any model; six runs changed, and Llama's free-text result fell from 9 to 8. A deterministic grader is still a program,
        and it needs the same scrutiny as the thing it grades.
      </>
    ),
  },
];

export function Findings({ results }: { results: ExperimentResults }) {
  return (
    <>
      {results.meta.startedAt !== ANALYSED_RUN && (
        <div className="notice">These findings describe an earlier recorded run. The charts above show a newer one, so specific numbers below may not match.</div>
      )}
      {FINDINGS.map((f, i) => (
        <div className="finding" key={f.title}>
          <div className="n">{i + 1}</div>
          <div>
            <h4>{f.title}</h4>
            <p>{f.body}</p>
          </div>
        </div>
      ))}
    </>
  );
}
