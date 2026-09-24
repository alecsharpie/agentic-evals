import type { AgentRun, Step } from "../lib/types.ts";

const STOP_LABEL: Record<AgentRun["stopReason"], string> = {
  finished: "Finished",
  max_steps: "Hit the step limit without answering",
  parse_failures: "Stopped: two unreadable steps in a row",
  error: "Stopped: runtime error",
};

function StepView({ step }: { step: Step }) {
  const isFinish = step.call?.tool === "finish";
  return (
    <li className="step">
      <div className="step-rail">
        <div className="step-dot">{step.index + 1}</div>
        <div className="step-line" />
      </div>
      <div className="step-body">
        <div className="step-head">
          {step.call ? <span className="tag tool">{step.call.tool}</span> : <span className="tag bad">unreadable step</span>}
          {step.guarded && <span className="tag bad">refused: repeated call</span>}
          {step.parse === "repaired" && <span className="tag" title={step.parseNote}>repaired</span>}
          <span>
            {(step.ms / 1000).toFixed(1)}s · {step.completionTokens} tokens
          </span>
        </div>
        {step.call && step.thought && <p className="thought">{step.thought}</p>}
        {isFinish ? (
          <div className="final-answer">{String(step.call!.args.answer ?? "")}</div>
        ) : (
          <div className="io">
            {step.call ? (
              <div className="io-row">
                <div className="io-key">Input</div>
                <div className="io-val">{JSON.stringify(step.call.args)}</div>
              </div>
            ) : (
              <div className="io-row">
                <div className="io-key">Model said</div>
                <div className="io-val">{step.raw || "(nothing)"}</div>
              </div>
            )}
            {step.observation !== undefined && (
              <div className="io-row">
                <div className="io-key">{step.guarded ? "Loop guard" : step.call ? "Mock tool" : "Feedback"}</div>
                <div className={`io-val ${step.toolError ? "error" : ""}`}>{step.observation}</div>
              </div>
            )}
          </div>
        )}
        {step.parseNote && <div className="small muted" style={{ marginTop: 6 }}>Parser: {step.parseNote}</div>}
      </div>
    </li>
  );
}

export function Trace({ run, streaming }: { run: AgentRun; streaming?: string | null }) {
  return (
    <>
      <ol className="trace">
        {run.steps.map((s) => (
          <StepView key={s.index} step={s} />
        ))}
        {streaming != null && (
          <li className="step">
            <div className="step-rail">
              <div className="step-dot">{run.steps.length + 1}</div>
            </div>
            <div className="step-body">
              <div className="step-head">generating…</div>
              <div className="io-val caret" style={{ padding: "6px 0" }}>{streaming}</div>
            </div>
          </li>
        )}
      </ol>
      {streaming == null && run.stopReason !== "finished" && run.steps.length > 0 && (
        <div className="notice" style={{ borderLeftColor: "var(--critical)" }}>
          {STOP_LABEL[run.stopReason]}
          {run.error ? `: ${run.error}` : "."}
        </div>
      )}
    </>
  );
}
