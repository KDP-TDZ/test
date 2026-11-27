import type { AiProviderId, AiTaskType, TaskModelConfig } from '../core/types.js';

export interface ModelCatalogItem {
  modelId: string;
  displayName: string;
  provider: AiProviderId;
  tier: 'free';
  strengths: string;
  supportsMultimodal: boolean;
  supportsGoogleSearch: boolean;
}

export const MODEL_CATALOG: ModelCatalogItem[] = [
  {
    modelId: 'mistral:mistral-small-latest',
    displayName: 'Mistral AI · Mistral Small Latest (Ưu tiên #1 · Chấm chính Free)',
    provider: 'mistral',
    tier: 'free',
    strengths:
      'Ưu tiên số 1 cho chấm điểm, kiểm định kiến thức, sinh đề & hỗ trợ Vision OCR dự phòng trên Mistral Free Tier.',
    supportsMultimodal: true,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'mistral:ministral-8b-latest',
    displayName: 'Mistral AI · Ministral 8B Fast (Đối soát & Tác vụ nhanh Free)',
    provider: 'mistral',
    tier: 'free',
    strengths:
      'Tốc độ cao, chi phí thấp — tối ưu cho kiểm tra chéo (Verify), phân loại môn học & tạo flashcard.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:qwen/qwen3.8-27b',
    displayName: 'Groq · Qwen 3.8 27B Vision (Ưu tiên #1 OCR & Đối soát Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Đa phương thức siêu nhanh (~450 tok/s, miễn phí) — quét ảnh chụp vở/bài làm Bước 1 và chạy nhánh đối soát độc lập.',
    supportsMultimodal: true,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:openai/gpt-oss-120b',
    displayName: 'Groq · GPT-OSS 120B (Dự phòng suy luận siêu nhanh Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Tốc độ ~500 tok/s, miễn phí — tầng dự phòng mạnh cho chấm điểm, tổng hợp SGK & tạo đề trắc nghiệm.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'groq:openai/gpt-oss-20b',
    displayName: 'Groq · GPT-OSS 20B Fast (Đối soát chéo ~1.000 tok/s Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Siêu nhanh (~1.000 tok/s), miễn phí — ưu tiên cho bước Đối soát (Verify) chéo nhà cung cấp & tác vụ nhẹ.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    displayName: 'Cloudflare · Llama 3.3 70B FP8 Fast (Chấm song song Phần 2 Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Miễn phí (10.000 Neurons/ngày trên Cloudflare Edge) — chạy song song Phần 2 khi văn bản dài & làm tầng dự phòng độc lập.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'cf:@cf/qwen/qwen3.8-27b',
    displayName: 'Cloudflare · Qwen 3.8 27B Vision (Quét tinh chỉnh Bước 2 Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Đa phương thức trên Cloudflare Edge — chạy Quét tinh chỉnh (Scan Pass 2) cho tài liệu dài & dự phòng Vision OCR.',
    supportsMultimodal: true,
    supportsGoogleSearch: false,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.1-8b-instruct-fast',
    displayName: 'Cloudflare · Llama 3.1 8B Fast (Đối soát dự phòng tiết kiệm Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Miễn phí, tiêu tốn cực ít Neuron trên Cloudflare Edge — đối soát dự phòng, phân loại môn & flashcard.',
    supportsMultimodal: false,
    supportsGoogleSearch: false,
  },
];

export const UNIFIED_PRIMARY_MODEL = 'mistral:mistral-small-latest';
export const UNIFIED_FALLBACK_MODEL = 'groq:openai/gpt-oss-120b';

export const DEFAULT_TASK_MODELS: Record<AiTaskType, TaskModelConfig> = {
  subject_classification: {
    defaultModel: 'groq:openai/gpt-oss-20b',
    fallbackModel: 'mistral:ministral-8b-latest',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  curriculum_extraction: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  knowledge_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  completeness_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  claim_validation: {
    defaultModel: 'groq:openai/gpt-oss-20b',
    fallbackModel: 'cf:@cf/meta/llama-3.1-8b-instruct-fast',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  quiz_blueprint: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  quiz_generation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  quiz_validation: {
    defaultModel: 'groq:openai/gpt-oss-20b',
    fallbackModel: 'mistral:ministral-8b-latest',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  answer_explanation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  flashcard_generation: {
    defaultModel: 'mistral:ministral-8b-latest',
    fallbackModel: 'groq:openai/gpt-oss-20b',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
  feedback_analysis: {
    defaultModel: 'mistral:ministral-8b-latest',
    fallbackModel: 'groq:openai/gpt-oss-20b',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v4.2_3provider',
  },
};
