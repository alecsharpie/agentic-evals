import type { Format, Harness, VariantId } from "./types.ts";

export interface Variant {
  id: VariantId;
  /** 1 = the original harness, 2 = the three fixes, 3 = the worked-example ablation. */
  part: 1 | 2 | 3;
  label: string;
  harness: Harness;
  /** The thought cap lives in the JSON grammar, so those variants have no free-text arm. */
  formats: Format[];
  blurb: string;
}

const BOTH: Format[] = ["text", "json"];
const plain = { guard: false, thoughtCap: false };

export const VARIANTS: Variant[] = [
  { id: "base", part: 1, label: "Baseline", harness: { ...plain, examples: ["chain"] }, formats: BOTH, blurb: "The original harness from part 1: one worked example, a chained lookup." },
  { id: "guard", part: 2, label: "Loop guard", harness: { ...plain, guard: true, examples: ["chain"] }, formats: BOTH, blurb: "A repeated identical call is refused, with a nudge to use the earlier result or finish." },
  { id: "shots", part: 2, label: "Two examples", harness: { ...plain, examples: ["chain", "calc"] }, formats: BOTH, blurb: "A second worked example shows a product lookup followed by calculate." },
  { id: "guard+shots", part: 2, label: "Guard + examples", harness: { ...plain, guard: true, examples: ["chain", "calc"] }, formats: BOTH, blurb: "Both of the above." },
  { id: "cap", part: 2, label: "Thought cap", harness: { ...plain, thoughtCap: true, examples: ["chain"] }, formats: ["json"], blurb: "The grammar limits the thought string to 120 characters. JSON only." },
  { id: "all", part: 2, label: "All three", harness: { guard: true, thoughtCap: true, examples: ["chain", "calc"] }, formats: ["json"], blurb: "Guard, two examples and the thought cap together. JSON only." },
  { id: "calc-only", part: 3, label: "Calc only", harness: { ...plain, examples: ["calc"] }, formats: BOTH, blurb: "The chained-lookup example is removed. The only example is product lookup, then calculate." },
  { id: "shots-rev", part: 3, label: "Reversed", harness: { ...plain, examples: ["calc", "chain"] }, formats: BOTH, blurb: "The same two examples as part 2, in the opposite order: calculate first, chained lookup last." },
  { id: "three-hop", part: 3, label: "Three-hop", harness: { ...plain, examples: ["chain", "threehop"] }, formats: BOTH, blurb: "The second example is a full order total: get_order, then get_product, then calculate." },
];

/**
 * Part 3 predictions, committed before the runs were made. Each is stated so that the
 * per-task counts can confirm or refute it.
 */
export const PREDICTIONS: { variant: VariantId; claim: string }[] = [
  { variant: "calc-only", claim: "Chained-lookup tasks collapse without the chain example, because that skill was copied from the example and not read from the instructions." },
  { variant: "shots-rev", claim: "With the chain example last, chained-lookup tasks recover to baseline, and the arithmetic task loses instead: the most recent example dominates." },
  { variant: "three-hop", claim: "“Total value of order A1004”, 0 for 80 so far, is solved by at least one configuration, because its path is now demonstrated and only needs replaying." },
  { variant: "three-hop", claim: "Premature finishing falls below the two-example harness, because the last example is long instead of short." },
];

/**
 * Part 4 predictions, committed before any model saw the fresh task set. Parts 1-3
 * were developed on one set of 12 tasks; these say what should replicate on 12 new ones.
 */
export const PREDICTIONS_V2: { variant: VariantId; claim: string }[] = [
  { variant: "base", claim: "Baseline solves fewer fresh tasks than original ones (under 49 of 96): three of the new shapes are demonstrated by no example." },
  { variant: "shots-rev", claim: "Order still matters: chain-last beats calc-last on the fresh set, with more pairs fixed than broken between the two." },
  { variant: "calc-only", claim: "Removing the chain example collapses the fresh chained tier too: fewer than half as many chained-lookup tasks solved as at baseline." },
  { variant: "base", claim: "Replay where it does not belong: asked about shipment TRK-505 directly, at least half of baseline runs open with get_order instead of track_shipment." },
  { variant: "three-hop", claim: "“Who placed A1003, and is that item in stock?” (get_order then get_product) improves under three-hop, whose example demonstrates that prefix." },
  { variant: "base", claim: "“Did Luis Ortega's order ship?”, which no tool can answer, is solved by at most 1 of 8 baseline configurations." },
];

export const variantById = (id: VariantId) => VARIANTS.find((v) => v.id === id)!;
export const variantLabel = (id: VariantId) => variantById(id).label;
