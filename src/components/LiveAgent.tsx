import { useState } from "react";
import type { AgentRun, Format, JudgeResult, Score, VariantId } from "../lib/types.ts";
import { runAgent } from "../lib/agent.ts";
import { judgeRun } from "../lib/judge.ts";
import { llm } from "../lib/llm.ts";
import { DEFAULT_MODEL, MODELS, modelLabel } from "../lib/models.ts";
import { scoreRun } from "../lib/rubric.ts";
import { FORMAT_LABEL } from "../lib/stats.ts";
import { TASKS, TASK_SETS, TIER_LABEL, type Task, type TaskSetId, type Tier } from "../lib/tasks.ts";
import { ensureModel, setBusy, useModel } from "../lib/useModel.ts";
import { VARIANTS, variantById } from "../lib/variants.ts";
import { Scorecard } from "./Scorecard.tsx";
import { Trace } from "./Trace.tsx";

const TIERS = Object.keys(TIER_LABEL) as Tier[];

export function ModelProgress() {
  const model = useModel();
  if (model.error) return <div className="notice" style={{ borderLeftColor: "var(--critical)" }}>Could not load the model: {model.error}</div>;
  if (!model.loading || !model.progress) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{model.progress.text}</div>
      <div className="progress">
        <div style={{ width: `${model.progress.progress * 100}%` }} />
      </div>
    </div>
  );
}

export function LiveAgent() {
  const model = useModel();
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [format, setFormat] = useState<Format>("json");
  const [variant, setVariant] = useState<VariantId>("base");
  const [taskId, setTaskId] = useState(TASKS[4].id);
  const [custom, setCustom] = useState("");

  const [run, setRun] = useState<AgentRun | null>(null);
  const [runTask, setRunTask] = useState<Task | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [judge, setJudge] = useState<JudgeResult | null>(null);
  const [judging, setJudging] = useState(false);

  const isCustom = taskId === "custom";
  const running = model.busy || model.loading !== null;

  async function start() {
    const task: Task = isCustom
      ? { id: "custom", tier: "lookup", question: custom.trim(), reference: "", mustMatch: [], requiredCalls: [], optimalSteps: 0 }
      : Object.values(TASK_SETS).flat().find((t) => t.id === taskId)!;
    if (!task.question) return;

    setRun({ taskId: task.id, modelId, format, variant, trial: 0, temperature: 0, steps: [], answer: null, stopReason: "max_steps", totalMs: 0, promptTokens: 0, completionTokens: 0 });
    setRunTask(task);
    setScore(null);
    setJudge(null);
    if (!(await ensureModel(modelId))) return;

    setBusy(true);
    try {
      setStreaming("");
      const finished = await runAgent(
        llm,
        task,
        { modelId, format, variant, trial: 0, temperature: 0 },
        {
          onToken: (_, text) => setStreaming(text),
          onStep: (r) => {
            setRun({ ...r, steps: [...r.steps] });
            setStreaming("");
          },
        },
      );
      setStreaming(null);
      setRun(finished);
      if (isCustom) return;

      // Evaluation pass: deterministic checks first, then the LLM judge fills in "clear".
      setScore(scoreRun(task, finished, null));
      setJudging(true);
      const verdict = await judgeRun(llm, modelId, task, finished);
      setJudge(verdict);
      setScore(scoreRun(task, finished, verdict));
    } finally {
      setStreaming(null);
      setJudging(false);
      setBusy(false);
    }
  }

  return (
    <div className="live">
      <aside>
        <div className="field">
          <label htmlFor="model">Model</label>
          <select id="model" value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={running}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · ~{m.downloadMb} MB
              </option>
            ))}
          </select>
          <span className="small muted">
            {model.modelId === modelId ? "Loaded on your GPU." : "Downloads once, then is cached by the browser."}
          </span>
        </div>

        <div className="field">
          <span className="field-label">Step format</span>
          <div className="segmented">
            {(["json", "text"] as const).map((f) => (
              <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)} disabled={running || !variantById(variant).formats.includes(f)}>
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="variant">Harness</label>
          <select
            id="variant"
            value={variant}
            disabled={running}
            onChange={(e) => {
              const next = e.target.value as VariantId;
              setVariant(next);
              if (!variantById(next).formats.includes(format)) setFormat("json");
            }}
          >
            {VARIANTS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="small muted">{variantById(variant).blurb}</span>
        </div>

        <div className="field">
          <span className="field-label">Task</span>
          <div className="task-list">
            {(Object.keys(TASK_SETS) as TaskSetId[]).map((set) =>
              TIERS.map((tier) => (
                <div key={`${set}-${tier}`} style={{ display: "grid", gap: 2 }}>
                  <div className="task-tier">
                    {TIER_LABEL[tier]}
                    {set === "v2" && " · fresh set"}
                  </div>
                  {TASK_SETS[set]
                    .filter((t) => t.tier === tier)
                    .map((t) => (
                      <button key={t.id} className="task-item" aria-pressed={taskId === t.id} onClick={() => setTaskId(t.id)}>
                        {t.question}
                      </button>
                    ))}
                </div>
              )),
            )}
            <div className="task-tier">Your own</div>
            <button className="task-item" aria-pressed={isCustom} onClick={() => setTaskId("custom")}>
              Ask something else…
            </button>
          </div>
          {isCustom && (
            <>
              <input type="text" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Is the backpack in stock?" />
              <span className="small muted">Custom questions have no ground truth, so you get the trace but no score.</span>
            </>
          )}
        </div>

        <button className="btn primary" style={{ width: "100%" }} onClick={start} disabled={running || (isCustom && !custom.trim())}>
          {model.loading ? "Loading model…" : model.busy ? "Running…" : "Run agent"}
        </button>
      </aside>

      <section>
        <ModelProgress />
        {!run || !runTask ? (
          <div className="empty card">
            Pick a task and run the agent. The model runs on your GPU via WebGPU; nothing leaves this tab.
            <br />
            The tools it calls are mocks backed by a small fixed dataset.
          </div>
        ) : (
          <>
            <div className="kicker">
              {modelLabel(run.modelId)} · {FORMAT_LABEL[run.format]} · {variantById(run.variant).label}
            </div>
            <h2 className="question">{runTask.question}</h2>
            {runTask.reference && <div className="small muted">Ground truth: {runTask.reference}</div>}
            <Trace run={run} streaming={streaming} />
            {score && (
              <>
                <h3 style={{ margin: "8px 0 12px", fontSize: 15 }}>Evaluation</h3>
                <Scorecard score={score} judge={judge} judging={judging} />
                <p className="small muted">
                  Here the loaded model grades its own answer. The Experiment tab uses one fixed judge for every agent instead.
                </p>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
