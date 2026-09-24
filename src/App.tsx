import { useEffect, useState } from "react";
import type { ExperimentResults } from "./lib/types.ts";
import { loadRecorded } from "./lib/experiment.ts";
import { hasWebGpu } from "./lib/llm.ts";
import { TooltipProvider } from "./components/charts.tsx";
import { ExperimentTab } from "./components/ExperimentTab.tsx";
import { LiveAgent } from "./components/LiveAgent.tsx";
import { WriteUp } from "./components/WriteUp.tsx";

type Tab = "writeup" | "live" | "experiment";
const TABS: { id: Tab; label: string }[] = [
  { id: "writeup", label: "Write-up" },
  { id: "live", label: "Live agent" },
  { id: "experiment", label: "Experiment" },
];

const tabFromHash = (): Tab => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "writeup";

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [recorded, setRecorded] = useState<ExperimentResults | null>(null);

  useEffect(() => {
    void loadRecorded().then(setRecorded);
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goTo = (next: Tab) => {
    location.hash = next;
    window.scrollTo(0, 0);
  };

  return (
    <TooltipProvider>
      <div className="shell">
        <header className="masthead">
          <h1>
            Tiny Agent Evals <span>· ReAct agents on WebGPU, scored against a rubric</span>
          </h1>
        </header>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => goTo(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab !== "writeup" && !hasWebGpu() && (
          <div className="notice">This browser has no WebGPU, so models cannot run here. Try a recent Chrome or Edge. The write-up and recorded traces still work.</div>
        )}

        {/* Tabs stay mounted so a running experiment survives switching away. */}
        <div hidden={tab !== "writeup"}>
          <WriteUp results={recorded} goTo={goTo} />
        </div>
        <div hidden={tab !== "live"}>
          <LiveAgent />
        </div>
        <div hidden={tab !== "experiment"}>
          <ExperimentTab recorded={recorded} onRecorded={setRecorded} />
        </div>
      </div>
    </TooltipProvider>
  );
}
