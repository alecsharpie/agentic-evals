// Part 2 prose. Like Findings.tsx, it describes one specific recorded run.

const FINDINGS: { title: string; body: React.ReactNode }[] = [
  {
    title: "The loop guard changed nothing, because the models do not read the refusal",
    body: (
      <>
        With the guard on, 49 of 96 tasks were solved, exactly as before: one fixed, one broken. The premise was right, since the guard fired in 61 runs
        across the three harnesses that include it. The cure was wrong. In 39 of those 61 runs the very next step was the same call again, straight into a
        second refusal, and 46 of the 61 still ended without an answer. Only 3 ended correct. A model that cannot tell its observation already answers the
        question also cannot use an error message saying so. Where the guard did force an ending, it mostly converted “no answer” into a guess: unanswered
        runs fell from 29 to 27 while fabricated answers rose from 10 to 12.
      </>
    ),
  },
  {
    title: "The second example made things worse, and the traces show why",
    body: (
      <>
        Adding a lookup-then-calculate example dropped success from 49 to 38 of 96: 5 tasks fixed, 16 broken (exact sign test p = 0.027), with losses in
        every model from 0.5B up. The example was not learned as a skill. It was copied as a template. Its trajectory is short, two calls and a finish, and
        the models started finishing early: on the three chained-lookup tasks, runs that called <code>track_shipment</code> before answering fell from 16 of
        17 to 12 of 17, producing answers like “the parcel for order A1004 is currently in the water bottle”. Overall, answers given without every required
        call rose from 14 of 67 to 26 of 70. The content leaked too: four runs computed a desk-lamp total as <code>3 * 89</code>, where 89 is the price of
        the tent in the example. Even the task with exactly the example's shape, “how much do 3 desk lamps cost”, fell from 5 of 8 configurations to 3.
      </>
    ),
  },
  {
    title: "The thought cap removed the failure it targeted, and recovered one task",
    body: (
      <>
        Capping <code>thought</code> at 120 characters in the grammar did what it was designed to do. Runs stopped by truncated JSON went from 4 to 0, and
        unparseable steps from 8 to 1. But success on the JSON arm moved from 23 to 24 of 48. Of the runs the cap rescued from truncation, all but one then
        failed for an ordinary reason. The loop inside the thought string was a symptom of a model that had already lost the thread, not the cause of the
        failure. Llama 3.2 1B's gap between free text (8) and JSON (6 with the cap) remains mostly unexplained.
      </>
    ),
  },
  {
    title: "The hard tasks did not move at all",
    body: (
      <>
        “Unit price of the item in order A1002” and “total value of order A1004” need <code>get_order</code> followed by <code>get_product</code>, a
        composition neither example shows. They were solved 0 times in 80 attempts across all six harnesses. Showing both halves of the chain in separate
        examples was not enough for any model under 2B to join them. This is the clearest capability boundary in the experiment: these models can replay a
        demonstrated trajectory with new arguments, and cannot compose two demonstrated trajectories into a third.
      </>
    ),
  },
  {
    title: "Three reasonable fixes, zero wins: this is what the eval is for",
    body: (
      <>
        Each intervention came from a careful reading of part 1's failures, each had a plausible mechanism, and each would have been easy to ship on
        intuition. Stacking all three took the JSON arm from 23 to 19. Without a paired, deterministic comparison, the two-example prompt in particular would
        have looked like an obvious improvement, and it was the most harmful change tested. The diagnoses in part 1 were correct about symptoms and wrong
        about cures, and only running the experiment could tell those apart.
      </>
    ),
  },
];

export function Findings2() {
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
