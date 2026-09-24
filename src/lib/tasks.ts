// The task suite. Each task carries its own ground truth so scoring is
// deterministic: what the answer must say, what it must not say, and which
// tool calls a correct solution has to make.

export type Tier = "lookup" | "chain" | "compute" | "edge";

export interface RequiredCall {
  tool: string;
  /** Expected value of the tool's parameter, normalised. Omit to accept any successful call. */
  arg?: string;
}

export interface Task {
  id: string;
  tier: Tier;
  question: string;
  /** Human-readable reference answer, shown to the LLM judge. */
  reference: string;
  /** Every pattern must match the final answer. */
  mustMatch: RegExp[];
  /** No pattern may match the final answer. */
  mustNotMatch?: RegExp[];
  requiredCalls: RequiredCall[];
  /** Model turns an ideal agent needs, including the final `finish`. */
  optimalSteps: number;
}

export const TIER_LABEL: Record<Tier, string> = {
  lookup: "Single lookup",
  chain: "Chained lookups",
  compute: "Lookup + arithmetic",
  edge: "Edge case",
};

/**
 * Matches a money amount exactly: "39", "$39.00", "39." at a sentence end, but
 * not "0.39", "139" or "39.5". A plain \b is not enough, since "." is a word boundary.
 */
export function amount(value: string): RegExp {
  const [int, dec] = value.split(".");
  const fraction = dec ? `\\.${dec}0*` : `(\\.0+)?`;
  return new RegExp(`(?<![\\d.])${int}${fraction}(?!\\.?\\d)`);
}

const NOT_FOUND =
  /not (be )?found|no (such |matching )?(order|record)|(could|can|did)( ?no|n['’]?)t (find|locate)|unable to (find|locate)|(does|did)( ?no|n['’]?)t exist|not exist|invalid order/i;

export const TASKS: Task[] = [
  {
    id: "status",
    tier: "lookup",
    question: "What is the status of order A1001?",
    reference: "Order A1001 has shipped.",
    mustMatch: [/shipped/i],
    requiredCalls: [{ tool: "get_order", arg: "A1001" }],
    optimalSteps: 2,
  },
  {
    id: "price",
    tier: "lookup",
    question: "How much does the desk lamp cost?",
    reference: "The desk lamp costs $24.50.",
    mustMatch: [amount("24.5")],
    requiredCalls: [{ tool: "get_product", arg: "desk lamp" }],
    optimalSteps: 2,
  },
  {
    id: "stock",
    tier: "lookup",
    question: "Is the yoga mat in stock?",
    reference: "No, the yoga mat is out of stock.",
    mustMatch: [/out of stock|\bnot\b|n['’]t\b|unavailable|\bfalse\b|^\W*no\b/i],
    mustNotMatch: [/^\W*yes\b/i],
    requiredCalls: [{ tool: "get_product", arg: "yoga mat" }],
    optimalSteps: 2,
  },
  {
    id: "customer",
    tier: "lookup",
    question: "Who placed order A1005?",
    reference: "Order A1005 was placed by Ingrid Holm.",
    mustMatch: [/ingrid holm/i],
    requiredCalls: [{ tool: "get_order", arg: "A1005" }],
    optimalSteps: 2,
  },
  {
    id: "eta",
    tier: "chain",
    question: "When will order A1001 arrive?",
    reference: "Order A1001 is expected to arrive on March 14.",
    mustMatch: [/march\s*14|14(th)?\s*(of\s*)?march/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1001" },
      { tool: "track_shipment", arg: "TRK-501" },
    ],
    optimalSteps: 3,
  },
  {
    id: "location",
    tier: "chain",
    question: "Where is the parcel for order A1004 right now?",
    reference: "The parcel for order A1004 is currently in Chicago.",
    mustMatch: [/chicago/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1004" },
      { tool: "track_shipment", arg: "TRK-504" },
    ],
    optimalSteps: 3,
  },
  {
    id: "carrier",
    tier: "chain",
    question: "Which carrier is delivering order A1005?",
    reference: "Order A1005 is being delivered by BlueArrow.",
    mustMatch: [/blue\s?arrow/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1005" },
      { tool: "track_shipment", arg: "TRK-505" },
    ],
    optimalSteps: 3,
  },
  {
    id: "item-price",
    tier: "chain",
    question: "What is the unit price of the item in order A1002?",
    reference: "The item in order A1002 is a coffee grinder, which costs $39.00.",
    mustMatch: [amount("39")],
    requiredCalls: [
      { tool: "get_order", arg: "A1002" },
      { tool: "get_product", arg: "coffee grinder" },
    ],
    optimalSteps: 3,
  },
  {
    id: "bulk-total",
    tier: "compute",
    question: "How much do 3 desk lamps cost in total?",
    reference: "3 desk lamps cost $73.50 in total.",
    mustMatch: [amount("73.5")],
    requiredCalls: [{ tool: "get_product", arg: "desk lamp" }, { tool: "calculate" }],
    optimalSteps: 3,
  },
  {
    id: "order-total",
    tier: "compute",
    question: "What is the total value of order A1004?",
    reference: "Order A1004 is 4 water bottles at $12.25 each, $49.00 in total.",
    mustMatch: [amount("49")],
    requiredCalls: [{ tool: "get_order", arg: "A1004" }, { tool: "get_product", arg: "water bottle" }, { tool: "calculate" }],
    optimalSteps: 4,
  },
  {
    id: "missing-order",
    tier: "edge",
    question: "What is the status of order A9999?",
    reference: "Order A9999 could not be found.",
    mustMatch: [NOT_FOUND],
    mustNotMatch: [/\b(is|has|was|been) (currently )?(processing|shipped|delivered)\b/i],
    requiredCalls: [{ tool: "get_order", arg: "A9999" }],
    optimalSteps: 2,
  },
  {
    id: "not-shipped",
    tier: "edge",
    question: "When will order A1003 arrive?",
    reference: "Order A1003 is still processing and has not shipped, so there is no arrival date yet.",
    mustMatch: [/processing|(not|n['’]t) (yet )?(been )?shipped|no tracking|no (eta|estimated|arrival|delivery)|not (yet )?(available|known)/i],
    mustNotMatch: [/march\s*\d|\d+(st|nd|rd|th)?\s*(of\s*)?march/i],
    requiredCalls: [{ tool: "get_order", arg: "A1003" }],
    optimalSteps: 2,
  },
];

const SHIPMENT_NOT_FOUND =
  /not (be )?found|no (such |matching )?(shipment|tracking|record)|(could|can|did)( ?no|n['’]?)t (find|locate|track)|unable to (find|locate|track)|(does|did)( ?no|n['’]?)t exist|not exist|invalid tracking/i;

/**
 * Part 4: a fresh task set, written after parts 1-3 and before any model saw it.
 * Same tools, same tiers; new orders, and shapes no worked example demonstrates.
 */
export const TASKS_V2: Task[] = [
  {
    id: "b-tracking",
    tier: "lookup",
    question: "What is the tracking number for order A1002?",
    reference: "The tracking number for order A1002 is TRK-502.",
    mustMatch: [/trk-?502/i],
    requiredCalls: [{ tool: "get_order", arg: "A1002" }],
    optimalSteps: 2,
  },
  {
    id: "b-direct",
    tier: "lookup",
    question: "Where is shipment TRK-505 right now?",
    reference: "Shipment TRK-505 is currently in Portland.",
    mustMatch: [/portland/i],
    requiredCalls: [{ tool: "track_shipment", arg: "TRK-505" }],
    optimalSteps: 2,
  },
  {
    id: "b-quantity",
    tier: "lookup",
    question: "How many water bottles are in order A1008?",
    reference: "Order A1008 contains 3 water bottles.",
    mustMatch: [/\b(3|three)\b/i],
    requiredCalls: [{ tool: "get_order", arg: "A1008" }],
    optimalSteps: 2,
  },
  {
    id: "b-under50",
    tier: "lookup",
    question: "Is the backpack under $50?",
    reference: "No, the backpack costs $54.",
    // The answer must state the price or negate the comparison. A bare "no" anywhere
    // is not enough: "no such order" is a non-answer, not a correct one.
    mustMatch: [/\$?\s?54|not under|isn['’]?t under|over \$?\s?50|more than \$?\s?50|above \$?\s?50|exceeds|^\W*no[,.]/i],
    mustNotMatch: [/^\W*yes\b/i, /cannot be determined|could ?n['’]?o?t|unable to|no such order|not found/i],
    requiredCalls: [{ tool: "get_product", arg: "backpack" }],
    optimalSteps: 2,
  },
  {
    id: "b-carrier",
    tier: "chain",
    question: "Which carrier has order A1006?",
    reference: "Order A1006 is with BlueArrow.",
    mustMatch: [/blue\s?arrow/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1006" },
      { tool: "track_shipment", arg: "TRK-506" },
    ],
    optimalSteps: 3,
  },
  {
    id: "b-still",
    tier: "chain",
    question: "Order A1004 hasn't arrived yet. Is it still in Chicago?",
    reference: "Yes, order A1004 is still in Chicago.",
    mustMatch: [/chicago|^\W*yes\b/i],
    mustNotMatch: [/^\W*no\b|not in chicago|left chicago/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1004" },
      { tool: "track_shipment", arg: "TRK-504" },
    ],
    optimalSteps: 3,
  },
  {
    id: "b-buyer-stock",
    tier: "chain",
    question: "Who placed order A1003, and is that item in stock?",
    reference: "Aroha Ngata placed order A1003, and the yoga mat is out of stock.",
    mustMatch: [/aroha ngata/i, /out of stock|\bnot\b|n['’]t\b|unavailable|\bfalse\b/i],
    mustNotMatch: [/\b(is|are) (currently |still )?in stock\b/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1003" },
      { tool: "get_product", arg: "yoga mat" },
    ],
    optimalSteps: 3,
  },
  {
    id: "b-eta-tracking",
    tier: "chain",
    question: "When will order A1007 arrive, and what is its tracking number?",
    reference: "Order A1007 (tracking number TRK-507) will arrive on March 18.",
    mustMatch: [/march\s*18|18(th)?\s*(of\s*)?march/i, /trk-?507/i],
    requiredCalls: [
      { tool: "get_order", arg: "A1007" },
      { tool: "track_shipment", arg: "TRK-507" },
    ],
    optimalSteps: 3,
  },
  {
    id: "b-days",
    tier: "compute",
    question: "If today is March 10, how many days until order A1005 arrives?",
    reference: "Order A1005 arrives on March 12, which is 2 days away.",
    mustMatch: [/\b(2|two) (more )?days?\b/i],
    requiredCalls: [{ tool: "get_order", arg: "A1005" }, { tool: "track_shipment", arg: "TRK-505" }, { tool: "calculate" }],
    optimalSteps: 4,
  },
  {
    id: "b-bundle",
    tier: "compute",
    question: "What do a backpack and a water bottle cost together?",
    reference: "A backpack ($54.00) and a water bottle ($12.25) cost $66.25 together.",
    mustMatch: [amount("66.25")],
    requiredCalls: [{ tool: "get_product", arg: "backpack" }, { tool: "get_product", arg: "water bottle" }, { tool: "calculate" }],
    optimalSteps: 4,
  },
  {
    id: "b-by-name",
    tier: "edge",
    question: "Did Luis Ortega's order ship yet?",
    reference: "Orders can only be looked up by order number, so the customer needs to give their order number.",
    mustMatch: [/order (number|id|no\.?|reference)|which order|order\s*id/i],
    mustNotMatch: [/\b(has|was|is|been|already) (been )?(shipped|delivered|processing)\b|\b(has|is)( ?no|n['’]?)t (yet )?(been )?shipped\b/i],
    // No tool can answer this; the ideal agent finishes at once.
    requiredCalls: [],
    optimalSteps: 1,
  },
  {
    id: "b-missing-shipment",
    tier: "edge",
    question: "Where is shipment TRK-999?",
    reference: "Shipment TRK-999 could not be found.",
    mustMatch: [SHIPMENT_NOT_FOUND],
    mustNotMatch: [/\b(in|at|near) (denver|austin|chicago|portland|seattle|boston|miami)\b/i],
    requiredCalls: [{ tool: "track_shipment", arg: "TRK-999" }],
    optimalSteps: 2,
  },
];

export type TaskSetId = "v1" | "v2";
export const TASK_SETS: Record<TaskSetId, Task[]> = { v1: TASKS, v2: TASKS_V2 };
export const TASK_SET_LABEL: Record<TaskSetId, string> = { v1: "Original tasks", v2: "Fresh tasks (part 4)" };
export const ALL_TASKS: Task[] = [...TASKS, ...TASKS_V2];

export const taskById = (id: string) => ALL_TASKS.find((t) => t.id === id);
export const taskSetOf = (taskId: string): TaskSetId => (taskId.startsWith("b-") ? "v2" : "v1");
