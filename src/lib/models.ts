export interface ModelInfo {
  id: string; // WebLLM prebuilt model id
  label: string;
  params: string;
  /** Approximate download size, MB (4-bit weights). */
  downloadMb: number;
}

// A size ladder of instruction-tuned models small enough to run on WebGPU in a tab.
export const MODELS: ModelInfo[] = [
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", params: "0.36B", downloadMb: 210 },
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 0.5B", params: "0.5B", downloadMb: 290 },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", params: "1.2B", downloadMb: 710 },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B", params: "1.5B", downloadMb: 900 },
];

export const DEFAULT_MODEL = MODELS[1].id;
export const DEFAULT_JUDGE = MODELS[3].id;

export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;
