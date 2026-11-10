/**
 * Deterministic replacement for global fetch, so tests never touch the network.
 *
 * Rules map a URL substring to a behavior:
 *   200 / 401 / …    → respond with that HTTP status
 *   'network_error'  → throw like a DNS/connection failure
 *   'timeout'        → throw like AbortSignal.timeout firing
 *   'hang'           → never respond (until the request's signal aborts)
 *   { llm: string }  → respond as OpenRouter chat completions with that content
 * Unmatched URLs respond 404.
 *
 * Used two ways:
 *   - in-process:  installFetchStub({ openai: 200 })
 *   - subprocess:  node --import <this file> …  with STUB='{"openai":200}' in env
 */
export type StubRule = number | 'network_error' | 'timeout' | 'hang' | { llm: string };
export type StubRules = Record<string, StubRule>;

export function installFetchStub(rules: StubRules): void {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const match = Object.keys(rules).find(k => url.includes(k));
    const rule: StubRule = match === undefined ? 404 : rules[match];
    const signal = init?.signal ?? undefined;

    if (rule === 'hang') {
      await new Promise((_, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (rule === 'network_error') throw new TypeError('fetch failed');
    if (rule === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (typeof rule === 'object') {
      return new Response(JSON.stringify({ choices: [{ message: { content: rule.llm } }] }), { status: 200 });
    }
    return new Response('{}', { status: rule as number });
  };
}

if (process.env.STUB) installFetchStub(JSON.parse(process.env.STUB) as StubRules);
