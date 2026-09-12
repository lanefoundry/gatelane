/**
 * Eval config — YAML-driven eval definition.
 *
 * One YAML file defines: target endpoint, judge model, test cases,
 * red team categories, and optional trace-sourced inputs.
 */

export interface EvalConfig {
  target: {
    url: string;
    request: Record<string, unknown>;
    headers?: Record<string, string>;
    response_path?: string;
  };
  judge?: {
    provider: 'mock' | 'openai' | 'anthropic';
    model?: string;
    api_key_env?: string;
  };
  tests?: EvalTestCase[];
  redteam?: {
    categories?: string[];
    custom_vectors?: { payload: string; name?: string }[];
  };
  blueteam?: {
    on_block?: {
      assert: EvalAssertion[];
    };
    no_leak?: string[];
    false_positive_tests?: EvalTestCase[];
  };
  queries_file?: string;
  from_traces?: {
    dir?: string;
    tag: string;
    limit?: number;
  };
  from_captures?: {
    source: string;
    endpoint?: string;
    token?: string;
    limit?: number;
  };
}

export interface EvalTestCase {
  input: string;
  name?: string;
  assert?: EvalAssertion[];
}

export interface EvalAssertion {
  type: 'contains' | 'not-contains' | 'llm-rubric' | 'latency' | 'status' | 'json-path';
  value: string | number;
  path?: string;
  contains?: string;
  ordered?: string[];
  gte?: number;
  lte?: number;
  equals?: unknown;
}

export function parseEvalConfig(raw: unknown): EvalConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('eval config must be a YAML object');
  }
  const obj = raw as Record<string, unknown>;

  if (!obj['target'] || typeof obj['target'] !== 'object') {
    throw new Error('eval config requires a "target" section with "url" and "request"');
  }
  const target = obj['target'] as Record<string, unknown>;
  if (typeof target['url'] !== 'string' || !target['url']) {
    throw new Error('target.url is required');
  }
  if (!target['request'] || typeof target['request'] !== 'object') {
    throw new Error('target.request is required (object with {{input}} placeholder)');
  }

  const config: EvalConfig = {
    target: {
      url: target['url'] as string,
      request: target['request'] as Record<string, unknown>,
      ...(target['headers'] ? { headers: target['headers'] as Record<string, string> } : {}),
      ...(typeof target['response_path'] === 'string' ? { response_path: target['response_path'] } : {}),
    },
  };

  if (obj['judge'] && typeof obj['judge'] === 'object') {
    const j = obj['judge'] as Record<string, unknown>;
    config.judge = {
      provider: (j['provider'] as 'mock' | 'openai' | 'anthropic') ?? 'mock',
      ...(typeof j['model'] === 'string' ? { model: j['model'] } : {}),
      ...(typeof j['api_key_env'] === 'string' ? { api_key_env: j['api_key_env'] } : {}),
    };
  }

  if (Array.isArray(obj['tests'])) {
    config.tests = (obj['tests'] as Record<string, unknown>[]).map((t) => {
      if (typeof t['input'] !== 'string') {
        throw new Error('each test must have an "input" string');
      }
      const tc: EvalTestCase = { input: t['input'] as string };
      if (typeof t['name'] === 'string') tc.name = t['name'];
      if (Array.isArray(t['assert'])) {
        tc.assert = (t['assert'] as Record<string, unknown>[]).map((a) => ({
          type: a['type'] as EvalAssertion['type'],
          value: a['value'] as string | number,
          ...(typeof a['path'] === 'string' ? { path: a['path'] } : {}),
          ...(typeof a['contains'] === 'string' ? { contains: a['contains'] } : {}),
          ...(Array.isArray(a['ordered']) ? { ordered: a['ordered'] as string[] } : {}),
          ...(typeof a['gte'] === 'number' ? { gte: a['gte'] } : {}),
          ...(typeof a['lte'] === 'number' ? { lte: a['lte'] } : {}),
          ...(a['equals'] !== undefined ? { equals: a['equals'] } : {}),
        }));
      }
      return tc;
    });
  }

  if (obj['redteam'] && typeof obj['redteam'] === 'object') {
    const rt = obj['redteam'] as Record<string, unknown>;
    config.redteam = {};
    if (Array.isArray(rt['categories'])) {
      config.redteam.categories = rt['categories'] as string[];
    }
    if (Array.isArray(rt['custom_vectors'])) {
      config.redteam.custom_vectors = (rt['custom_vectors'] as Record<string, unknown>[]).map((v) => ({
        payload: v['payload'] as string,
        ...(typeof v['name'] === 'string' ? { name: v['name'] } : {}),
      }));
    }
  }

  if (obj['blueteam'] && typeof obj['blueteam'] === 'object') {
    const bt = obj['blueteam'] as Record<string, unknown>;
    config.blueteam = {};
    if (bt['on_block'] && typeof bt['on_block'] === 'object') {
      const ob = bt['on_block'] as Record<string, unknown>;
      if (Array.isArray(ob['assert'])) {
        config.blueteam.on_block = {
          assert: (ob['assert'] as Record<string, unknown>[]).map((a) => ({
            type: a['type'] as EvalAssertion['type'],
            value: a['value'] as string | number,
          })),
        };
      }
    }
    if (Array.isArray(bt['no_leak'])) {
      config.blueteam.no_leak = bt['no_leak'] as string[];
    }
    if (Array.isArray(bt['false_positive_tests'])) {
      config.blueteam.false_positive_tests = (bt['false_positive_tests'] as Record<string, unknown>[]).map((t) => {
        const tc: EvalTestCase = { input: t['input'] as string };
        if (typeof t['name'] === 'string') tc.name = t['name'];
        if (Array.isArray(t['assert'])) {
          tc.assert = (t['assert'] as Record<string, unknown>[]).map((a) => ({
            type: a['type'] as EvalAssertion['type'],
            value: a['value'] as string | number,
          }));
        }
        return tc;
      });
    }
  }

  if (typeof obj['queries_file'] === 'string') {
    config.queries_file = obj['queries_file'];
  }

  if (obj['from_traces'] && typeof obj['from_traces'] === 'object') {
    const ft = obj['from_traces'] as Record<string, unknown>;
    if (typeof ft['tag'] !== 'string') {
      throw new Error('from_traces.tag is required');
    }
    config.from_traces = {
      tag: ft['tag'] as string,
      ...(typeof ft['dir'] === 'string' ? { dir: ft['dir'] } : {}),
      ...(typeof ft['limit'] === 'number' ? { limit: ft['limit'] } : {}),
    };
  }

  if (obj['from_captures'] && typeof obj['from_captures'] === 'object') {
    const fc = obj['from_captures'] as Record<string, unknown>;
    if (typeof fc['source'] !== 'string') {
      throw new Error('from_captures.source is required (filesystem path or "http")');
    }
    config.from_captures = {
      source: fc['source'] as string,
      ...(typeof fc['endpoint'] === 'string' ? { endpoint: fc['endpoint'] } : {}),
      ...(typeof fc['token'] === 'string' ? { token: fc['token'] } : {}),
      ...(typeof fc['limit'] === 'number' ? { limit: fc['limit'] } : {}),
    };
  }

  return config;
}
