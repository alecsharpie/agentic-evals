import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, Completion, Format, LLM } from "./types.ts";
import { parseStep, renderStep, runAgent } from "./agent.ts";
import { scoreRun } from "./rubric.ts";
import { TASKS, taskById } from "./tasks.ts";
import { evaluate, executeTool } from "./tools.ts";

/** A fake model that replays a fixed list of outputs. */
class ScriptedLLM implements LLM {
  seen: ChatMessage[][] = [];
  private outputs: string[];
  constructor(outputs: string[]) {
    this.outputs = outputs;
  }
  async complete(messages: ChatMessage[]): Promise<Completion> {
    this.seen.push([...messages]);
    const text = this.outputs.shift() ?? "";
    return { text, promptTokens: 10, completionTokens: 5, ms: 1 };
  }
}

const step = (format: Format, tool: string, args: Record<string, unknown>) => renderStep(format, "thinking", { tool, args });
const config = (format: Format) => ({ modelId: "scripted", format, trial: 0, temperature: 0 });

test("calculator", () => {
  assert.equal(evaluate("3 * 24.50"), 73.5);
  assert.equal(evaluate("4 x $12.25"), 49);
  assert.equal(evaluate("(1 + 2) * -3"), -9);
  assert.throws(() => evaluate("2 +"));
  assert.throws(() => evaluate("1 / 0"));
  assert.throws(() => evaluate("process.exit()"));
});

test("tools normalise arguments and report errors", () => {
  assert.match(executeTool({ tool: "get_order", args: { order_id: " a1001 " } }).output, /Maya Patel/);
  assert.match(executeTool({ tool: "get_product", args: { name: "Desk Lamps" } }).output, /24.5/);
  assert.equal(executeTool({ tool: "get_order", args: { id: "A1001" } }).ok, false);
  assert.equal(executeTool({ tool: "get_order", args: { order_id: "A9999" } }).ok, false);
  assert.equal(executeTool({ tool: "teleport", args: {} }).ok, false);
});

test("text parser: clean, repaired and failed steps", () => {
  const clean = parseStep("text", 'Thought: look it up\nAction: get_order\nAction Input: {"order_id": "A1001"}');
  assert.equal(clean.parse, "ok");
  assert.deepEqual(clean.call, { tool: "get_order", args: { order_id: "A1001" } });
  assert.equal(clean.thought, "look it up");

  const bare = parseStep("text", "Thought: x\nAction: get_order\nAction Input: A1001");
  assert.equal(bare.parse, "repaired");
  assert.deepEqual(bare.call?.args, { order_id: "A1001" });

  const final = parseStep("text", "Thought: done\nFinal Answer: It shipped.");
  assert.equal(final.parse, "repaired");
  assert.deepEqual(final.call, { tool: "finish", args: { answer: "It shipped." } });

  // Only the first action counts, and it is what goes back into the history.
  const double = parseStep("text", 'Thought: a\nAction: get_order\nAction Input: {"order_id": "A1001"}\nThought: b\nAction: finish\nAction Input: {"answer": "made up"}');
  assert.equal(double.call?.tool, "get_order");
  assert.doesNotMatch(double.canonical, /made up/);

  assert.equal(parseStep("text", "I think the order has shipped!").parse, "failed");
});

test("json parser", () => {
  const p = parseStep("json", '{"thought":"t","action":"calculate","input":{"expression":"1+1"}}');
  assert.deepEqual(p.call, { tool: "calculate", args: { expression: "1+1" } });
  assert.equal(parseStep("json", '{"thought":"t","action":"calc').parse, "failed");
});

for (const format of ["text", "json"] as const) {
  test(`ideal ${format} agent scores 90 before judging, on every task`, async () => {
    const ideal: Record<string, string[]> = {
      status: [step(format, "get_order", { order_id: "A1001" }), step(format, "finish", { answer: "Order A1001 has shipped." })],
      price: [step(format, "get_product", { name: "desk lamp" }), step(format, "finish", { answer: "The desk lamp costs $24.50." })],
      stock: [step(format, "get_product", { name: "yoga mat" }), step(format, "finish", { answer: "Sorry, the yoga mat is out of stock." })],
      customer: [step(format, "get_order", { order_id: "A1005" }), step(format, "finish", { answer: "Ingrid Holm placed order A1005." })],
      eta: [step(format, "get_order", { order_id: "A1001" }), step(format, "track_shipment", { tracking_id: "TRK-501" }), step(format, "finish", { answer: "It should arrive on March 14." })],
      location: [step(format, "get_order", { order_id: "A1004" }), step(format, "track_shipment", { tracking_id: "TRK-504" }), step(format, "finish", { answer: "It is in Chicago." })],
      carrier: [step(format, "get_order", { order_id: "A1005" }), step(format, "track_shipment", { tracking_id: "TRK-505" }), step(format, "finish", { answer: "BlueArrow is delivering it." })],
      "item-price": [step(format, "get_order", { order_id: "A1002" }), step(format, "get_product", { name: "coffee grinder" }), step(format, "finish", { answer: "The coffee grinder costs $39." })],
      "bulk-total": [step(format, "get_product", { name: "desk lamp" }), step(format, "calculate", { expression: "3 * 24.5" }), step(format, "finish", { answer: "3 desk lamps cost $73.50." })],
      "order-total": [step(format, "get_order", { order_id: "A1004" }), step(format, "get_product", { name: "water bottle" }), step(format, "calculate", { expression: "4 * 12.25" }), step(format, "finish", { answer: "The order total is $49." })],
      "missing-order": [step(format, "get_order", { order_id: "A9999" }), step(format, "finish", { answer: "Sorry, order A9999 could not be found." })],
      "not-shipped": [step(format, "get_order", { order_id: "A1003" }), step(format, "finish", { answer: "Order A1003 is still processing and has not shipped yet." })],
    };
    for (const task of TASKS) {
      const run = await runAgent(new ScriptedLLM(ideal[task.id]), task, config(format));
      const score = scoreRun(task, run, null);
      assert.equal(run.stopReason, "finished", task.id);
      // Everything but the 10 judge points.
      assert.equal(score.total, 90, `${task.id}: ${JSON.stringify(score.criteria)}`);
      assert.equal(score.outcome, "correct");
    }
  });
}

test("observations are fed back to the model", async () => {
  const model = new ScriptedLLM([step("text", "get_order", { order_id: "A1001" }), step("text", "finish", { answer: "Shipped." })]);
  await runAgent(model, taskById("status")!, config("text"));
  const last = model.seen[1].at(-1)!;
  assert.equal(last.role, "user");
  assert.match(last.content, /^Observation: .*TRK-501/);
});

test("answering without tools is caught as fabricated", async () => {
  const task = taskById("eta")!;
  const run = await runAgent(new ScriptedLLM([step("json", "finish", { answer: "It will arrive on April 2." })]), task, config("json"));
  const score = scoreRun(task, run, null);
  assert.equal(score.outcome, "fabricated");
  assert.equal(score.criteria.find((c) => c.id === "grounded")!.score, 0);
  assert.equal(score.criteria.find((c) => c.id === "tools")!.score, 0);
});

test("a number that never appeared in an observation is ungrounded", async () => {
  const task = taskById("bulk-total")!;
  const run = await runAgent(
    new ScriptedLLM([step("json", "get_product", { name: "desk lamp" }), step("json", "finish", { answer: "3 desk lamps cost $75.00." })]),
    task,
    config("json"),
  );
  const score = scoreRun(task, run, null);
  assert.equal(score.outcome, "fabricated");
  assert.match(score.criteria.find((c) => c.id === "grounded")!.detail, /"75"/);
  assert.equal(score.criteria.find((c) => c.id === "tools")!.score, 0.5);
});

test("the edge-case tasks reject a confident wrong answer", async () => {
  const task = taskById("not-shipped")!;
  const run = await runAgent(
    new ScriptedLLM([step("json", "get_order", { order_id: "A1003" }), step("json", "finish", { answer: "Order A1003 will arrive on March 14." })]),
    task,
    config("json"),
  );
  assert.equal(scoreRun(task, run, null).success, false);
});

test("loops stop: max steps and repeated parse failures", async () => {
  const task = taskById("status")!;
  const looping = await runAgent(new ScriptedLLM(Array(20).fill(step("json", "get_order", { order_id: "A1001" }))), task, config("json"));
  assert.equal(looping.stopReason, "max_steps");
  assert.equal(looping.steps.length, 8);
  assert.equal(scoreRun(task, looping, null).outcome, "no_answer");

  const babbling = await runAgent(new ScriptedLLM(Array(20).fill("The order has shipped, I am sure.")), task, config("text"));
  assert.equal(babbling.stopReason, "parse_failures");
  assert.equal(babbling.steps.length, 2);
});

test("an invented number cannot be laundered through calculate", async () => {
  const task = taskById("order-total")!;
  const run = await runAgent(
    new ScriptedLLM([step("json", "get_order", { order_id: "A1004" }), step("json", "calculate", { expression: "4 * 10" }), step("json", "finish", { answer: "The total value of order A1004 is $40." })]),
    task,
    config("json"),
  );
  const score = scoreRun(task, run, null);
  assert.equal(score.outcome, "fabricated");
  assert.match(score.criteria.find((c) => c.id === "grounded")!.detail, /"40".*calculate was fed/);
});

test("money patterns match the amount and nothing near it", async () => {
  const { amount } = await import("./tasks.ts");
  for (const good of ["It costs $39.", "39.00 dollars", "price: 39"]) assert.match(good, amount("39"));
  for (const bad of ["$0.39", "139", "39.5", "390"]) assert.doesNotMatch(bad, amount("39"));
  for (const good of ["$24.50", "24.5 each", "It is 24.50."]) assert.match(good, amount("24.5"));
  for (const bad of ["24.55", "124.50", "24"]) assert.doesNotMatch(bad, amount("24.5"));
});

test("loop guard refuses a repeated call and the model can recover", async () => {
  const task = taskById("status")!;
  const call = step("json", "get_order", { order_id: "A1001" });
  const model = new ScriptedLLM([call, call, step("json", "finish", { answer: "Order A1001 has shipped." })]);
  const run = await runAgent(model, task, { ...config("json"), variant: "guard" });
  assert.equal(run.steps[0].guarded, undefined);
  assert.equal(run.steps[1].guarded, true);
  assert.match(run.steps[1].observation!, /already made this exact call/);
  assert.match(model.seen[2].at(-1)!.content, /already made this exact call/);
  const score = scoreRun(task, run, null);
  assert.equal(score.success, true);
  // One wasted step costs a quarter of the efficiency credit; the refused call still counts as made.
  assert.equal(score.total, 87.5);

  const unguarded = await runAgent(new ScriptedLLM([call, call, step("json", "finish", { answer: "Shipped." })]), task, config("json"));
  assert.equal(unguarded.steps[1].guarded, undefined);
});

test("variants change the prompt and the grammar, and nothing else", async () => {
  const { initialMessages, stepSchema, THOUGHT_CAP } = await import("./agent.ts");
  const one = initialMessages("json", "Q?", ["chain"]);
  const two = initialMessages("json", "Q?", ["chain", "calc"]);
  assert.equal(two.length, one.length + 6);
  assert.deepEqual(two.slice(0, one.length - 1), one.slice(0, -1));
  assert.match(JSON.stringify(two), /2 \* 89/);
  assert.equal(JSON.stringify(stepSchema(true)).includes(`"maxLength":${THOUGHT_CAP}`), true);
  assert.equal(JSON.stringify(stepSchema(false)).includes("maxLength"), false);

  const model = new ScriptedLLM([step("text", "finish", { answer: "x" })]);
  await runAgent(model, taskById("status")!, { ...config("text"), variant: "guard+shots" });
  assert.match(JSON.stringify(model.seen[0]), /2 tents cost/);
});

test("sign test on discordant pairs", async () => {
  const { signTest } = await import("./stats.ts");
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(5, 0), 0.0625);
  assert.equal(signTest(3, 3), 1);
  assert.ok(Math.abs(signTest(10, 1) - 0.01171875) < 1e-9);
});

test("part 3 example sets: order, omission and the three-hop path", async () => {
  const { initialMessages } = await import("./agent.ts");
  const text = (ids: ("chain" | "calc" | "threehop")[]) => initialMessages("text", "Q?", ids).map((m) => m.content).join("\n");
  // Default is unchanged from part 1, so recorded baseline runs stay comparable.
  assert.equal(text(["chain"]), initialMessages("text", "Q?").map((m) => m.content).join("\n"));
  assert.doesNotMatch(text(["calc"]), /B2000/);
  assert.ok(text(["calc", "chain"]).indexOf("2 tents") < text(["calc", "chain"]).indexOf("B2000"));
  assert.ok(text(["chain", "calc"]).indexOf("2 tents") > text(["chain", "calc"]).indexOf("B2000"));
  const hop = text(["chain", "threehop"]);
  assert.ok(hop.indexOf("get_order") < hop.indexOf("get_product") && hop.indexOf("get_product") < hop.indexOf("calculate"));
  // The demonstrated order never appears in a task, and its answer is not any task's answer.
  const { TASKS } = await import("./tasks.ts");
  for (const t of TASKS) assert.doesNotMatch(t.question, /B3000|B2000/);
});

for (const format of ["text", "json"] as const) {
  test(`ideal ${format} agent scores 90 on every part-4 task`, async () => {
    const { TASKS_V2 } = await import("./tasks.ts");
    const ideal: Record<string, string[]> = {
      "b-tracking": [step(format, "get_order", { order_id: "A1002" }), step(format, "finish", { answer: "The tracking number for order A1002 is TRK-502." })],
      "b-direct": [step(format, "track_shipment", { tracking_id: "TRK-505" }), step(format, "finish", { answer: "Shipment TRK-505 is in Portland." })],
      "b-quantity": [step(format, "get_order", { order_id: "A1008" }), step(format, "finish", { answer: "Order A1008 has 3 water bottles." })],
      "b-under50": [step(format, "get_product", { name: "backpack" }), step(format, "finish", { answer: "No, the backpack costs $54." })],
      "b-carrier": [step(format, "get_order", { order_id: "A1006" }), step(format, "track_shipment", { tracking_id: "TRK-506" }), step(format, "finish", { answer: "Order A1006 is with BlueArrow." })],
      "b-still": [step(format, "get_order", { order_id: "A1004" }), step(format, "track_shipment", { tracking_id: "TRK-504" }), step(format, "finish", { answer: "Yes, it is still in Chicago." })],
      "b-buyer-stock": [step(format, "get_order", { order_id: "A1003" }), step(format, "get_product", { name: "yoga mat" }), step(format, "finish", { answer: "Aroha Ngata placed it, and the yoga mat is out of stock." })],
      "b-eta-tracking": [step(format, "get_order", { order_id: "A1007" }), step(format, "track_shipment", { tracking_id: "TRK-507" }), step(format, "finish", { answer: "Order A1007 (TRK-507) arrives on March 18." })],
      "b-days": [step(format, "get_order", { order_id: "A1005" }), step(format, "track_shipment", { tracking_id: "TRK-505" }), step(format, "calculate", { expression: "12 - 10" }), step(format, "finish", { answer: "It arrives on March 12, in 2 days." })],
      "b-bundle": [step(format, "get_product", { name: "backpack" }), step(format, "get_product", { name: "water bottle" }), step(format, "calculate", { expression: "54 + 12.25" }), step(format, "finish", { answer: "Together they cost $66.25." })],
      "b-by-name": [step(format, "finish", { answer: "I can only look orders up by order number. Could you give me the order number?" })],
      "b-missing-shipment": [step(format, "track_shipment", { tracking_id: "TRK-999" }), step(format, "finish", { answer: "Sorry, shipment TRK-999 could not be found." })],
    };
    for (const task of TASKS_V2) {
      const run = await runAgent(new ScriptedLLM(ideal[task.id]), task, config(format));
      const score = scoreRun(task, run, null);
      assert.equal(run.stopReason, "finished", task.id);
      assert.equal(score.total, 90, `${task.id}: ${JSON.stringify(score.criteria)}`);
    }
  });
}

test("part-4 edge cases reject the tempting answers", async () => {
  const { taskById } = await import("./tasks.ts");
  const byName = taskById("b-by-name")!;
  const guessed = await runAgent(new ScriptedLLM([step("json", "get_order", { order_id: "Luis Ortega" }), step("json", "finish", { answer: "Order not found, so it has not shipped yet." })]), byName, config("json"));
  assert.equal(scoreRun(byName, guessed, null).success, false);
  const asked = await runAgent(new ScriptedLLM([step("json", "get_order", { order_id: "Luis Ortega" }), step("json", "finish", { answer: "I could not find an order under that name; please give me the order number." })]), byName, config("json"));
  assert.equal(scoreRun(byName, asked, null).success, true);

  const still = taskById("b-still")!;
  const wrong = await runAgent(new ScriptedLLM([step("json", "get_order", { order_id: "A1004" }), step("json", "finish", { answer: "No, it has left Chicago." })]), still, config("json"));
  assert.equal(scoreRun(still, wrong, null).success, false);
});

test("the under-$50 task rejects non-answers that merely contain 'no'", async () => {
  const { taskById } = await import("./tasks.ts");
  const task = taskById("b-under50")!;
  const answer = (text: string) => scoreRun(task, { ...blank, answer: text, steps: [{ index: 0, raw: "", thought: "", parse: "ok" as const, ms: 1, promptTokens: 0, completionTokens: 0, call: { tool: "get_product", args: { name: "backpack" } }, observation: '{"name":"backpack","price":54,"in_stock":true}' }] }, null).success;
  const blank = { taskId: "b-under50", modelId: "m", format: "json" as const, variant: "base" as const, trial: 0, temperature: 0, answer: null, stopReason: "finished" as const, totalMs: 1, promptTokens: 0, completionTokens: 0, steps: [] };
  for (const good of ["No, the backpack costs $54.", "The backpack is not under $50.", "It is over $50."]) assert.equal(answer(good), true, good);
  for (const bad of ["Yes, it is under $50.", "The backpack is under $50.", "That cannot be determined as there is no such order.", "Backpacks are typically $20-$50."]) assert.equal(answer(bad), false, bad);
});
