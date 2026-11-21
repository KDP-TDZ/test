import crypto from 'node:crypto';
import { resolveActiveGroqApiKey } from './singleKeyService.js';

export const GROQ_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODELS_ENDPOINT = 'https://api.groq.com/openai/v1/models';

export const GROQ_RESCUE_MODEL_STRONG = 'groq:openai/gpt-oss-120b';
export const GROQ_RESCUE_MODEL_FAST = 'groq:openai/gpt-oss-20b';
export const GROQ_VISION_MODEL = 'groq:meta-llama/llama-4-scout-17b-16e-instruct';

export const GROQ_PREFERRED_TEXT_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
] as const;

export const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
] as const;

export function isGroqVisionModelId(modelId: string): boolean {
  const raw = stripGroqPrefix(modelId).toLowerCase();
  return (
    GROQ_VISION_MODELS.some((m) => m.toLowerCase() === raw) ||
    raw.includes('llama-4-scout') ||
    raw.includes('llama-4-maverick') ||
    raw.includes('vision') ||
    raw.includes('llava') ||
    raw.includes('pixtral')
  );
}

const LEGACY_GROQ_MODEL_ALIASES: Record<string, string> = {
  'llama3-70b-8192': 'openai/gpt-oss-120b',
  'llama3-8b-8192': 'openai/gpt-oss-20b',
  'mixtral-8x7b-32768': 'openai/gpt-oss-120b',
  'gemma2-9b-it': 'openai/gpt-oss-20b',
};

const availableModelsCache = new Map<string, { expiresAt: number; models: string[] }>();

export function isGroqModelId(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('groq:');
}

export function stripGroqPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.toLowerCase().startsWith('groq:') ? trimmed.slice(5).trim() : trimmed;
}

/**
 * Normalizes retired/legacy Groq model IDs (e.g. `groq:llama3-70b-8192`)
 * to currently active Groq production models so saved Firestore configs never hit HTTP 404.
 */
export function normalizeGroqModelId(modelId: string): string {
  const trimmed = (modelId || '').trim();
  if (!isGroqModelId(trimmed)) return trimmed;
  const rawName = stripGroqPrefix(trimmed);
  const mapped = LEGACY_GROQ_MODEL_ALIASES[rawName.toLowerCase()];
  return mapped ? `groq:${mapped}` : `groq:${rawName}`;
}

export function getGroqApiKey(): string {
  return resolveActiveGroqApiKey();
}

export function isGroqConfigured(): boolean {
  return getGroqApiKey().length > 0;
}

export function isGroqChatModelId(id: string): boolean {
  const lower = id.trim().toLowerCase();
  if (!lower) return false;
  const excludedTokens = [
    'whisper',
    'tts',
    'playai',
    'guard',
    'safeguard',
    'orpheus',
    'distil-whisper',
    'compound',
  ];
  return !excludedTokens.some((tok) => lower.includes(tok));
}

export async function fetchAvailableGroqChatModels(
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return [];
  const cacheKey = crypto.createHash('sha256').update(cleanKey).digest('hex').slice(0, 16);
  const cached = availableModelsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  try {
    const res = await fetch(GROQ_MODELS_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
      signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string; active?: boolean }> };
    const models = (data.data || [])
      .filter((item) => item && typeof item.id === 'string' && item.active !== false)
      .map((item) => item.id!.trim())
      .filter((id) => isGroqChatModelId(id));

    availableModelsCache.set(cacheKey, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      models,
    });
    return models;
  } catch {
    return [];
  }
}

export function pickBestAvailableGroqModel(
  availableModels: string[],
  excludeModel?: string
): string | null {
  const excludedLower = (excludeModel || '').trim().toLowerCase();
  const candidates = availableModels.filter((m) => m.toLowerCase() !== excludedLower);
  if (candidates.length === 0) return null;

  for (const preferred of GROQ_PREFERRED_TEXT_MODELS) {
    const found = candidates.find((m) => m.toLowerCase() === preferred.toLowerCase());
    if (found) return found;
  }
  return candidates[0];
}

export function extractJsonStringFromModelOutput(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '{}';
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export interface GroqCompletionResult {
  text: string;
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
  resolvedModel?: string;
}

type GroqMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type GroqMessage = {
  role: 'system' | 'user';
  content: string | GroqMessageContentPart[];
};

async function executeGroqRequest(params: {
  apiKey: string;
  groqModel: string;
  messages: GroqMessage[];
  jsonMode?: boolean;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<{ ok: true; result: GroqCompletionResult } | { ok: false; status: number; errText: string }> {
  const sendOnce = async (useResponseFormatJson: boolean) => {
    const body: Record<string, unknown> = {
      model: params.groqModel,
      messages: params.messages,
      temperature: 0.15,
      max_tokens: params.maxTokens,
    };

    if (useResponseFormatJson) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(GROQ_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false as const, status: res.status, errText };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const msg = data.choices?.[0]?.message;
    const rawText = msg?.content || msg?.reasoning || '';
    const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();

    return {
      ok: true as const,
      result: {
        text,
        promptTokens: data.usage?.prompt_tokens || 0,
        candidateTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        resolvedModel: `groq:${params.groqModel}`,
      },
    };
  };

  const primary = await sendOnce(Boolean(params.jsonMode));
  // Some Groq models (reasoning/vision or strict JSON validator) return HTTP 400 when response_format=json_object is set;
  // retry without response_format and extract JSON from the text output.
  if (!primary.ok && primary.status === 400 && params.jsonMode) {
    const withoutJsonFormat = await sendOnce(false);
    if (withoutJsonFormat.ok) {
      return withoutJsonFormat;
    }
  }
  return primary;
}

export async function callGroqChatCompletion(params: {
  modelId: string;
  prompt: string;
  images?: Array<{ mimeType: string; base64: string }>;
  systemInstruction?: string;
  jsonMode?: boolean;
  jsonSchemaHint?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  apiKeyOverride?: string;
  disableModelAutoFallback?: boolean;
}): Promise<GroqCompletionResult> {
  const apiKey = (params.apiKeyOverride || '').trim() || getGroqApiKey();
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY_UNCONFIGURED: Chưa cấu hình Groq API Key. Quản trị viên có thể thêm trực tiếp trong Quản trị hệ thống → API Key & Bảo mật hoặc biến môi trường GROQ_API_KEY.'
    );
  }

  const hasImages = Array.isArray(params.images) && params.images.length > 0;
  const normalizedModelId = normalizeGroqModelId(params.modelId);
  const requestedGroqModel = stripGroqPrefix(normalizedModelId);
  const groqModel =
    hasImages && !isGroqVisionModelId(requestedGroqModel)
      ? stripGroqPrefix(GROQ_VISION_MODEL)
      : requestedGroqModel;

  const systemParts: string[] = [];
  if (params.systemInstruction) {
    systemParts.push(params.systemInstruction.trim());
  }
  if (params.jsonMode) {
    systemParts.push(
      'BẮT BUỘC trả về duy nhất 1 JSON object hợp lệ (không thêm markdown, không thêm giải thích ngoài JSON).'
    );
    if (params.jsonSchemaHint) {
      systemParts.push(`Cấu trúc JSON bắt buộc:\n${params.jsonSchemaHint}`);
    }
  }

  const messages: GroqMessage[] = [];
  if (systemParts.length > 0) {
    messages.push({ role: 'system', content: systemParts.join('\n\n') });
  }
  if (hasImages) {
    const userContent: GroqMessageContentPart[] = [
      ...params.images!.map((img) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      })),
      { type: 'text', text: params.prompt },
    ];
    messages.push({ role: 'user', content: userContent });
  } else {
    messages.push({ role: 'user', content: params.prompt });
  }

  // Reasoning-capable models (e.g. openai/gpt-oss-*) need at least 256 tokens so final content isn't truncated
  const maxTokens = Math.min(8192, Math.max(256, params.maxOutputTokens || 2048));

  const firstAttempt = await executeGroqRequest({
    apiKey,
    groqModel,
    messages,
    jsonMode: params.jsonMode,
    maxTokens,
    signal: params.signal,
  });

  if (firstAttempt.ok) {
    return firstAttempt.result;
  }

  let lastStatus = firstAttempt.status;
  let lastErrText = firstAttempt.errText;

  // If Groq reports HTTP 404 or 400 (model not enabled on this org or unsupported parameter), discover active models and try multiple candidates
  if ((firstAttempt.status === 404 || firstAttempt.status === 400) && !params.disableModelAutoFallback) {
    const availableModels = await fetchAvailableGroqChatModels(apiKey, params.signal);
    const tried = new Set<string>([groqModel.toLowerCase()]);
    const candidatePool: string[] = [];

    if (hasImages) {
      for (const m of availableModels) {
        if (isGroqVisionModelId(m)) candidatePool.push(m);
      }
      for (const v of GROQ_VISION_MODELS) {
        candidatePool.push(v);
      }
    } else {
      for (const pref of GROQ_PREFERRED_TEXT_MODELS) {
        const match = availableModels.find((m) => m.toLowerCase() === pref.toLowerCase());
        if (match) candidatePool.push(match);
      }
      for (const m of availableModels) {
        candidatePool.push(m);
      }
      for (const pref of GROQ_PREFERRED_TEXT_MODELS) {
        candidatePool.push(pref);
      }
    }

    let attempts = 0;
    for (const candidate of candidatePool) {
      const lower = candidate.trim().toLowerCase();
      if (!lower || tried.has(lower)) continue;
      tried.add(lower);
      attempts += 1;
      if (attempts > 4) break;

      const retryAttempt = await executeGroqRequest({
        apiKey,
        groqModel: candidate.trim(),
        messages,
        jsonMode: params.jsonMode,
        maxTokens,
        signal: params.signal,
      });
      if (retryAttempt.ok) {
        return retryAttempt.result;
      }
      lastStatus = retryAttempt.status;
      lastErrText = retryAttempt.errText;
    }
  }

  const status = lastStatus;
  const errText = lastErrText;
  if (status === 429) {
    throw new Error(`429 RESOURCE_EXHAUSTED (Groq): ${errText.slice(0, 180)}`);
  }
  if (status === 401 || status === 403) {
    throw new Error(`PERMISSION_DENIED (Groq ${status}): Groq API Key không hợp lệ hoặc đã bị thu hồi.`);
  }
  if (status === 404) {
    const availableModels = await fetchAvailableGroqChatModels(apiKey, params.signal);
    const sampleHint =
      availableModels.length > 0
        ? ` Các model khả dụng trên tài khoản Groq của bạn: ${availableModels.slice(0, 4).join(', ')}.`
        : ' Vui lòng kiểm tra mục Model Access trên Groq Console.';
    throw new Error(`NOT_FOUND (Groq 404): Model "${groqModel}" không khả dụng trên tài khoản Groq này.${sampleHint}`);
  }
  if (status === 503 || status === 502) {
    throw new Error(`503 UNAVAILABLE (Groq): ${errText.slice(0, 180)}`);
  }
  throw new Error(`Groq API error (HTTP ${status}): ${errText.slice(0, 200)}`);
}
