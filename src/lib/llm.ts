// Thin wrapper over WebLLM: one engine, one loaded model at a time, all on WebGPU.

import { CreateWebWorkerMLCEngine, type WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatMessage, Completion, CompletionOpts, LLM } from "./types.ts";

export interface LoadProgress {
  progress: number; // 0..1
  text: string;
}

export class WebLLM implements LLM {
  private engine: WebWorkerMLCEngine | null = null;
  private onProgress: (p: LoadProgress) => void = () => {};
  modelId: string | null = null;

  async load(modelId: string, onProgress: (p: LoadProgress) => void): Promise<void> {
    if (this.modelId === modelId) return;
    this.onProgress = onProgress;
    this.modelId = null;
    if (!this.engine) {
      const worker = new Worker(new URL("./llm.worker.ts", import.meta.url), { type: "module" });
      this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (r) => this.onProgress({ progress: r.progress, text: r.text }),
      });
    } else {
      await this.engine.reload(modelId);
    }
    this.modelId = modelId;
  }

  async complete(messages: ChatMessage[], opts: CompletionOpts): Promise<Completion> {
    if (!this.engine || !this.modelId) throw new Error("No model loaded");
    const started = performance.now();
    const stream = await this.engine.chat.completions.create({
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stop: opts.stop,
      seed: opts.seed,
      response_format: opts.jsonSchema ? { type: "json_object", schema: JSON.stringify(opts.jsonSchema) } : undefined,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    let promptTokens = 0;
    let completionTokens = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content;
      if (delta) {
        text += delta;
        opts.onToken?.(text);
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    }
    return { text, promptTokens, completionTokens, ms: Math.round(performance.now() - started) };
  }

  async interrupt(): Promise<void> {
    this.engine?.interruptGenerate();
  }
}

export async function describeGpu(): Promise<string> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  if (!gpu) return "WebGPU unavailable";
  const adapter = await gpu.requestAdapter();
  const info = adapter?.info;
  if (!info) return "WebGPU (unknown adapter)";
  return [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "WebGPU";
}

export const hasWebGpu = () => "gpu" in navigator;

/** Shared singleton: the Live and Experiment tabs use the same engine so a model is only ever loaded once. */
export const llm = new WebLLM();

// Dev-only handle for poking the engine from the console.
if (import.meta.env.DEV) (window as unknown as { __llm: WebLLM }).__llm = llm;
