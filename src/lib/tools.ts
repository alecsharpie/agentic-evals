// Mocked tools. The model is real; the world it acts on is this file.
// Everything is deterministic so a run can be scored against ground truth.

import type { ToolCall } from "./types.ts";

interface Order {
  order_id: string;
  customer: string;
  item: string;
  quantity: number;
  status: "processing" | "shipped" | "delivered";
  tracking_id: string | null;
}

interface Shipment {
  tracking_id: string;
  carrier: string;
  location: string;
  eta: string;
}

interface Product {
  name: string;
  price: number;
  in_stock: boolean;
}

export const ORDERS: Order[] = [
  { order_id: "A1001", customer: "Maya Patel", item: "desk lamp", quantity: 1, status: "shipped", tracking_id: "TRK-501" },
  { order_id: "A1002", customer: "Tom Becker", item: "coffee grinder", quantity: 2, status: "delivered", tracking_id: "TRK-502" },
  { order_id: "A1003", customer: "Aroha Ngata", item: "yoga mat", quantity: 1, status: "processing", tracking_id: null },
  { order_id: "A1004", customer: "Luis Ortega", item: "water bottle", quantity: 4, status: "shipped", tracking_id: "TRK-504" },
  { order_id: "A1005", customer: "Ingrid Holm", item: "backpack", quantity: 1, status: "shipped", tracking_id: "TRK-505" },
  // Added for the part 4 task set. Products are deliberately not extended: the
  // get_product error lists them, and changing it would alter recorded traces.
  { order_id: "A1006", customer: "Priya Raman", item: "coffee grinder", quantity: 1, status: "shipped", tracking_id: "TRK-506" },
  { order_id: "A1007", customer: "Diego Alvarez", item: "backpack", quantity: 2, status: "shipped", tracking_id: "TRK-507" },
  { order_id: "A1008", customer: "Hana Sato", item: "water bottle", quantity: 3, status: "delivered", tracking_id: "TRK-508" },
];

export const SHIPMENTS: Shipment[] = [
  { tracking_id: "TRK-501", carrier: "NorthPost", location: "Denver", eta: "March 14" },
  { tracking_id: "TRK-502", carrier: "SwiftShip", location: "Austin", eta: "March 2" },
  { tracking_id: "TRK-504", carrier: "SwiftShip", location: "Chicago", eta: "March 16" },
  { tracking_id: "TRK-505", carrier: "BlueArrow", location: "Portland", eta: "March 12" },
  { tracking_id: "TRK-506", carrier: "BlueArrow", location: "Seattle", eta: "March 20" },
  { tracking_id: "TRK-507", carrier: "NorthPost", location: "Boston", eta: "March 18" },
  { tracking_id: "TRK-508", carrier: "SwiftShip", location: "Miami", eta: "March 5" },
];

export const PRODUCTS: Product[] = [
  { name: "desk lamp", price: 24.5, in_stock: true },
  { name: "coffee grinder", price: 39.0, in_stock: true },
  { name: "yoga mat", price: 18.0, in_stock: false },
  { name: "water bottle", price: 12.25, in_stock: true },
  { name: "backpack", price: 54.0, in_stock: true },
];

/**
 * Closed vocabulary of world facts, used by the groundedness check. Order
 * statuses are left out on purpose: "has not shipped" is a legitimate thing to
 * say about an order whose observation only ever said "processing".
 */
export const WORLD_VOCAB: string[] = [
  ...new Set([
    ...ORDERS.map((o) => o.customer),
    ...SHIPMENTS.flatMap((s) => [s.carrier, s.location, s.eta]),
  ]),
];

export interface ToolSpec {
  name: string;
  description: string;
  /** Single required string parameter. Every mock tool has exactly one. */
  param: string;
  example: string;
}

export const TOOLS: ToolSpec[] = [
  { name: "get_order", description: "look up an order: customer, item, quantity, status, tracking_id", param: "order_id", example: "A1234" },
  { name: "track_shipment", description: "get carrier, current location and ETA for a shipment", param: "tracking_id", example: "TRK-123" },
  { name: "get_product", description: "get the price and stock level of a product", param: "name", example: "product name" },
  { name: "calculate", description: "evaluate an arithmetic expression", param: "expression", example: "2 * 3.5" },
  { name: "finish", description: "give the final answer to the customer and stop", param: "answer", example: "one clear sentence" },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export interface ToolResult {
  ok: boolean;
  output: string; // JSON shown to the model as the Observation
}

const ok = (value: unknown): ToolResult => ({ ok: true, output: JSON.stringify(value) });
const err = (message: string): ToolResult => ({ ok: false, output: JSON.stringify({ error: message }) });

export const normId = (v: unknown) => String(v).trim().replace(/^#/, "").toUpperCase();
export const normName = (v: unknown) => String(v).trim().toLowerCase().replace(/\s+/g, " ");

export function executeTool(call: ToolCall): ToolResult {
  const spec = TOOLS.find((t) => t.name === call.tool);
  if (!spec || spec.name === "finish") {
    return err(`Unknown tool '${call.tool}'. Available tools: ${TOOL_NAMES.join(", ")}`);
  }
  const arg = call.args[spec.param];
  if (arg === undefined || arg === null || String(arg).trim() === "") {
    return err(`Missing required input '${spec.param}' for ${spec.name}`);
  }

  switch (spec.name) {
    case "get_order": {
      const order = ORDERS.find((o) => o.order_id === normId(arg));
      return order ? ok(order) : err(`Order '${normId(arg)}' not found`);
    }
    case "track_shipment": {
      const shipment = SHIPMENTS.find((s) => s.tracking_id === normId(arg));
      return shipment ? ok(shipment) : err(`Tracking ID '${normId(arg)}' not found`);
    }
    case "get_product": {
      const name = normName(arg);
      const product = PRODUCTS.find((p) => p.name === name || `${p.name}s` === name);
      return product
        ? ok(product)
        : err(`Product '${name}' not found. Products: ${PRODUCTS.map((p) => p.name).join(", ")}`);
    }
    case "calculate": {
      try {
        return ok({ result: evaluate(String(arg)) });
      } catch (e) {
        return err(`Cannot evaluate '${String(arg)}': ${(e as Error).message}`);
      }
    }
  }
  return err(`Unknown tool '${call.tool}'`);
}

/** Recursive-descent arithmetic: + - * / ( ) and decimals. No eval. */
export function evaluate(expression: string): number {
  const src = expression.replace(/[$,\s]/g, "").replace(/[x×]/gi, "*").replace(/÷/g, "/");
  let pos = 0;

  const peek = () => src[pos];
  const number = (): number => {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(pos));
    if (!m) throw new Error(`unexpected '${peek() ?? "end"}'`);
    pos += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number => {
    if (peek() === "-") return pos++, -factor();
    if (peek() === "(") {
      pos++;
      const v = sum();
      if (peek() !== ")") throw new Error("missing ')'");
      pos++;
      return v;
    }
    return number();
  };
  const product = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = src[pos++];
      const r = factor();
      if (op === "/" && r === 0) throw new Error("division by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = src[pos++] === "+" ? v + product() : v - product();
    return v;
  };

  if (!src) throw new Error("empty expression");
  const value = sum();
  if (pos < src.length) throw new Error(`unexpected '${peek()}'`);
  return Math.round(value * 1e6) / 1e6;
}
