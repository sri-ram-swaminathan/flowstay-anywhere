// Small local LLM for on-device persona rewrites (runs on the GPU via WebGPU).

export interface LlmModel {
  id: string;
  repo: string;
  label: string;
  approxMB: number;
  note: string;
  thinkingToggle?: boolean;
}

/** Small local LLMs for on-device persona rewrites (replaces Apple Intelligence). */
export const LLM_MODELS: LlmModel[] = [
  {
    id: 'qwen3.5-0.8b',
    repo: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
    label: 'Qwen3.5 0.8B',
    approxMB: 600,
    note: 'Good rewrites, multilingual. Needs GPU acceleration (WebGPU).',
    thinkingToggle: true,
  },
];

export const findLlm = (id: string) => LLM_MODELS.find((m) => m.id === id) ?? LLM_MODELS[0];

// Languages Parakeet v3 understands (auto-detects by default).
export const PARAKEET_V3_LANGUAGES: [string, string][] = [
  ['auto', 'Detect automatically'], ['en', 'English'], ['nl', 'Dutch'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pl', 'Polish'], ['sv', 'Swedish'], ['da', 'Danish'], ['fi', 'Finnish'], ['cs', 'Czech'], ['sk', 'Slovak'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['el', 'Greek'], ['bg', 'Bulgarian'], ['hr', 'Croatian'], ['sl', 'Slovenian'], ['et', 'Estonian'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['mt', 'Maltese'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
];
