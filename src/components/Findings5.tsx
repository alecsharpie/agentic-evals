// Part 5 prose: verdicts on the committed predictions, and the findings. Written after the run.

export const VERDICTS_VAR: { verdict: "Confirmed" | "Half right" | "Refuted"; evidence: string }[] = [
  { verdict: "Confirmed", evidence: "34.8 of 96 on average against 49 greedy, and greedy sits at or above the sampled mean in 7 of the 8 configurations." },
  { verdict: "Confirmed", evidence: "6 of the 8 configurations span 3 or more tasks between their worst and best sample; the widest spans 4." },
  { verdict: "Refuted", evidence: "59 of 96 cells (61%) came out the same way all five times, just short of the two thirds predicted. The other 39% genuinely varied." },
  { verdict: "Refuted", evidence: "Both were solved: the unit price 5 times in 40, the order total twice. Rare, but not impossible." },
];

const FINDINGS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Every number in parts 1 to 4 is a best case",
    body: (
      <>
        The baseline harness solves 49 of 96 greedily and 34.8 on average when sampled, a gap of about 15 points. Greedy sits at or above the sampled mean
        in seven of the eight configurations, and above the best of five samples in three of them. This is not a flaw in the earlier parts, which compared
        greedy against greedy throughout, but it does fix what those numbers mean: they are the top of the range a model can produce, not the middle. A
        deployment that samples would see materially worse behaviour than any chart in parts 1 to 4 shows.
      </>
    ),
  },
  {
    title: "The spread puts a floor under the earlier effect sizes",
    body: (
      <>
        Across five resamples the aggregate score moved between 33 and 38 of 96, a standard deviation of 2.5. Measured against that, the effects the earlier
        parts report separate cleanly into two groups. Removing the chain example (−25, 10 SD), adding the short second example (−11, 4.4 SD) and reversing
        the example order (+12, 4.8 SD) are far larger than a different roll of the dice could produce. The loop guard (0 SD), the reversed harness against
        baseline (+1, 0.4 SD) and arguably three-hop (−7, 2.8 SD) are not. So the picture from part 4 sharpens: the large example effects were real and large
        on the tasks that produced them, and simply did not generalise; the small ones were never distinguishable from noise in the first place.
      </>
    ),
  },
  {
    title: "Temperature does what the loop guard could not, and it still does not help",
    body: (
      <>
        Part 2's headline failure was agents repeating a call they had already made until the step limit stopped them, and a guard that refused the repeat
        changed nothing. Sampling attacks the same loop from a different direction, and it does break some of them: runs stopped by the step limit fall from
        26% to 22%, and runs that never answer from 30% to 24%. Almost none of the rescued runs are right. Wrong answers rise from 8% to 22% and fabricated
        ones from 10% to 19%, while correct answers fall from 51% to 36%. The conclusion is the one part 2 reached from the other side: these agents are not
        stuck, they do not know, and every mechanism that converts silence into output converts it into confabulation.
      </>
    ),
  },
  {
    title: "“Zero for eighty” was a fact about greedy decoding, not about the models",
    body: (
      <>
        Part 3 made much of two tasks that no harness ever solved: the unit price of an item in an order, and an order's total value, both needing{" "}
        <code>get_order</code> followed by <code>get_product</code>. Under sampling the first is solved 5 times in 40 and the second twice, always by
        Qwen2.5 1.5B except for one Llama run. The capability is there and greedy decoding does not reach it. The successful order-total traces are also a
        small rebuke to the task design: both did the arithmetic in their heads, answering $49 from a quantity of 4 and a price of $12.25 without calling the
        calculator at all.
      </>
    ),
  },
  {
    title: "The eval measures capability and luck in roughly a three-to-two ratio",
    body: (
      <>
        Of the 96 model × format × task cells, 41 were never solved in five attempts and 18 always were, so 61% are decided. The remaining 39% could go
        either way, which is why a single greedy run per cell is a thin instrument and why the paired design in parts 2 to 4 mattered so much: comparing
        greedy against greedy holds the roll fixed. The one finding that has now survived everything is the size ladder. Under sampling the models rank
        SmolLM2 360M 1.2, Llama 3.2 1B 7.0, Qwen2.5 0.5B 8.8 and Qwen2.5 1.5B 17.8 of 24, the same order as greedy and the same order as the fresh task set
        in part 4. Model capability is the one thing this benchmark measures robustly.
      </>
    ),
  },
];

export function Findings5() {
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
