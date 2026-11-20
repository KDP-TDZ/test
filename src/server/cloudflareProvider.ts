import { extractJsonStringFromModelOutput } from './groqProvider.js';

export const CF_RESCUE_MODEL_STRONG = 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CF_RESCUE_MODEL_FAST = 'cf:@cf/meta/llama-3.1-8b-instruct-fast';

export function isCloudflareModelId(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('cf:');
}

export function stripCloudflarePrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.toLowerCase().startsWith('cf:') ? trimmed.slice(3).trim() : trimmed;
}

export function getCloudflareCredentials(): { accountId: string; apiToken: string } {
  return {
    accountId: (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    apiToken: (process.env.CLOUDFLARE_API_TOKEN || '').trim(),
  };
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
}

export async function callCloudflareChatCompletion(params: {
  modelId: string;
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  jsonSchemaHint?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<CloudflareCompletionResult> {
  const { accountId, apiToken } = getCloudflareCredentials();
  if (!accountId || !apiToken) {
    throw new Error(
      'CLOUDFLARE_AI_UNCONFIGURED: Biến môi trường CLOUDFLARE_ACCOUNT_ID hoặc CLOUDFLARE_API_TOKEN chưa được thiết lập trên máy chủ.'
    );
  }

  const cfModel = stripCloudflarePrefix(params.modelId);
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

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (systemParts.length > 0) {
    messages.push({ role: 'system', content: systemParts.join('\n\n') });
  }
  messages.push({ role: 'user', content: params.prompt });

  const body: Record<string, unknown> = {
    model: cfModel,
    messages,
    temperature: 0.15,
    max_tokens: Math.min(4096, Math.max(128, params.maxOutputTokens || 2048)),
  };

  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(buildCloudflareChatEndpoint(accountId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new Error(`429 RESOURCE_EXHAUSTED (Cloudflare Workers AI): ${errText.slice(0, 180)}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `PERMISSION_DENIED (Cloudflare ${res.status}): CLOUDFLARE_ACCOUNT_ID hoặc CLOUDFLARE_API_TOKEN không hợp lệ.`
      );
    }
    if (res.status === 503 || res.status === 502) {
      throw new Error(`503 UNAVAILABLE (Cloudflare Workers AI): ${errText.slice(0, 180)}`);
    }
    throw new Error(`Cloudflare Workers AI error (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    result?: { response?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const rawText = data.choices?.[0]?.message?.content || data.result?.response || '';
  const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();

  return {
    text,
    promptTokens: data.usage?.prompt_tokens || 0,
    candidateTokens: data.usage?.completion_tokens || 0,
    totalTokens: data.usage?.total_tokens || 0,
  };
}
