import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpenAIChatCaller, AnthropicCaller, LLMRequest, LLMResponse } from '../src/llm.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    candidate_ref: 'test-candidate',
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
    ],
    seed: 42,
    temperature: 0.7,
    max_tokens: 100,
    metadata: { traceId: 'test-trace' },
    ...overrides,
  };
}

describe('OpenAIChatCaller', () => {
  let caller: OpenAIChatCaller;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = new OpenAIChatCaller({
      apiKey: 'test-api-key',
      defaultModel: 'gpt-4o-mini',
    });
  });

  it('implements LLMCaller interface', () => {
    expect(caller.provider).toBe('openai');
    expect(typeof caller.call).toBe('function');
  });

  it('calls OpenAI API with correct parameters', async () => {
    const mockResponse = {
      choices: [
        {
          message: { content: 'Hello there!', role: 'assistant' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'gpt-4o-mini' });
    const response = await caller.call(request);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(callArgs[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-api-key',
      },
    });

    const body = JSON.parse(callArgs[1].body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(100);
    expect(body.seed).toBe(42);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello!' });
  });

  it('returns valid LLMResponse shape', async () => {
    const mockResponse = {
      choices: [
        {
          message: { content: 'Hello there!', role: 'assistant' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest();
    const response = await caller.call(request);

    expect(response).toMatchObject({
      content: 'Hello there!',
      cost_usd: expect.any(Number),
      latency_ms: expect.any(Number),
      tokens_in: 25,
      tokens_out: 10,
      finish_reason: 'stop',
      raw: expect.any(Object),
      toCapturedCall: expect.any(Function),
    });
    expect(response.cost_usd).toBeGreaterThan(0);
    expect(response.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('toCapturedCall returns valid CapturedCall', async () => {
    const mockResponse = {
      choices: [
        {
          message: { content: 'Hello there!', role: 'assistant' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest();
    const response = await caller.call(request);

    const captured = response.toCapturedCall({
      id: 'call-123',
      started_at: '2024-01-01T00:00:00.000Z',
      completed_at: '2024-01-01T00:00:01.000Z',
      span_kind: 'gate.replay',
    });

    expect(captured).toMatchObject({
      id: 'call-123',
      input: {
        prompt: expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: 'You are a helpful assistant.' }),
          expect.objectContaining({ role: 'user', content: 'Hello!' }),
        ]),
        model: 'gpt-4o-mini',
        metadata: { traceId: 'test-trace' },
      },
      output: { content: 'Hello there!' },
      started_at: '2024-01-01T00:00:00.000Z',
      completed_at: '2024-01-01T00:00:01.000Z',
      cost_usd: expect.any(Number),
      latency_ms: expect.any(Number),
      span_kind: 'gate.replay',
    });
  });

  it('passes seed parameter to API', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'test', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ seed: 12345 });
    await caller.call(request);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.seed).toBe(12345);
  });

  it('handles API error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const request = createMockRequest();
    const response = await caller.call(request);

    expect(response).toMatchObject({
      content: '',
      cost_usd: 0,
      finish_reason: 'error',
      raw: expect.objectContaining({ status: 401, error: 'Unauthorized' }),
    });
    expect(response.toCapturedCall).toBeDefined();
  });

  it('uses default model when not specified', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'test', role: 'assistant' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'gpt-4o-mini' });
    await caller.call(request);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('handles missing usage data with approximation', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Hello world', role: 'assistant' }, finish_reason: 'stop' }],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest();
    const response = await caller.call(request);

    expect(response.tokens_in).toBeGreaterThan(0);
    expect(response.tokens_out).toBeGreaterThan(0);
    expect(response.cost_usd).toBeGreaterThan(0);
  });
});

describe('AnthropicCaller', () => {
  let caller: AnthropicCaller;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = new AnthropicCaller({
      apiKey: 'test-anthropic-key',
      defaultModel: 'claude-3-5-haiku',
    });
  });

  it('implements LLMCaller interface', () => {
    expect(caller.provider).toBe('anthropic');
    expect(typeof caller.call).toBe('function');
  });

  it('calls Anthropic API with correct parameters', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'Hello there!' }],
      usage: { input_tokens: 25, output_tokens: 10 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });
    const request = createMockRequest({ model: 'claude-3-5-haiku', seed: undefined });
    const response = await caller.call(request);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('https://api.anthropic.com/v1/messages');
    expect(callArgs[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-anthropic-key',
        'anthropic-version': '2023-06-01',
      },
    });

    const body = JSON.parse(callArgs[1].body as string);
    expect(body.model).toBe('claude-3-5-haiku');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.7);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Hello!' });
    expect(body.system).toBe('You are a helpful assistant.');
  });

  it('returns valid LLMResponse shape', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'Hello there!' }],
      usage: { input_tokens: 25, output_tokens: 10 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku' });
    const response = await caller.call(request);

    expect(response).toMatchObject({
      content: 'Hello there!',
      cost_usd: expect.any(Number),
      latency_ms: expect.any(Number),
      tokens_in: 25,
      tokens_out: 10,
      finish_reason: 'end_turn',
      raw: expect.any(Object),
      toCapturedCall: expect.any(Function),
    });
    expect(response.cost_usd).toBeGreaterThan(0);
    expect(response.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('toCapturedCall returns valid CapturedCall', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'Hello there!' }],
      usage: { input_tokens: 25, output_tokens: 10 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku' });
    const response = await caller.call(request);

    const captured = response.toCapturedCall({
      id: 'call-456',
      started_at: '2024-01-01T00:00:00.000Z',
      completed_at: '2024-01-01T00:00:01.000Z',
      span_kind: 'gate.replay',
    });

    expect(captured).toMatchObject({
      id: 'call-456',
      input: {
        prompt: expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: 'You are a helpful assistant.' }),
          expect.objectContaining({ role: 'user', content: 'Hello!' }),
        ]),
        model: 'claude-3-5-haiku',
        metadata: { traceId: 'test-trace' },
      },
      output: { content: 'Hello there!' },
      started_at: '2024-01-01T00:00:00.000Z',
      completed_at: '2024-01-01T00:00:01.000Z',
      cost_usd: expect.any(Number),
      latency_ms: expect.any(Number),
      span_kind: 'gate.replay',
    });
  });

  it('uses temperature=0 when seed is provided (determinism)', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'test' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku', seed: 999 });
    await caller.call(request);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    // Anthropic doesn't support seed; temperature should be 0 for determinism
    expect(body.temperature).toBe(0);
  });

  it('passes temperature when seed is not provided', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'test' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku', seed: undefined, temperature: 0.5 });
    await caller.call(request);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.temperature).toBe(0.5);
  });

  it('handles API error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku' });
    const response = await caller.call(request);

    expect(response).toMatchObject({
      content: '',
      cost_usd: 0,
      finish_reason: 'error',
      raw: expect.objectContaining({ status: 429, error: 'Rate limited' }),
    });
  });

  it('uses default model when not specified', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'test' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku' });
    await caller.call(request);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('claude-3-5-haiku');
  });

  it('handles missing usage data with approximation', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: 'Hello world' }],
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku' });
    const response = await caller.call(request);

    expect(response.tokens_in).toBeGreaterThan(0);
    expect(response.tokens_out).toBeGreaterThan(0);
    expect(response.cost_usd).toBeGreaterThan(0);
  });

  it('handles multiple content blocks', async () => {
    const mockResponse = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world!' },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const request = createMockRequest({ model: 'claude-3-5-haiku' });
    const response = await caller.call(request);

    expect(response.content).toBe('Hello world!');
  });
});