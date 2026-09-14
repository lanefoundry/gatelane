/**
 * LLMCaller — abstraction over LLM / agent invocation.
 *
 * gatelane's replay engine runs dataset items against candidates via this
 * interface. Implementations:
 *   - MockLLMCaller — deterministic, used by tests + local dev
 *   - OpenAIChatCaller — OpenAI-compatible chat completions (also groq, openrouter, cloudflare)
 *   - AnthropicCaller — Anthropic messages API
 *   - GoogleCaller — Google Gemini generateContent API
 *
 * The replay engine doesn't care which one is plugged in; the gate runner
 * picks the right caller per candidate (model candidates hit the API,
 * skill / config / dispatch / guardrail candidates wrap an existing
 * caller with their pre/post hooks).
 *
 * @see docs/prd.md §5.1 — The gate
 */

import type { CapturedCall } from '@lanefoundry/gatelane-sdk/capture';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LLMRequest = {
  /** Candidate ref being evaluated. Used for routing + logging. */
  readonly candidate_ref: string;
  /** Model identifier, e.g. "gpt-4o", "claude-sonnet-4.5", "model:looplane-v3". */
  readonly model: string;
  /** Conversation messages. Empty for non-chat candidates. */
  readonly messages: ReadonlyArray<ChatMessage>;
  /** Free-form metadata passed to the provider (trace ids, dataset version, etc.). */
  readonly metadata?: Record<string, unknown>;
  /** Seed for determinism. Same seed → same output. */
  readonly seed?: number;
  /** Sampling params. */
  readonly temperature?: number;
  readonly max_tokens?: number;
};

export type LLMResponse = {
  /** Raw text content from the model. */
  readonly content: string;
  /** Cost in USD (0 if unknown). */
  readonly cost_usd: number;
  /** Latency in ms. */
  readonly latency_ms: number;
  /** Tokens in / out if reported by provider. */
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  /** Why the call stopped. */
  readonly finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  /** Provider-specific raw response, kept opaque. */
  readonly raw?: unknown;
  /** Convert to a CapturedCall for storage. */
  toCapturedCall(args: { id: string; started_at: string; completed_at: string; span_kind?: string }): CapturedCall;
};

export interface LLMCaller {
  /** Returns provider name (used in GateReport.candidate_shas metadata). */
  readonly provider: string;
  /** Make one LLM call. Must not throw on 4xx; return a finish_reason=error response instead. */
  call(request: LLMRequest): Promise<LLMResponse>;
}

/** Deterministic Mock for tests + local dev. Echoes input with seed offset. */
export class MockLLMCaller implements LLMCaller {
  readonly provider: string;
  /** Per-model quality score: 0.0–1.0. Multiplied into the response so tests can
   * simulate "model A is better than model B". */
  readonly quality: number;

  constructor(opts: { provider?: string; quality?: number } = {}) {
    this.provider = opts.provider ?? 'mock';
    this.quality = opts.quality ?? 0.8;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const start = performance.now();
    const seed = request.seed ?? 0;
    const qualityJitter = ((seed % 7) / 10) - 0.3; // [-0.3, 0.4]
    const content = JSON.stringify({
      candidate: request.candidate_ref,
      model: request.model,
      seed,
      quality: this.quality + qualityJitter,
      messages_count: request.messages.length,
      echo: request.messages.at(-1)?.content ?? '',
    });
    return {
      content,
      cost_usd: 0.001 * (request.messages.length || 1),
      latency_ms: performance.now() - start,
      tokens_in: request.messages.reduce((n, m) => n + m.content.length, 0),
      tokens_out: content.length,
      finish_reason: 'stop',
      raw: { mocked: true, quality: this.quality },
      toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
        id,
        input: {
          prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
          model: request.model,
          metadata: request.metadata,
        },
        output: { content },
        started_at,
        completed_at,
        cost_usd: 0.001 * (request.messages.length || 1),
        latency_ms: performance.now() - start,
        ...(span_kind !== undefined ? { span_kind } : {}),
      }),
    };
  }
}

/** Compose N messages into a single prompt string for non-chat candidates. */
export function messagesToPrompt(messages: ReadonlyArray<ChatMessage>): string {
  return messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
}

/** Pricing maps for cost estimation (USD per 1M tokens). */
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
};

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku': { input: 0.25, output: 1.25 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
};

const GOOGLE_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

const GROQ_PRICING: Record<string, { input: number; output: number }> = {
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
};

/** All pricing maps keyed by provider for makeCaller to pass to OpenAIChatCaller. */
export const PROVIDER_PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  openai: OPENAI_PRICING,
  anthropic: ANTHROPIC_PRICING,
  google: GOOGLE_PRICING,
  groq: GROQ_PRICING,
  openrouter: { ...OPENAI_PRICING, ...ANTHROPIC_PRICING, ...GOOGLE_PRICING, ...GROQ_PRICING },
  cloudflare: {},
};

function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  pricing: Record<string, { input: number; output: number }>
): number {
  const baseModel = model.split(':')[0] ?? model;
  const pricingEntry = pricing[model] ?? pricing[baseModel];
  if (!pricingEntry) {
    return 0;
  }
  return (tokensIn / 1_000_000) * pricingEntry.input + (tokensOut / 1_000_000) * pricingEntry.output;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type NormalizedResponse = {
  choices: Array<{ message: { content: string; role: string }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

/**
 * Normalize various response shapes to the OpenAI Chat Completions format.
 *
 * Handles:
 * - Standard OpenAI: { choices: [...] }
 * - CF wrapped:      { success: true, result: { choices: [...] } }
 * - CF legacy:       { result: { response: "text" } }
 * - CF legacy alt:   { result: "text" }
 */
function normalizeOpenAIResponse(raw: Record<string, unknown>): NormalizedResponse {
  // Standard OpenAI format — choices at top level
  if (Array.isArray(raw.choices) && raw.choices.length > 0) {
    return raw as unknown as NormalizedResponse;
  }

  // Cloudflare wrapped — { success, result: { choices: [...] } } or { result: { response } }
  const result = raw.result as Record<string, unknown> | string | undefined;
  if (result !== undefined) {
    // result is a string — legacy CF format
    if (typeof result === 'string') {
      return { choices: [{ message: { content: result, role: 'assistant' }, finish_reason: 'stop' }] };
    }

    // result has choices — CF-wrapped OpenAI format
    if (typeof result === 'object' && result !== null && Array.isArray(result.choices)) {
      return result as unknown as NormalizedResponse;
    }

    // result.response is a string — legacy CF REST format
    if (typeof result === 'object' && result !== null && typeof result.response === 'string') {
      return { choices: [{ message: { content: result.response, role: 'assistant' }, finish_reason: 'stop' }] };
    }
  }

  // Unknown format — return empty so content falls through to ''
  return { choices: [] };
}

/**
 * OpenAI Chat Completions API caller.
 * Also used for OpenAI-compatible providers (groq, openrouter, cloudflare workers ai, opencode).
 */
export class OpenAIChatCaller implements LLMCaller {
  readonly provider: string;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly defaultModel: string;
  private readonly timeout: number;
  private readonly pricing: Record<string, { input: number; output: number }>;

  constructor(opts: {
    apiKey: string;
    baseURL?: string;
    defaultModel?: string;
    timeout?: number;
    provider?: string;
    pricing?: Record<string, { input: number; output: number }>;
  }) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL ?? 'https://api.openai.com';
    this.defaultModel = opts.defaultModel ?? 'gpt-4o-mini';
    this.timeout = opts.timeout ?? 60_000;
    this.provider = opts.provider ?? 'openai';
    this.pricing = opts.pricing ?? OPENAI_PRICING;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const start = performance.now();
    const model = request.model || this.defaultModel;

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.max_tokens ?? 4096,
    };

    if (request.seed !== undefined) {
      body.seed = request.seed;
    }

    if (systemMessage) {
      body.messages = [{ role: 'system', content: systemMessage.content }, ...messages];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const latency_ms = performance.now() - start;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        content: '',
        cost_usd: 0,
        latency_ms,
        finish_reason: 'error',
        raw: { status: response.status, error: errorText },
        toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
          id,
          input: {
            prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
            model,
            metadata: request.metadata,
          },
          output: { error: errorText },
          started_at,
          completed_at,
          cost_usd: 0,
          latency_ms,
          ...(span_kind !== undefined ? { span_kind } : {}),
        }),
      };
    }

    const rawJson = (await response.json()) as Record<string, unknown>;

    // Normalize response: Cloudflare Workers AI REST API may wrap the
    // OpenAI-compatible response inside { success, result: { ... } },
    // or return the legacy format { result: { response: "text" } }.
    const data = normalizeOpenAIResponse(rawJson);

    const choice = data.choices[0];
    // Cast to Record to access reasoning_content/reasoning (not in NormalizedResponse type)
    const msg = choice?.message as Record<string, unknown> | undefined;
    const content =
      (msg?.content as string) ||
      (msg?.reasoning_content as string) ||
      (msg?.reasoning as string) ||
      '';
    const tokens_in = data.usage?.prompt_tokens ?? approxTokens(request.messages.map((m) => m.content).join(''));
    const tokens_out = data.usage?.completion_tokens ?? approxTokens(content);
    const cost_usd = estimateCost(model, tokens_in, tokens_out, this.pricing);
    const finish_reason = choice?.finish_reason ?? 'stop';

    return {
      content,
      cost_usd,
      latency_ms,
      tokens_in,
      tokens_out,
      finish_reason: finish_reason as LLMResponse['finish_reason'],
      raw: rawJson,
      toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
        id,
        input: {
          prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
          model,
          metadata: request.metadata,
        },
        output: { content },
        started_at,
        completed_at,
        cost_usd,
        latency_ms,
        ...(span_kind !== undefined ? { span_kind } : {}),
      }),
    };
  }
}

/**
 * Anthropic Messages API caller.
 */
export class AnthropicCaller implements LLMCaller {
  readonly provider = 'anthropic';
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly defaultModel: string;
  private readonly timeout: number;

  constructor(opts: {
    apiKey: string;
    baseURL?: string;
    defaultModel?: string;
    timeout?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL ?? 'https://api.anthropic.com';
    this.defaultModel = opts.defaultModel ?? 'claude-3-5-haiku';
    this.timeout = opts.timeout ?? 60_000;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const start = performance.now();
    const model = request.model || this.defaultModel;

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const temperature = request.seed !== undefined ? 0 : (request.temperature ?? 0);

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: request.max_tokens ?? 4096,
      temperature,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const latency_ms = performance.now() - start;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        content: '',
        cost_usd: 0,
        latency_ms,
        finish_reason: 'error',
        raw: { status: response.status, error: errorText },
        toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
          id,
          input: {
            prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
            model,
            metadata: request.metadata,
          },
          output: { error: errorText },
          started_at,
          completed_at,
          cost_usd: 0,
          latency_ms,
          ...(span_kind !== undefined ? { span_kind } : {}),
        }),
      };
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason: string | null;
    };

    const content = data.content?.map((c) => c.text).join('') ?? '';
    const tokens_in = data.usage?.input_tokens ?? approxTokens(request.messages.map((m) => m.content).join(''));
    const tokens_out = data.usage?.output_tokens ?? approxTokens(content);
    const cost_usd = estimateCost(model, tokens_in, tokens_out, ANTHROPIC_PRICING);
    const finish_reason = data.stop_reason ?? 'stop';

    return {
      content,
      cost_usd,
      latency_ms,
      tokens_in,
      tokens_out,
      finish_reason: finish_reason as LLMResponse['finish_reason'],
      raw: data,
      toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
        id,
        input: {
          prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
          model,
          metadata: request.metadata,
        },
        output: { content },
        started_at,
        completed_at,
        cost_usd,
        latency_ms,
        ...(span_kind !== undefined ? { span_kind } : {}),
      }),
    };
  }
}

/**
 * Google Gemini API caller.
 * Uses the generateContent REST endpoint (not OpenAI-compatible).
 */
export class GoogleCaller implements LLMCaller {
  readonly provider = 'google';
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly timeout: number;

  constructor(opts: {
    apiKey: string;
    defaultModel?: string;
    timeout?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.defaultModel ?? 'gemini-2.5-flash';
    this.timeout = opts.timeout ?? 60_000;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const start = performance.now();
    const model = request.model || this.defaultModel;

    const systemMessage = request.messages.find((m) => m.role === 'system');
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0,
        maxOutputTokens: request.max_tokens ?? 4096,
      },
    };

    if (systemMessage) {
      body.systemInstruction = { parts: [{ text: systemMessage.content }] };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latency_ms = performance.now() - start;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        content: '',
        cost_usd: 0,
        latency_ms,
        finish_reason: 'error',
        raw: { status: response.status, error: errorText },
        toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
          id,
          input: {
            prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
            model,
            metadata: request.metadata,
          },
          output: { error: errorText },
          started_at,
          completed_at,
          cost_usd: 0,
          latency_ms,
          ...(span_kind !== undefined ? { span_kind } : {}),
        }),
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: { parts: Array<{ text: string }>; role: string };
        finishReason: string;
      }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    const tokens_in = data.usageMetadata?.promptTokenCount ?? approxTokens(request.messages.map((m) => m.content).join(''));
    const tokens_out = data.usageMetadata?.candidatesTokenCount ?? approxTokens(content);
    const cost_usd = estimateCost(model, tokens_in, tokens_out, GOOGLE_PRICING);
    const geminiFinish = data.candidates?.[0]?.finishReason ?? 'STOP';
    const finish_reason = geminiFinish === 'MAX_TOKENS' ? 'length' : 'stop';

    return {
      content,
      cost_usd,
      latency_ms,
      tokens_in,
      tokens_out,
      finish_reason: finish_reason as LLMResponse['finish_reason'],
      raw: data,
      toCapturedCall: ({ id, started_at, completed_at, span_kind }) => ({
        id,
        input: {
          prompt: request.messages.map((m) => ({ role: m.role, content: m.content })),
          model,
          metadata: request.metadata,
        },
        output: { content },
        started_at,
        completed_at,
        cost_usd,
        latency_ms,
        ...(span_kind !== undefined ? { span_kind } : {}),
      }),
    };
  }
}

/** Known providers and their env var / base URL defaults. */
export const PROVIDER_REGISTRY: Record<string, {
  envKey: string;
  envBaseURL?: string;
  baseURL: string;
  defaultModel: string;
  keyOptional?: boolean;
}> = {
  openai: {
    envKey: 'OPENAI_API_KEY',
    envBaseURL: 'OPENAI_BASE_URL',
    baseURL: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    envBaseURL: 'ANTHROPIC_BASE_URL',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-haiku',
  },
  google: {
    envKey: 'GOOGLE_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
  },
  groq: {
    envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.1-70b-versatile',
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    baseURL: 'https://openrouter.ai/api',
    defaultModel: 'openai/gpt-4o-mini',
  },
  cloudflare: {
    envKey: 'CLOUDFLARE_API_TOKEN',
    baseURL: '',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
  },
  opencode: {
    envKey: 'OPENCODE_API_KEY',
    baseURL: 'https://opencode.ai/zen/v1',
    defaultModel: 'deepseek-v4-flash',
  },
  ollama: {
    envKey: 'OLLAMA_API_KEY',
    envBaseURL: 'OLLAMA_BASE_URL',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    keyOptional: true,
  },
};

/**
 * Parse a "provider:model" candidate ref into { provider, model }.
 * Falls back to the given defaultProvider if no colon prefix.
 */
export function parseProviderModel(
  candidateRef: string,
  defaultProvider: string,
): { provider: string; model: string } {
  const colonIdx = candidateRef.indexOf(':');
  if (colonIdx === -1) {
    return { provider: defaultProvider, model: candidateRef };
  }
  const prefix = candidateRef.slice(0, colonIdx);
  if (prefix in PROVIDER_REGISTRY || prefix === 'mock') {
    return { provider: prefix, model: candidateRef.slice(colonIdx + 1) };
  }
  return { provider: defaultProvider, model: candidateRef };
}
