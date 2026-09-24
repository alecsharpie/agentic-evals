// Part 4 prose: verdicts on the committed predictions, and the findings. Written after the run.

export const VERDICTS_V2: { verdict: "Confirmed" | "Half right" | "Refuted"; evidence: string }[] = [
  { verdict: "Confirmed", evidence: "28 of 96, against 49 on the original set. The drop shows up in every tier." },
  { verdict: "Refuted", evidence: "Chain-last against calc-last: 5 pairs fixed, 6 broken (p = 1.000). On the original set the same comparison was 14 and 2." },
  {
    verdict: "Half right",
    evidence: "The fresh chained tier halved, 10 of 32 to 5 of 32, so the direction holds. But it did not fall below half as predicted, and calc-only's overall difference is not significant here (9 fixed, 16 broken, p = 0.230).",
  },
  { verdict: "Confirmed", evidence: "6 of 8 baseline runs opened with get_order, two with a tool that does not exist. Not one opened with track_shipment." },
  { verdict: "Confirmed", evidence: "0 of 8 configurations at baseline, 2 of 8 under three-hop." },
  { verdict: "Confirmed", evidence: "0 of 8, and 0 of 40 across all five harnesses." },
];

const FINDINGS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Not one effect from part 3 replicates",
    body: (
      <>
        On the original tasks the example sets separated sharply: removing the chain example cost 25 tasks (p &lt; 0.001), the short second example cost 11
        (p = 0.027), and reversing the two examples recovered 12 (14 pairs fixed against 2 broken, p = 0.004). Run the identical harnesses on twelve fresh
        questions and every one of those differences disappears. Against the fresh baseline of 28 of 96: two examples 29, reversed 28, three-hop 28,
        calc-only 21. Each is a coin flip of fixed and broken pairs, and the smallest p-value among them is 0.230. Part 3's headline, that example order is
        worth twelve tasks, does not survive its first replication.
      </>
    ),
  },
  {
    title: "What parts 2 and 3 actually measured was overlap between the example and the task set",
    body: (
      <>
        The explanation is visible in the task lists. Three of the twelve original tasks, “when will A1001 arrive”, “where is the parcel for A1004” and
        “which carrier has A1005”, need exactly the call sequence the chain example demonstrates, and two more are prefixes or extensions of the three-hop
        example. Swapping examples swung those five directly. In the fresh set only one task, “which carrier has order A1006”, matches a demonstrated
        sequence. With that overlap gone the prompt changes have almost nothing to grip. The effects were real and reproducible, and they were properties of
        one particular pairing of prompt and benchmark rather than of small-model prompting. A held-out set is the only thing that could have told those
        apart.
      </>
    ),
  },
  {
    title: "Unfamiliar shapes are much harder than the tier labels suggest",
    body: (
      <>
        The fresh tasks were written to the same four tiers, with the same tools and a world of the same size, and baseline success still fell from 49 of 96
        to 28. Every tier dropped: single lookups 23 to 15, chained 17 to 10, arithmetic 5 to 1, edge cases 4 to 2. Two questions were solved by nobody, in
        40 attempts each. “How many days until A1005 arrives” needs March 12 minus March 10, which no example demonstrates, and the models either answered
        with the date instead of the count or invented subtractions like <code>3 − 10</code>. The difficulty a task poses these models is not how many
        steps it takes, but how far it sits from something they have been shown.
      </>
    ),
  },
  {
    title: "Not one run asked a clarifying question",
    body: (
      <>
        “Did Luis Ortega's order ship yet?” has no answer available: every tool takes an ID, and no tool searches by name. The correct reply is to ask for
        the order number. Across 40 runs, none did. Eleven called <code>get_order</code> with “Luis Ortega” as the order ID and 18 passed the name to some tool, 30 never produced an answer at all, and the rest asserted something false, including “the shipment for Luis Ortega has already shipped”. The prompt's five rules never mention
        asking the customer anything, and neither does any example, and these models do not invent a move they have not been shown. This is the same lesson
        as finding 2, seen from the other side.
      </>
    ),
  },
  {
    title: "A task that can be answered by echoing the question, and the rubric that caught it",
    body: (
      <>
        Auditing the fresh traces turned up a flaw of my own making. “Order A1004 hasn't arrived. Is it still in Chicago?” names Chicago in the question, so
        an agent can look up the order, skip the shipment lookup that would actually verify the location, and say “yes, still in Chicago”. Eight of the 23
        runs marked correct on that task did exactly this. The binary success metric could not tell them apart from the fifteen that checked, but the
        weighted rubric could: those eight average 89 of 100 against 97 for the rest, docked by the tool-call and efficiency criteria. A second bug in the
        same audit was uglier, a correctness pattern that accepted any “no” anywhere in the answer, so “cannot be determined as there is no such order”
        scored full marks on “is the backpack under $50?”. That one is fixed, with a test, and re-scoring moved four runs in both directions. Across four
        parts every grader bug has been found the same way, by reading traces behind results that looked wrong, and never by looking at a chart.
      </>
    ),
  },
];

export function Findings4() {
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
