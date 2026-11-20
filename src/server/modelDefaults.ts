import type { AiTaskType, TaskModelConfig } from '../core/types.js';

export interface ModelCatalogItem {
  modelId: string;
  displayName: string;
  provider: 'gemini' | 'groq';
  tier: 'free';
  strengths: string;
  supportsMultimodal: boolean;
  supportsGoogleSearch: boolean;
}

export const MODEL_CATALOG: ModelCatalogItem[] = [
  {
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen',
    provider: 'gemini',
    tier: 'free',
    strengths: 'Suy luận sâu, kiểm định tri thức đa nguồn, OCR công thức & chữ viết tay phức tạp.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    provider: 'gemini',
    tier: 'free',
    strengths: 'Tốc độ rất nhanh, tiết kiệm token cho phân loại môn, kiểm tra cấu trúc, flashcard & phản hồi.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'groq:llama-3.3-70b-versatile',
    displayName: 'Groq · Llama 3.3 70B (Free)',
    provider: 'groq',
    tier: 'free',
    strengths: 'Miễn phí (~1.000 req/ngày, phản hồi siêu nhanh) — xử lý văn bản/JSON: kiểm định kiến thức, tạo đề & dự phòng khi Gemini đạt giới hạn 429.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:llama-3.1-8b-instant',
    displayName: 'Groq · Llama 3.1 8B Instant (Free)',
    provider: 'groq',
    tier: 'free',
    strengths: 'Tốc độ cực nhanh (<1s), miễn phí — tối ưu cho phân loại môn, flashcard, tóm tắt phản hồi & dự phòng nhẹ.',
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
