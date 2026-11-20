export const GROQ_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export const GROQ_RESCUE_MODEL_STRONG = 'groq:llama-3.3-70b-versatile';
export const GROQ_RESCUE_MODEL_FAST = 'groq:llama-3.1-8b-instant';

export function isGroqModelId(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('groq:');
}

export function stripGroqPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.toLowerCase().startsWith('groq:') ? trimmed.slice(5).trim() : trimmed;
}

export function getGroqApiKey(): string {
  return (process.env.GROQ_API_KEY || '').trim();
}

export function isGroqConfigured(): boolean {
  return getGroqApiKey().length > 0;
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
}

export async function callGroqChatCompletion(params: {
  modelId: string;
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  jsonSchemaHint?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<GroqCompletionResult> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY_UNCONFIGURED: Biến môi trường GROQ_API_KEY chưa được thiết lập trên máy chủ.'
    );
  }

  const groqModel = stripGroqPrefix(params.modelId);
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
    model: groqModel,
    messages,
    temperature: 0.15,
    max_tokens: Math.min(8192, Math.max(128, params.maxOutputTokens || 2048)),
  };

  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(GROQ_API_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new Error(`429 RESOURCE_EXHAUSTED (Groq): ${errText.slice(0, 180)}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`PERMISSION_DENIED (Groq ${res.status}): Khóa GROQ_API_KEY không hợp lệ.`);
    }
    if (res.status === 503 || res.status === 502) {
      throw new Error(`503 UNAVAILABLE (Groq): ${errText.slice(0, 180)}`);
    }
    throw new Error(`Groq API error (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const rawText = data.choices?.[0]?.message?.content || '';
  const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();

  return {
    text,
    promptTokens: data.usage?.prompt_tokens || 0,
    candidateTokens: data.usage?.completion_tokens || 0,
    totalTokens: data.usage?.total_tokens || 0,
  };
}
