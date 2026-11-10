import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, keyOutcome, type KeyValidationResult } from '../core/validator.js';
import { validateConfig } from '../core/config.js';
import { installFetchStub, type StubRules } from './helpers/stub-fetch.js';

const realFetch = globalThis.fetch;
const touchedEnv = new Set<string>();

function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    touchedEnv.add(k);
    process.env[k] = v;
  }
}

beforeEach(() => {
  // Isolate from the developer's real environment
  for (const k of ['TEST_A', 'TEST_B', 'TEST_C', 'TWILIO_ACCOUNT_SID']) {
    touchedEnv.add(k);
    delete process.env[k];
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of touchedEnv) delete process.env[k];
  touchedEnv.clear();
});

async function run(
  keys: Array<{ envVar: string; provider: string; required?: boolean }>,
  rules: StubRules,
  opts: { failFast?: boolean; concurrency?: number } = {},
) {
  installFetchStub(rules);
  const config = validateConfig({ keys, concurrency: opts.concurrency ?? 5 });
  return validateEnv(config, { failFast: opts.failFast });
}

const only = (r: { passed: KeyValidationResult[]; failed: KeyValidationResult[]; warnings: KeyValidationResult[] }) =>
  [...r.passed, ...r.failed, ...r.warnings][0];

// ---- each terminal state of a key's lifecycle -> (status, reason, message) ----

const cases: Array<{ name: string; rule: StubRules; env?: Record<string, string>; provider?: string; expect: Partial<KeyValidationResult> }> = [
  { name: 'HTTP 200', rule: { openai: 200 }, expect: { status: 'ok', reason: 'http_ok', message: undefined } },
  { name: 'HTTP 401', rule: { openai: 401 }, expect: { status: 'invalid', reason: 'http_invalid', message: 'provider returned HTTP 401' } },
  { name: 'HTTP 403', rule: { openai: 403 }, expect: { status: 'denied', reason: 'http_denied', message: 'provider returned HTTP 403' } },
  { name: 'HTTP 500', rule: { openai: 500 }, expect: { status: 'unknown', reason: 'http_unexpected', message: 'provider returned HTTP 500' } },
  { name: 'env var unset', rule: {}, env: {}, expect: { status: 'missing', reason: 'env_not_set', message: 'environment variable not set' } },
  { name: 'network failure', rule: { openai: 'network_error' }, expect: { status: 'unknown', reason: 'network_error', message: 'fetch failed' } },
  { name: 'timeout', rule: { openai: 'timeout' }, expect: { status: 'unknown', reason: 'timeout', message: 'request timed out after 5s' } },
  {
    name: 'provider misconfigured (Twilio without SID)', rule: {}, provider: 'twilio',
    expect: { status: 'unknown', reason: 'request_build_failed', message: 'Twilio provider requires TWILIO_ACCOUNT_SID env var' },
  },
];

for (const c of cases) {
  test(`key state: ${c.name}`, async () => {
    setEnv(c.env ?? { TEST_A: 'secret' });
    const result = only(await run([{ envVar: 'TEST_A', provider: c.provider ?? 'openai' }], c.rule));
    for (const [field, value] of Object.entries(c.expect)) {
      assert.equal(result[field as keyof KeyValidationResult], value, field);
    }
  });
}

test('provider-specific status mapping is respected (Gemini 400 = invalid)', async () => {
  setEnv({ TEST_A: 'k' });
  const r = only(await run([{ envVar: 'TEST_A', provider: 'gemini' }], { googleapis: 400 }));
  assert.equal(r.reason, 'http_invalid');
});

// ---- bucketing ----

test('keyOutcome: ok passes; non-ok fails if required, warns if optional', () => {
  assert.equal(keyOutcome({ status: 'ok', required: true }), 'passed');
  assert.equal(keyOutcome({ status: 'ok', required: false }), 'passed');
  assert.equal(keyOutcome({ status: 'invalid', required: true }), 'failed');
  assert.equal(keyOutcome({ status: 'unknown', required: false }), 'warning');
});

test('results are bucketed and ok reflects only required failures', async () => {
  setEnv({ TEST_A: 'a', TEST_B: 'b' });
  const r = await run(
    [
      { envVar: 'TEST_A', provider: 'openai' },
      { envVar: 'TEST_B', provider: 'stripe' },
      { envVar: 'TEST_C', provider: 'anthropic', required: false },
    ],
    { openai: 200, stripe: 401 },
  );
  assert.deepEqual(r.passed.map(k => k.envVar), ['TEST_A']);
  assert.deepEqual(r.failed.map(k => k.envVar), ['TEST_B']);
  assert.deepEqual(r.warnings.map(k => k.envVar), ['TEST_C']);
  assert.equal(r.ok, false);

  const optionalOnly = await run([{ envVar: 'TEST_C', provider: 'anthropic', required: false }], {});
  assert.equal(optionalOnly.ok, true);
});

// ---- fail-fast run state ----

test('fail-fast: in-flight and pending keys are reported as skipped, not as errors', async () => {
  setEnv({ TEST_A: 'a', TEST_B: 'b', TEST_C: 'c' });
  const r = await run(
    [
      { envVar: 'TEST_A', provider: 'openai' },     // fails -> triggers abort
      { envVar: 'TEST_B', provider: 'stripe' },     // in flight when abort fires
      { envVar: 'TEST_C', provider: 'anthropic' },  // never started
    ],
    { openai: 401, stripe: 'hang', anthropic: 200 },
    { failFast: true, concurrency: 2 },
  );
  const byVar = Object.fromEntries(r.failed.map(k => [k.envVar, k]));
  assert.equal(byVar.TEST_A.reason, 'http_invalid');
  for (const v of ['TEST_B', 'TEST_C']) {
    assert.equal(byVar[v].reason, 'skipped_fail_fast', v);
    assert.equal(byVar[v].message, 'skipped (fail-fast)', v);
  }
});

test('fail-fast: optional failures and unknown results do not stop the run', async () => {
  setEnv({ TEST_A: 'a', TEST_B: 'b' });
  const r = await run(
    [
      { envVar: 'TEST_C', provider: 'anthropic', required: false }, // missing, optional
      { envVar: 'TEST_A', provider: 'openai' },                     // network error, required
      { envVar: 'TEST_B', provider: 'stripe' },
    ],
    { openai: 'network_error', stripe: 200 },
    { failFast: true, concurrency: 1 },
  );
  assert.deepEqual(r.passed.map(k => k.envVar), ['TEST_B']);
});

test('without fail-fast every key is checked', async () => {
  setEnv({ TEST_A: 'a', TEST_B: 'b' });
  const r = await run(
    [{ envVar: 'TEST_A', provider: 'openai' }, { envVar: 'TEST_B', provider: 'stripe' }],
    { openai: 401, stripe: 200 },
    { concurrency: 1 },
  );
  assert.deepEqual(r.passed.map(k => k.envVar), ['TEST_B']);
});

test('unregistered provider in config is a hard error', async () => {
  await assert.rejects(run([{ envVar: 'TEST_A', provider: 'nope' }], {}), /unregistered provider "nope"/);
});
