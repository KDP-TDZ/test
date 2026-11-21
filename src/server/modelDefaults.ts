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
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen (Google Free)',
    provider: 'gemini',
    tier: 'free',
    strengths: 'Ưu tiên số 1 cho OCR ảnh/PDF công thức viết tay phức tạp & kiểm định kiến thức chuẩn SGK.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite (Google Free)',
    provider: 'gemini',
    tier: 'free',
    strengths: 'Tốc độ rất nhanh, hạn mức RPM cao cho phân loại môn, kiểm tra cấu trúc, flashcard & phản hồi.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'groq:openai/gpt-oss-120b',
    displayName: 'Groq · GPT-OSS 120B (Groq Cloud Free)',
    provider: 'groq',
    tier: 'free',
    strengths: 'Model sản xuất mạnh nhất của Groq (~500 tok/s, miễn phí) — cực nhanh cho nhóm 2–3 người dùng song song khi xử lý văn bản/JSON & dự phòng Gemini 429.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:openai/gpt-oss-20b',
    displayName: 'Groq · GPT-OSS 20B Fast (Groq Cloud Free)',
    provider: 'groq',
    tier: 'free',
    strengths: 'Tốc độ tức thì (~1.000 tok/s), miễn phí — tối ưu cho phân loại môn, gợi ý tên tệp, flashcard & dự phòng nhẹ.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    displayName: 'Cloudflare · Llama 3.3 70B FP8 Fast (Workers AI Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths: 'Miễn phí (10.000 Neurons/ngày trên hạ tầng Edge Cloudflare) — tầng dự phòng & chia tải thứ 3 cho chấm kiến thức, tạo đề trắc nghiệm.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.1-8b-instruct-fast',
    displayName: 'Cloudflare · Llama 3.1 8B Fast (Workers AI Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths: 'Miễn phí, tiêu tốn cực ít Neuron trên Cloudflare Edge — phù hợp cho phân loại môn, thẩm định nhanh & flashcard.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
];

export const DEFAULT_TASK_MODELS: Record<AiTaskType, TaskModelConfig> = {
  subject_classification: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.0',
  },
  curriculum_extraction: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  knowledge_analysis: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v3.0',
  },
  completeness_analysis: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  claim_validation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  quiz_blueprint: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  quiz_generation: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  quiz_validation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  answer_explanation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  flashcard_generation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  feedback_analysis: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.0',
  },
};
