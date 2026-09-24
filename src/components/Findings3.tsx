// Part 3 prose: the graded predictions and the findings. Describes one specific recorded run.

import { PREDICTIONS, variantLabel } from "../lib/variants.ts";

// Verdicts on the predictions in variants.ts, in the same order. The predictions were
// committed before the runs; the verdicts were written after.
const VERDICTS: { verdict: "Confirmed" | "Half right" | "Refuted"; evidence: string }[] = [
  { verdict: "Confirmed", evidence: "Chained-lookup tasks, for models from 0.5B up, fell from 16 of 18 solved to 2 of 18." },
  {
    verdict: "Half right",
    evidence: "Chained lookups recovered fully (17 of 18). But the arithmetic task sat at 3 of 8 in both orders, and with the calc example alone, so recency does not explain its loss.",
  },
  { verdict: "Confirmed", evidence: "Solved by 6 of 8 configurations, including the 360M model, after 0 of 80 attempts under six other harnesses." },
  { verdict: "Confirmed", evidence: "26% of answers came too early, against 37% with the short second example and 21% at baseline." },
];

const FINDINGS: { title: string; body: React.ReactNode }[] = [
  {
    title: "The worked example is the program. The instructions are close to inert",
    body: (
      <>
        Removing the chained-lookup example, and changing nothing else, took success from 49 to 24 of 96: 3 tasks fixed, 28 broken. The tool list and rules
        were still in the prompt, describing <code>get_order</code> and <code>track_shipment</code> exactly as before. It made almost no difference. Chained
        lookups fell from 16 of 18 to 2 of 18, unanswered runs rose from 29 to 50, and even “what is the status of order A1001?”, a single call, dropped
        from 7 of 8 configurations to 4. The one exception marks where instruction-following begins: Qwen2.5 1.5B in free text held at 9 of 12 with no
        relevant example at all. <strong>Part 4 qualifies this:</strong> on a fresh task set the same removal costs nothing significant, because those
        fresh tasks did not match the example in the first place.
      </>
    ),
  },
  {
    title: "The same two examples, in the other order, are worth twelve tasks",
    body: (
      <>
        Part 2's harmful two-example prompt and part 3's reversed prompt contain identical text. With the short calculate example last, 38 of 96 tasks
        were solved. With the chained-lookup example last, 50 were: 14 fixed, 2 broken (p = 0.004), and statistically indistinguishable from the one-example
        baseline. Part 2's damage was therefore not caused by adding an example. It was caused by which example came last. The final example acts as the
        default trajectory, and the models depart from it only reluctantly. <strong>Part 4 refutes this:</strong> on twelve fresh questions the same
        reordering is worth nothing at all (5 pairs fixed, 6 broken). The effect below is real for these twelve tasks and does not generalise.
      </>
    ),
  },
  {
    title: "A demonstrated path can be replayed, including where it does not belong",
    body: (
      <>
        Showing the full <code>get_order → get_product → calculate</code> path unlocked the task that had resisted everything: “total value of order
        A1004” went from 0 of 80 attempts to 6 of 8, and “unit price of the item in order A1002”, a prefix of the same path, from 0 to 3. (Part 5 qualifies
        those zeroes: under sampling both are solved occasionally, so greedy decoding rather than the models was the binding constraint.) That confirms
        part 2's reading that these models replay demonstrations and do not compose them. But replay has no sense of applicability. Asked what a desk lamp
        costs, a question with no order in it, 13 of 24 runs now opened with <code>get_order</code>, against 1 of 23 at baseline. They looked up order
        B3000, which exists only in the example, or A1234, the placeholder in the tool description. “How much do 3 desk lamps cost?” fell from 5 of 8 to 0
        of 8. Net effect: 42 of 96, below baseline. The replay half of this survives part 4 in miniature, where the three-hop example is the only change
        that moves its matching task; the net harm does not.
      </>
    ),
  },
  {
    title: "The calculate example never helped the task it demonstrates",
    body: (
      <>
        The three-desk-lamps task has the exact shape of the calculate example, and it was solved by 5 of 8 configurations with no such example, then 3 of
        8 with it, whether it came first, last, or alone. The example supplies a number as well as a shape, and the number travels: across the harnesses
        that include a tent example, 19 runs on these twelve tasks multiplied by 89, the price of the example's tent (25 counting part 4's). At baseline, none did. For a model this size a worked example is not an abstract
        pattern. It is a concrete string, and its constants are as likely to be copied as its structure.
      </>
    ),
  },
  {
    title: "No single prompt wins, which points at routing",
    body: (
      <>
        Every example set traded one tier for another. Chain-last solves the chained lookups, three-hop solves the order totals, and nothing tested solves
        both. Picking the best harness separately for each task would solve 63 of 96, against 50 for the best single harness. That figure is an optimistic ceiling,
        since the picks are made on the same runs they are scored on, but the gap suggests the useful next step is not a better prompt but a router: classify the question, then show the one example whose path fits it. That is a hypothesis in the same position the
        part 2 fixes were in, plausible and untested, and part 2 is the reason to test it before believing it. Part 4 is the reason to doubt the 63 as
        well: it is computed on the same twelve tasks whose overlap with the examples produced the spread in the first place.
      </>
    ),
  },
];

export function Predictions() {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Harness</th>
            <th>Prediction, written before the runs</th>
            <th>Verdict</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {PREDICTIONS.map((p, i) => (
            <tr key={i}>
              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{variantLabel(p.variant)}</td>
              <td>{p.claim}</td>
              <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{VERDICTS[i].verdict}</td>
              <td>{VERDICTS[i].evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Findings3() {
  return (
    <>
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
