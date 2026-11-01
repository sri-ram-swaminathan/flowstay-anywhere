// Catalogue of on-device models. All run locally via Transformers.js (ONNX Runtime Web:
// WebGPU when available, otherwise WebAssembly). Files are downloaded once and cached.

export type AsrFamily = 'moonshine' | 'whisper';

export interface AsrModel {
  id: string;
  repo: string;
  label: string;
  family: AsrFamily;
  sizeMB: number;
  languages: 'en' | 'multi';
  dtype: Record<string, string>;
  /** Moonshine v2 export needs audio padded to a multiple of 80 samples. */
  padTo?: number;
  /** Max seconds per decode window. */
  windowSec: number;
  note: string;
  recommendedFor?: ('phone' | 'desktop')[];
}

export const ASR_MODELS: AsrModel[] = [
  {
    id: 'moonshine-v2-small',
    repo: 'Workmind/moonshine-streaming-small-ONNX',
    label: 'Moonshine v2 Small',
    family: 'moonshine',
    sizeMB: 158,
    languages: 'en',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    padTo: 80,
    windowSec: 28,
    note: 'Newest (2026) edge model. Beats Whisper Small at a fraction of the size. English.',
    recommendedFor: ['desktop'],
  },
  {
    id: 'moonshine-base',
    repo: 'onnx-community/moonshine-base-ONNX',
    label: 'Moonshine Base',
    family: 'moonshine',
    sizeMB: 63,
    languages: 'en',
    dtype: { encoder_model: 'quantized', decoder_model_merged: 'quantized' },
    windowSec: 28,
    note: 'Small and fast. Best default for iPhone. English.',
    recommendedFor: ['phone'],
  },
  {
    id: 'moonshine-tiny',
    repo: 'onnx-community/moonshine-tiny-ONNX',
    label: 'Moonshine Tiny',
    family: 'moonshine',
    sizeMB: 30,
    languages: 'en',
    dtype: { encoder_model: 'quantized', decoder_model_merged: 'quantized' },
    windowSec: 28,
    note: 'Smallest download, lower accuracy. English.',
  },
  {
    id: 'whisper-base',
    repo: 'onnx-community/whisper-base',
    label: 'Whisper Base (multilingual)',
    family: 'whisper',
    sizeMB: 80,
    languages: 'multi',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    windowSec: 28,
    note: '99 languages. Vocabulary is fed to the model as a prompt for real biasing.',
  },
  {
    id: 'whisper-large-v3-turbo',
    repo: 'onnx-community/whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo (multilingual)',
    family: 'whisper',
    sizeMB: 560,
    languages: 'multi',
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    windowSec: 28,
    note: 'Most accurate multilingual option. Needs a GPU-capable laptop; too heavy for phones.',
  },
];

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
    note: 'Good rewrites, multilingual. Needs GPU acceleration (on CPU-only devices Qwen2.5 0.5B is used instead).',
    thinkingToggle: true,
  },
  {
    id: 'gemma-3-270m',
    repo: 'onnx-community/gemma-3-270m-it-ONNX',
    label: 'Gemma 3 270M',
    approxMB: 250,
    note: 'Tiny. Fine for cleanup/punctuation, weaker at tone changes.',
  },
];

export const findAsr = (id: string) => ASR_MODELS.find((m) => m.id === id) ?? ASR_MODELS[1];
export const findLlm = (id: string) => LLM_MODELS.find((m) => m.id === id) ?? LLM_MODELS[0];

export const WHISPER_LANGUAGES: [string, string][] = [
  ['en', 'English'], ['nl', 'Dutch'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['zh', 'Chinese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['ru', 'Russian'], ['pl', 'Polish'],
  ['tr', 'Turkish'], ['sv', 'Swedish'], ['uk', 'Ukrainian'],
];
