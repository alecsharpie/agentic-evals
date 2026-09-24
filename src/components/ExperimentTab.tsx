import { useRef, useState } from "react";
import type { ExperimentResults, Format, VariantId } from "../lib/types.ts";
import { emptyResults, plannedKeys, runExperiment, runKey, saveResults, type ExperimentConfig, type Progress } from "../lib/experiment.ts";
import { describeGpu, llm } from "../lib/llm.ts";
import { DEFAULT_JUDGE, MODELS } from "../lib/models.ts";
import { FORMATS, FORMAT_LABEL } from "../lib/stats.ts";
import { TASK_SETS, TASK_SET_LABEL, type TaskSetId } from "../lib/tasks.ts";
import { VARIANTS } from "../lib/variants.ts";
import { reportProgress, setBusy, useModel } from "../lib/useModel.ts";
import { AllFigures } from "./AllFigures.tsx";

declare global {
  interface Window {
    /** Exposed so a finished run can be pulled out of the page by automation. */
    __results?: ExperimentResults;
  }
}

export function ExperimentTab({ recorded, onRecorded }: { recorded: ExperimentResults | null; onRecorded: (r: ExperimentResults) => void }) {
  const model = useModel();
  const [modelIds, setModelIds] = useState(MODELS.map((m) => m.id));
  const [formats, setFormats] = useState<Format[]>([...FORMATS]);
  const [variants, setVariants] = useState<VariantId[]>(VARIANTS.map((v) => v.id));
  const [taskSet, setTaskSet] = useState<TaskSetId>("v1");
  const [extend, setExtend] = useState(true);
  const [judgeModelId, setJudgeModelId] = useState(DEFAULT_JUDGE);
  const [trials, setTrials] = useState(1);
  const [temperature, setTemperature] = useState(0);

  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = progress !== null && progress.phase !== "done" && progress.phase !== "stopped";

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const config: ExperimentConfig = { modelIds: MODELS.map((m) => m.id).filter((id) => modelIds.includes(id)), formats, variants, taskSet, trials, temperature, judgeModelId };
  const planned = plannedKeys(config);
  const total = planned.length;
  // Greedy runs are deterministic, so anything the recorded run already has need not be repeated.
  const reusable = extend && recorded && recorded.meta.temperature === temperature ? recorded : null;
  const have = new Set(reusable?.runs.map(runKey));
  const toRun = planned.filter((k) => !have.has(k)).length;
  // An interrupted judging pass leaves agent runs complete but answers ungraded;
  // the button must still start, or that run can never be finished.
  const toJudge = reusable?.runs.filter((r) => r.answer !== null && r.judge?.modelId !== judgeModelId).length ?? 0;

  async function start(resume: boolean) {
    const base = resume && results ? results : reusable ? (structuredClone(reusable) as ExperimentResults) : emptyResults(config, await describeGpu());
    abort.current = new AbortController();
    setSaved(null);
    setBusy(true);
    try {
      await runExperiment(llm, config, base, {
        signal: abort.current.signal,
        onProgress: setProgress,
        onResults: (r) => {
          window.__results = r;
          setResults(r);
        },
        // Checkpoints go to a scratch file; promoting a run to the write-up is an explicit click.
        onCheckpoint: (r) => void saveResults(r, "latest"),
      });
    } catch (e) {
      setProgress({ phase: "stopped", message: `Failed: ${(e as Error).message}`, done: 0, total });
    } finally {
      reportProgress(null, null);
      setBusy(false);
    }
  }

  async function publish() {
    if (!results) return;
    const ok = await saveResults(results, "recorded");
    setSaved(ok ? "Saved. The Write-up tab now shows this run." : "No dev server to save to. Use Download instead and place the file at public/results/recorded.json.");
    if (ok) onRecorded(results);
  }

  function download() {
    if (!results) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 1)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "recorded.json" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="exp-grid">
      <aside>
        <div className="field">
          <span className="field-label">Agent models</span>
          {MODELS.map((m) => (
            <label className="check" key={m.id}>
              <input type="checkbox" checked={modelIds.includes(m.id)} onChange={() => setModelIds(toggle(modelIds, m.id))} disabled={running} />
              {m.label} <small>~{m.downloadMb} MB</small>
            </label>
          ))}
        </div>
        <div className="field">
          <span className="field-label">Step formats</span>
          {FORMATS.map((f) => (
            <label className="check" key={f}>
              <input type="checkbox" checked={formats.includes(f)} onChange={() => setFormats(toggle(formats, f))} disabled={running} />
              {FORMAT_LABEL[f]}
            </label>
          ))}
        </div>
        <div className="field">
          <span className="field-label">Task set</span>
          <div className="segmented">
            {(Object.keys(TASK_SETS) as TaskSetId[]).map((id) => (
              <button key={id} aria-pressed={taskSet === id} onClick={() => setTaskSet(id)} disabled={running}>
                {TASK_SET_LABEL[id]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Harness variants</span>
          {VARIANTS.map((v) => (
            <label className="check" key={v.id} title={v.blurb}>
              <input type="checkbox" checked={variants.includes(v.id)} onChange={() => setVariants(toggle(variants, v.id))} disabled={running} />
              {v.label} {v.formats.length === 1 && <small>JSON only</small>}
            </label>
          ))}
        </div>
        <div className="field">
          <label className="check" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--ink)", fontSize: 14 }}>
            <input type="checkbox" checked={extend} onChange={() => setExtend(!extend)} disabled={running || !recorded} />
            Build on the recorded run
          </label>
          <span className="small muted">Skips runs the write-up already has. Untick to start from scratch.</span>
        </div>
        <div className="field">
          <label htmlFor="judge">Judge model</label>
          <select id="judge" value={judgeModelId} onChange={(e) => setJudgeModelId(e.target.value)} disabled={running}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="small muted">One fixed judge grades every agent, after all agent runs finish.</span>
        </div>
        <div className="field" style={{ gridTemplateColumns: "1fr 1fr", columnGap: 12 }}>
          <label htmlFor="trials">Trials</label>
          <label htmlFor="temp">Temperature</label>
          <input id="trials" type="number" min={1} max={5} value={trials} onChange={(e) => setTrials(Math.max(1, Number(e.target.value)))} disabled={running} />
          <input id="temp" type="number" min={0} max={1.5} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} disabled={running} />
          {trials > 1 && temperature === 0 && (
            <span className="small muted" style={{ gridColumn: "1 / -1" }}>
              At temperature 0 every trial is identical. Raise it to measure variance.
            </span>
          )}
        </div>

        {running ? (
          <button className="btn" style={{ width: "100%" }} onClick={() => abort.current?.abort()}>
            Stop after this run
          </button>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <button className="btn primary" onClick={() => start(false)} disabled={(!toRun && !toJudge) || model.busy}>
              {toRun ? `Run ${toRun} agent runs` : `Judge ${toJudge} answers`}
            </button>
            {results && progress?.phase === "stopped" && (
              <button className="btn" onClick={() => start(true)}>
                Resume
              </button>
            )}
          </div>
        )}
        <p className="small muted">
          First use downloads each model (about {Math.round(MODELS.filter((m) => modelIds.includes(m.id)).reduce((s, m) => s + m.downloadMb, 0) / 100) / 10} GB for this selection). Keep the tab in the foreground: browsers throttle WebGPU in background tabs.
        </p>
      </aside>

      <section>
        {progress && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }} className="small">
              <span id="exp-status" data-phase={progress.phase}>{progress.message}</span>
              <span className="muted">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="progress" style={{ marginTop: 10 }}>
              <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            {progress.phase === "done" && (
              <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn primary small" onClick={publish}>
                  Use as the write-up's recorded run
                </button>
                <button className="btn small" onClick={download}>
                  Download JSON
                </button>
                {saved && <span className="small muted">{saved}</span>}
              </div>
            )}
          </div>
        )}
        {results?.runs.length ? (
          <AllFigures results={results} />
        ) : (
          <div className="empty card">
            Runs every selected model against all {TASK_SETS[taskSet].length} tasks in each step format, then loads the judge and grades every answer.
            <br />
            Charts fill in live as runs complete.
          </div>
        )}
      </section>
    </div>
  );
}
