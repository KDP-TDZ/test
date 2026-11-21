import { extractJsonStringFromModelOutput } from './groqProvider.js';
import { resolveActiveCloudflareCredentials } from './singleKeyService.js';

export const CF_RESCUE_MODEL_STRONG = 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CF_RESCUE_MODEL_FAST = 'cf:@cf/meta/llama-3.1-8b-instruct-fast';
export const CF_VISION_MODEL = 'cf:@cf/qwen/qwen3.8-27b';
export const CF_VISION_MODELS = [
  '@cf/qwen/qwen3.8-27b',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
] as const;

const CF_FALLBACK_ON_404: Record<string, string> = {
  '@cf/meta/llama-3.1-8b-instruct-fast': '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast': '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/qwen/qwen3.8-27b': '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct': '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct': '@cf/qwen/qwen3.8-27b',
};

export function isCloudflareVisionModelId(modelId: string): boolean {
  const raw = stripCloudflarePrefix(modelId).toLowerCase();
  return (
    raw.includes('vision') ||
    raw.includes('llava') ||
    raw.includes('qwen3.8') ||
    raw.includes('qwen3.6') ||
    raw.includes('mistral-small-3.1') ||
    raw.includes('llama-4-scout') ||
    raw.includes('moondream')
  );
}

export function isCloudflareModelId(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('cf:');
}

export function stripCloudflarePrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.toLowerCase().startsWith('cf:') ? trimmed.slice(3).trim() : trimmed;
}

export function getCloudflareCredentials(): { accountId: string; apiToken: string } {
  return resolveActiveCloudflareCredentials();
}

export function isCloudflareConfigured(): boolean {
  const { accountId, apiToken } = getCloudflareCredentials();
  return accountId.length > 0 && apiToken.length > 0;
}

export function buildCloudflareChatEndpoint(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
}

export interface CloudflareCompletionResult {
  text: string;
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
  resolvedModel?: string;
}

type CloudflareMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type CloudflareMessage = {
  role: 'system' | 'user';
  content: string | CloudflareMessageContentPart[];
};

async function executeCloudflareRequest(params: {
  accountId: string;
  apiToken: string;
  cfModel: string;
  messages: CloudflareMessage[];
  hasImages?: boolean;
  jsonMode?: boolean;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<{ ok: true; result: CloudflareCompletionResult } | { ok: false; status: number; errText: string }> {
  const body: Record<string, unknown> = {
    model: params.cfModel,
    messages: params.messages,
    temperature: 0.15,
    max_tokens: params.maxTokens,
  };

  if (params.jsonMode && !params.hasImages) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(buildCloudflareChatEndpoint(params.accountId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, status: res.status, errText };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    result?: { response?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const rawText = data.choices?.[0]?.message?.content || data.result?.response || '';
  const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();

  return {
    ok: true,
    result: {
      text,
      promptTokens: data.usage?.prompt_tokens || 0,
      candidateTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      resolvedModel: `cf:${params.cfModel}`,
    },
  };
}

export async function callCloudflareChatCompletion(params: {
  modelId: string;
  prompt: string;
  images?: Array<{ mimeType: string; base64: string }>;
  systemInstruction?: string;
  jsonMode?: boolean;
  jsonSchemaHint?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  credentialsOverride?: { accountId: string; apiToken: string };
}): Promise<CloudflareCompletionResult> {
  const activeCreds = params.credentialsOverride || getCloudflareCredentials();
  const accountId = (activeCreds.accountId || '').trim();
  const apiToken = (activeCreds.apiToken || '').trim();
  if (!accountId || !apiToken) {
    throw new Error(
      'CLOUDFLARE_AI_UNCONFIGURED: Chưa cấu hình Cloudflare Account ID / API Token. Quản trị viên có thể thêm trực tiếp trong Quản trị hệ thống → API Key & Bảo mật hoặc biến môi trường.'
    );
  }

  const hasImages = Array.isArray(params.images) && params.images.length > 0;
  const requestedCfModel = stripCloudflarePrefix(params.modelId);
  const cfModel =
    hasImages && !isCloudflareVisionModelId(requestedCfModel)
      ? stripCloudflarePrefix(CF_VISION_MODEL)
      : requestedCfModel;

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

  const messages: CloudflareMessage[] = [];
  if (hasImages) {
    const combinedPrompt =
      systemParts.length > 0 ? `${systemParts.join('\n\n')}\n\n${params.prompt}` : params.prompt;
    const userContent: CloudflareMessageContentPart[] = [
      ...params.images!.map((img) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      })),
      { type: 'text', text: combinedPrompt },
    ];
    messages.push({ role: 'user', content: userContent });
  } else {
    if (systemParts.length > 0) {
      messages.push({ role: 'system', content: systemParts.join('\n\n') });
    }
    messages.push({ role: 'user', content: params.prompt });
  }

  const maxTokens = Math.min(4096, Math.max(128, params.maxOutputTokens || 2048));

  const firstAttempt = await executeCloudflareRequest({
    accountId,
    apiToken,
    cfModel,
    messages,
    hasImages,
    jsonMode: params.jsonMode,
    maxTokens,
    signal: params.signal,
  });

  if (firstAttempt.ok) {
    return firstAttempt.result;
  }

  let lastStatus = firstAttempt.status;
  let lastErrText = firstAttempt.errText;
  const triedCfModels = new Set<string>([cfModel]);

  const fallbackCandidates: string[] = [];
  if (hasImages) {
    for (const v of CF_VISION_MODELS) {
      if (!triedCfModels.has(v)) fallbackCandidates.push(v);
    }
  } else if (CF_FALLBACK_ON_404[cfModel]) {
    fallbackCandidates.push(CF_FALLBACK_ON_404[cfModel]);
  }

  if (
    (firstAttempt.status === 404 ||
      (hasImages &&
        (firstAttempt.status === 400 || firstAttempt.status === 403 || firstAttempt.status === 503))) &&
    fallbackCandidates.length > 0
  ) {
    for (const candidate of fallbackCandidates) {
      if (triedCfModels.has(candidate)) continue;
      triedCfModels.add(candidate);
      const retryAttempt = await executeCloudflareRequest({
        accountId,
        apiToken,
        cfModel: candidate,
        messages,
        hasImages,
        jsonMode: params.jsonMode,
        maxTokens,
        signal: params.signal,
      });
      if (retryAttempt.ok) {
        return retryAttempt.result;
      }
      if (lastStatus === 404 || (retryAttempt.status !== 404 && retryAttempt.status !== 500)) {
        lastStatus = retryAttempt.status;
        lastErrText = retryAttempt.errText;
      }
    }
  }

  if (lastStatus === 429) {
    throw new Error(`429 RESOURCE_EXHAUSTED (Cloudflare Workers AI): ${lastErrText.slice(0, 180)}`);
  }
  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error(
      `PERMISSION_DENIED (Cloudflare ${lastStatus}): Cloudflare Account ID hoặc API Token không có quyền Workers AI Run/Edit. Chi tiết: ${lastErrText.slice(0, 140)}`
    );
  }
  if (lastStatus === 404) {
    throw new Error(
      `NOT_FOUND (Cloudflare 404): Model [${Array.from(triedCfModels).join(', ')}] không khả dụng. Chi tiết: ${lastErrText.slice(0, 180)}`
    );
  }
  if (lastStatus === 503 || lastStatus === 502) {
    throw new Error(`503 UNAVAILABLE (Cloudflare Workers AI): ${lastErrText.slice(0, 180)}`);
  }
  throw new Error(`Cloudflare Workers AI error (HTTP ${lastStatus}): ${lastErrText.slice(0, 200)}`);
}
