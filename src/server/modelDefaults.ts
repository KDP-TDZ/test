import type { AiTaskType, TaskModelConfig } from '../core/types.js';

export interface ModelCatalogItem {
  modelId: string;
  displayName: string;
  provider: 'gemini' | 'groq' | 'cloudflare';
  tier: 'free';
  strengths: string;
  supportsMultimodal: boolean;
  supportsGoogleSearch: boolean;
}

export const MODEL_CATALOG: ModelCatalogItem[] = [
  {
    modelId: 'groq:openai/gpt-oss-120b',
    displayName: 'Groq · GPT-OSS 120B (Ưu tiên #1 · Siêu nhanh Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Ưu tiên số 1 cho toàn bộ hệ thống (~500 tok/s, miễn phí) — kiểm định kiến thức, tạo đề, tổng hợp SGK; tự gọi Llama 4 Scout Vision khi đọc ảnh OCR.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:meta-llama/llama-4-scout-17b-16e-instruct',
    displayName: 'Groq · Llama 4 Scout 17B Vision (Đa phương thức Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Model đa phương thức của Groq (~460 tok/s, miễn phí) — đọc trực tiếp ảnh chụp vở/PDF scan & xử lý mọi tác vụ văn bản trên cùng 1 AI.',
    supportsMultimodal: true,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:openai/gpt-oss-20b',
    displayName: 'Groq · GPT-OSS 20B Fast (Groq Cloud Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Tốc độ tức thì (~1.000 tok/s), miễn phí — cực nhanh cho phân loại môn, gợi ý tên tệp, flashcard & tác vụ nhẹ.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite (Google Free)',
    provider: 'gemini',
    tier: 'free',
    strengths:
      'Tốc độ rất nhanh, hỗ trợ OCR ảnh/PDF, Google Search Grounding & làm tầng dự phòng ổn định khi Groq chưa cấu hình key.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen (Google Free)',
    provider: 'gemini',
    tier: 'free',
    strengths:
      'Suy luận sâu cho công thức viết tay phức tạp, Google Search Grounding & kiểm định kiến thức chuẩn SGK.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    displayName: 'Cloudflare · Llama 3.3 70B FP8 Fast (Workers AI Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Miễn phí (10.000 Neurons/ngày trên hạ tầng Edge Cloudflare) — tầng dự phòng & chia tải cho chấm kiến thức, tạo đề trắc nghiệm.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.1-8b-instruct-fast',
    displayName: 'Cloudflare · Llama 3.1 8B Fast (Workers AI Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Miễn phí, tiêu tốn cực ít Neuron trên Cloudflare Edge — phù hợp cho phân loại môn, thẩm định nhanh & flashcard.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
];

const UNIFIED_PRIMARY_MODEL = 'groq:openai/gpt-oss-120b';
const UNIFIED_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

export const DEFAULT_TASK_MODELS: Record<AiTaskType, TaskModelConfig> = {
  subject_classification: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  curriculum_extraction: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  knowledge_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  completeness_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  claim_validation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  quiz_blueprint: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  quiz_generation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  quiz_validation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  answer_explanation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  flashcard_generation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
  feedback_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.1',
  },
};
