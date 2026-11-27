import { getActiveMistralApiKeySync } from './singleKeyService.js';
import { extractJsonStringFromModelOutput } from './groqProvider.js';

export const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

export const MISTRAL_PRIMARY_MODEL = 'mistral:mistral-small-latest';
export const MISTRAL_FAST_MODEL = 'mistral:ministral-8b-latest';
export const MISTRAL_FALLBACK_MODEL = 'mistral:ministral-14b-latest';
export const MISTRAL_VISION_MODEL = 'mistral:mistral-small-latest';

export interface MistralImageInput {
  mimeType: string;
  base64Data?: string;
  base64?: string;
}

export interface MistralCallParams {
  modelId: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  jsonSchemaHint?: string;
  strictModelLock?: boolean;
  seed?: number;
  images?: MistralImageInput[];
  signal?: AbortSignal;
  apiKeyOverride?: string;
}

export interface MistralCallResult {
  text: string;
  modelUsed: string;
  resolvedModel: string;
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
  systemFingerprint?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export function isMistralModelId(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const clean = modelId.trim().toLowerCase();
  return (
    clean.startsWith('mistral:') ||
    clean.startsWith('mistral-') ||
    clean.startsWith('ministral-') ||
    clean.startsWith('pixtral-')
  );
}

export function stripMistralPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.toLowerCase().startsWith('mistral:')) {
    return trimmed.slice('mistral:'.length).trim();
  }
  return trimmed;
}

export function normalizeMistralModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return MISTRAL_PRIMARY_MODEL;
  if (trimmed.toLowerCase().startsWith('mistral:')) return trimmed;
  if (isMistralModelId(trimmed)) return `mistral:${trimmed}`;
  return trimmed;
}

export function getMistralApiKey(): string | null {
  const resolved = getActiveMistralApiKeySync();
  if (resolved) return resolved;
  const raw = process.env.MISTRAL_API_KEY?.trim();
  if (!raw || raw === 'YOUR_MISTRAL_API_KEY') return null;
  return raw;
}

export function isMistralConfigured(): boolean {
  return Boolean(getMistralApiKey());
}

export function buildMistralFallbackModels(requestedModel: string): string[] {
  const clean = stripMistralPrefix(requestedModel);
  const candidates = [
    clean,
    stripMistralPrefix(MISTRAL_PRIMARY_MODEL),
    stripMistralPrefix(MISTRAL_FAST_MODEL),
    stripMistralPrefix(MISTRAL_FALLBACK_MODEL),
  ];
  return Array.from(new Set(candidates.filter(Boolean)));
}

function buildUserContent(
  prompt: string,
  images?: MistralImageInput[]
): string | Array<Record<string, unknown>> {
  if (!images || images.length === 0) return prompt;
  const parts: Array<Record<string, unknown>> = [];
  for (const img of images) {
    const rawB64 = img.base64Data ?? img.base64 ?? '';
    const cleanBase64 = rawB64.replace(/^data:[^;]+;base64,/, '');
    if (!cleanBase64) continue;
    const mime = img.mimeType || 'image/jpeg';
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${mime};base64,${cleanBase64}`,
      },
    });
  }
  parts.push({ type: 'text', text: prompt });
  return parts;
}

export async function callMistralChatCompletion(
  params: MistralCallParams
): Promise<MistralCallResult> {
  const apiKey = params.apiKeyOverride?.trim() || getMistralApiKey();
  if (!apiKey) {
    throw new Error(
      'MISTRAL_API_KEY_UNCONFIGURED: Máy chủ chưa cấu hình MISTRAL_API_KEY.'
    );
  }

  const mistralModel = stripMistralPrefix(params.modelId || MISTRAL_PRIMARY_MODEL);
  const messages: Array<{ role: 'system' | 'user'; content: string | Array<Record<string, unknown>> }> = [];

  if (params.systemInstruction && params.systemInstruction.trim()) {
    messages.push({ role: 'system', content: params.systemInstruction.trim() });
  }
  const effectivePrompt =
    params.jsonMode && params.jsonSchemaHint
      ? `${params.prompt}\n\n[ĐỊNH DẠNG JSON BẮT BUỘC — chỉ trả về JSON hợp lệ, không kèm văn bản thừa]:\n${params.jsonSchemaHint}`
      : params.prompt;
  messages.push({
    role: 'user',
    content: buildUserContent(effectivePrompt, params.images),
  });

  const baseBody: Record<string, unknown> = {
    model: mistralModel,
    messages,
    temperature: params.temperature ?? 0,
    max_tokens: params.maxOutputTokens ?? 4096,
  };

  if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
    baseBody.random_seed = Math.max(0, Math.floor(Math.abs(params.seed)));
  }
  if (params.jsonMode) {
    baseBody.response_format = { type: 'json_object' };
  }

  const doFetch = async (body: Record<string, unknown>) =>
    fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

  let res = await doFetch(baseBody);

  // If json_object format is rejected with HTTP 400 (e.g., certain multimodal requests), retry cleanly without response_format
  if (res.status === 400 && baseBody.response_format) {
    const fallbackBody = { ...baseBody };
    delete fallbackBody.response_format;
    res = await doFetch(fallbackBody);
  }

  const rawText = await res.text();
  if (!res.ok) {
    let errDetail = rawText.slice(0, 320);
    try {
      const parsed = JSON.parse(rawText);
      errDetail = parsed?.message || parsed?.error?.message || parsed?.detail || errDetail;
    } catch {
      // keep raw snippet
    }
    if (res.status === 429) {
      throw new Error(`Mistral 429 RESOURCE_EXHAUSTED (${mistralModel}): ${errDetail}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Mistral ${res.status} API_KEY_INVALID (${mistralModel}): ${errDetail}`);
    }
    throw new Error(`Mistral HTTP ${res.status} (${mistralModel}): ${errDetail}`);
  }

  const data = JSON.parse(rawText) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const rawContent = data?.choices?.[0]?.message?.content;
  let content = '';
  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content = rawContent
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  if (!content.trim()) {
    throw new Error(`Mistral (${mistralModel}) trả về phản hồi rỗng.`);
  }

  const finalText = params.jsonMode ? extractJsonStringFromModelOutput(content) : content.trim();
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const candidateTokens = data.usage?.completion_tokens ?? 0;
  const totalTokens = data.usage?.total_tokens ?? promptTokens + candidateTokens;
  const resolvedModel = `mistral:${data.model || mistralModel}`;

  return {
    text: finalText,
    modelUsed: resolvedModel,
    resolvedModel,
    promptTokens,
    candidateTokens,
    totalTokens,
    usageMetadata: data.usage
      ? {
          promptTokenCount: promptTokens,
          candidatesTokenCount: candidateTokens,
          totalTokenCount: totalTokens,
        }
      : undefined,
  };
}
