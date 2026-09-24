// React binding for the shared engine: which model is loaded, and load progress.

import { useSyncExternalStore } from "react";
import { llm, type LoadProgress } from "./llm.ts";

export interface ModelState {
  modelId: string | null;
  loading: string | null;
  progress: LoadProgress | null;
  error: string | null;
  /** True while any tab is generating; the engine serves one request at a time. */
  busy: boolean;
}

let state: ModelState = { modelId: null, loading: null, progress: null, error: null, busy: false };
const listeners = new Set<() => void>();

function set(patch: Partial<ModelState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const setBusy = (busy: boolean) => set({ busy });
export const reportProgress = (progress: LoadProgress | null, loading: string | null) => set({ progress, loading, modelId: llm.modelId });

export async function ensureModel(modelId: string): Promise<boolean> {
  if (llm.modelId === modelId) return true;
  set({ loading: modelId, error: null, progress: { progress: 0, text: "Starting…" } });
  try {
    await llm.load(modelId, (progress) => set({ progress }));
    set({ modelId, loading: null, progress: null });
    return true;
  } catch (e) {
    set({ loading: null, progress: null, modelId: llm.modelId, error: (e as Error).message });
    return false;
  }
}

export function useModel(): ModelState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}
