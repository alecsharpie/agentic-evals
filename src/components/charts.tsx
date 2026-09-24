// Small hand-rolled chart kit: HTML/CSS marks, one shared tooltip, and a table
// twin for every figure so no value is reachable only by hovering.

import { createContext, useContext, useState, type ReactNode } from "react";

// ------------------------------------------------------------ tooltip

interface Tip {
  x: number;
  y: number;
  text: string;
}

const TipContext = createContext<(tip: Tip | null) => void>(() => {});

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <TipContext.Provider value={setTip}>
      {children}
      {tip && (
        <div className="tooltip" role="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 320), top: tip.y + 16 }}>
          {tip.text}
        </div>
      )}
    </TipContext.Provider>
  );
}

/** Props that make an element show `text` on hover and on keyboard focus. */
export function useTip() {
  const setTip = useContext(TipContext);
  return (text: string) => ({
    tabIndex: 0,
    "aria-label": text,
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ x: r.left, y: r.bottom - 8, text });
    },
    onBlur: () => setTip(null),
  });
}

// ------------------------------------------------------------ figure frame

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function Figure({ title, sub, table, children }: { title: string; sub?: ReactNode; table: TableData; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="figure card">
      <div className="figure-head">
        <div>
          <h3>{title}</h3>
          {sub && <p className="sub">{sub}</p>}
        </div>
        <button className="btn small" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {asTable ? (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
}

export function Legend({ series, extra }: { series: Series[]; extra?: ReactNode }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}>
          <i className="swatch" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
      {extra}
    </div>
  );
}

// ------------------------------------------------------------ horizontal grouped bars

export interface Bar {
  series: string;
  value: number;
  /** Optional interval, same units as value. */
  lo?: number;
  hi?: number;
  label: string;
  tip: string;
}

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  bars: Bar[];
}

export function HBars({ rows, series, max, ticks, formatTick }: { rows: BarRow[]; series: Series[]; max: number; ticks: number[]; formatTick: (v: number) => string }) {
  const tip = useTip();
  const color = Object.fromEntries(series.map((s) => [s.key, s.color]));
  const x = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <div>
      <div className="hbars">
        {rows.map((row) => (
          <div key={row.key} style={{ display: "contents" }}>
            <div className="hbars-label">
              {row.label}
              {row.sub && <small>{row.sub}</small>}
            </div>
            <div className="hbars-plot">
              <div className="hbars-gridlines">
                {ticks.map((t) => (
                  <i key={t} style={{ left: x(t) }} />
                ))}
              </div>
              {row.bars.map((b) => (
                <div key={b.series} className="hbars-track hit" {...tip(b.tip)}>
                  <div className="hbar" style={{ width: x(b.value), background: color[b.series] }} />
                  {b.lo !== undefined && b.hi !== undefined && <div className="hbar-ci" style={{ left: x(b.lo), width: `calc(${x(b.hi)} - ${x(b.lo)})` }} />}
                  <div className="hbar-value" style={{ left: x(Math.max(b.value, b.hi ?? 0)) }}>{b.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div />
        <div className="hbars-axis">
          {ticks.map((t) => (
            <span key={t} style={{ left: x(t) }}>
              {formatTick(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ heatmap

/** One-hue sequential fill for a 0..1 value, plus an ink colour that stays legible on it. */
export function seqStyle(value: number): React.CSSProperties {
  const v = Math.max(0, Math.min(1, value));
  return {
    background: `color-mix(in oklab, var(--seq-hi) ${Math.round(v * 100)}%, var(--seq-lo))`,
    color: v > 0.5 ? "var(--cell-ink-hi)" : "var(--cell-ink-lo)",
  };
}

export interface HeatCell {
  value: number;
  text: string;
  tip: string;
}

export function Heatmap({ rows, columns, cell, scaleLabel, wideLabels }: {
  rows: { key: string; label: string; sub?: string }[];
  columns: { key: string; label: string; sub?: string }[];
  cell: (rowKey: string, colKey: string) => HeatCell | null;
  scaleLabel: [string, string];
  /** Row labels are full sentences (task questions), not short names. */
  wideLabels?: boolean;
}) {
  const tip = useTip();
  return (
    <div className="scroll-x">
      <table className={wideLabels ? "heat matrix" : "heat"}>
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c.key}>
                {c.label}
                {c.sub && <small>{c.sub}</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th>
                {r.label}
                {r.sub && <small>{r.sub}</small>}
              </th>
              {columns.map((c) => {
                const d = cell(r.key, c.key);
                return d ? (
                  <td key={c.key} style={seqStyle(d.value)} {...tip(d.tip)}>
                    {d.text}
                  </td>
                ) : (
                  <td key={c.key} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="scale">
        {scaleLabel[0]} <i /> {scaleLabel[1]}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ 100% stacked bars

export interface StackSegment {
  key: string;
  count: number;
  color: string;
  ink: string;
  tip: string;
}

export function StackRows({ rows }: { rows: { key: string; label: string; sub?: string; segments: StackSegment[] }[] }) {
  const tip = useTip();
  return (
    <div className="hbars">
      {rows.map((row) => {
        const total = row.segments.reduce((s, x) => s + x.count, 0);
        return (
          <div key={row.key} style={{ display: "contents" }}>
            <div className="hbars-label">
              {row.label}
              {row.sub && <small>{row.sub}</small>}
            </div>
            <div className="stack" style={{ margin: "6px 0" }}>
              {row.segments
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div key={s.key} className="stack-seg hit" style={{ flex: s.count, background: s.color, color: s.ink }} {...tip(s.tip)}>
                    {/* Only label a segment wide enough to hold the digits. */}
                    {s.count / total >= 0.08 ? s.count : ""}
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ stat tiles

export function Tiles({ tiles }: { tiles: { label: string; value: string; note: string }[] }) {
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="label">{t.label}</div>
          <div className="value">{t.value}</div>
          <div className="note">{t.note}</div>
        </div>
      ))}
    </div>
  );
}
