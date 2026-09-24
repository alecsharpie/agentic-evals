import type { JudgeResult, Outcome, Score } from "../lib/types.ts";
import { modelLabel } from "../lib/models.ts";
import { RUBRIC } from "../lib/rubric.ts";

export const OUTCOME: Record<Outcome, { label: string; glyph: string; color: string; ink: string; blurb: string }> = {
  correct: { label: "Correct", glyph: "✓", color: "var(--good)", ink: "#fff", blurb: "Final answer matches ground truth" },
  wrong: { label: "Wrong", glyph: "✗", color: "var(--serious)", ink: "#0b0b0b", blurb: "Answered from real observations, but incorrectly" },
  fabricated: { label: "Fabricated", glyph: "!", color: "var(--critical)", ink: "#fff", blurb: "Wrong, and states facts no tool returned" },
  no_answer: { label: "No answer", glyph: "–", color: "var(--warning)", ink: "#0b0b0b", blurb: "Never reached a final answer" },
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome];
  return (
    <span className="outcome" title={o.blurb}>
      <span className="swatch" style={{ background: o.color }} />
      {o.glyph} {o.label}
    </span>
  );
}

export function Scorecard({ score, judge, judging }: { score: Score; judge: JudgeResult | null; judging?: boolean }) {
  return (
    <div className="card">
      <div className="scorecard-head">
        <div>
          <div className="field-label">Rubric score</div>
          <div className="score-total">
            {score.total}
            <small> / 100</small>
          </div>
        </div>
        <OutcomeBadge outcome={score.outcome} />
      </div>

      {RUBRIC.map((c) => {
        const s = score.criteria.find((x) => x.id === c.id)!;
        const pending = c.grader === "judge" && judging;
        return (
          <div className="criterion" key={c.id} title={c.question}>
            <div className="name">
              {c.label} <span className="muted small">{c.grader === "judge" ? "· LLM judge" : ""}</span>
            </div>
            <div className="meter" role="meter" aria-valuenow={Math.round(s.score * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={c.label}>
              <div style={{ width: `${s.score * 100}%` }} />
            </div>
            <div className="points">
              {pending ? "…" : Math.round(s.score * c.weight * 10) / 10}/{c.weight}
            </div>
            <div className="detail">{pending ? "Judging…" : s.detail}</div>
          </div>
        );
      })}

      {judge && (
        <p className="small muted" style={{ margin: "14px 0 0" }}>
          Judge check ({modelLabel(judge.modelId)}): asked separately whether the answer is correct, it said{" "}
          <strong style={{ color: "var(--ink)" }}>{judge.correct.verdict ? "yes" : "no"}</strong>, which{" "}
          {judge.correct.verdict === score.success ? "agrees" : "disagrees"} with the ground-truth check. “{judge.correct.reasoning}”
        </p>
      )}
    </div>
  );
}
