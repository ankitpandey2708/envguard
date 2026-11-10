import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, ConfigError, DEFAULT_CONCURRENCY } from '../core/config.js';
import { validateEnv } from '../core/validator.js';
import { installFetchStub } from './helpers/stub-fetch.js';

const KEY = { envVar: 'A', provider: 'p' };

test('applies defaults and drops unknown fields', () => {
  assert.deepEqual(validateConfig({ keys: [{ ...KEY, extra: 1 }], other: 2 }), {
    keys: [{ envVar: 'A', provider: 'p', required: true }],
    concurrency: DEFAULT_CONCURRENCY,
  });
  assert.deepEqual(validateConfig({ keys: [{ ...KEY, required: false }], concurrency: 3 }), {
    keys: [{ envVar: 'A', provider: 'p', required: false }],
    concurrency: 3,
  });
});

// Error wording is user-facing; it matches what envguard printed when it used zod (<= 1.1.4).
const invalid: Array<[unknown, string[]]> = [
  [null, ['(root): Invalid input: expected object, received null']],
  [[], ['(root): Invalid input: expected object, received array']],
  [{}, ['keys: Invalid input: expected array, received undefined']],
  [{ keys: 'x' }, ['keys: Invalid input: expected array, received string']],
  [{ keys: [] }, ['keys: at least one key must be configured']],
  [{ keys: [null] }, ['keys.0: Invalid input: expected object, received null']],
  [{ keys: [{}] }, [
    'keys.0.envVar: Invalid input: expected string, received undefined',
    'keys.0.provider: Invalid input: expected string, received undefined',
  ]],
  [{ keys: [{ envVar: '', provider: '' }] }, ['keys.0.envVar: envVar must not be empty', 'keys.0.provider: provider must not be empty']],
  [{ keys: [{ envVar: 1, provider: true }] }, [
    'keys.0.envVar: Invalid input: expected string, received number',
    'keys.0.provider: Invalid input: expected string, received boolean',
  ]],
  [{ keys: [{ ...KEY, required: 'yes' }] }, ['keys.0.required: Invalid input: expected boolean, received string']],
  [{ keys: [KEY], concurrency: 0 }, ['concurrency: Too small: expected number to be >0']],
  [{ keys: [KEY], concurrency: -2 }, ['concurrency: Too small: expected number to be >0']],
  [{ keys: [KEY], concurrency: 1.5 }, ['concurrency: Invalid input: expected int, received number']],
  [{ keys: [KEY], concurrency: '3' }, ['concurrency: Invalid input: expected number, received string']],
  [{ keys: [KEY], concurrency: null }, ['concurrency: Invalid input: expected number, received null']],
  [{ keys: [KEY], concurrency: NaN }, ['concurrency: Invalid input: expected number, received NaN']],
];

for (const [input, lines] of invalid) {
  test(`rejects ${JSON.stringify(input)}`, () => {
    assert.throws(() => validateConfig(input), (err: unknown) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.message, `Invalid config:\n${lines.map(l => `  - ${l}`).join('\n')}`);
      return true;
    });
  });
}

test('rejects duplicate envVar', () => {
  assert.throws(() => validateConfig({ keys: [KEY, { envVar: 'A', provider: 'q' }] }), /Duplicate envVar in config: A/);
});

test('validateEnv accepts a minimal config object (README example) and applies defaults', async () => {
  const realFetch = globalThis.fetch;
  process.env.TEST_DIRECT = 'k';
  try {
    installFetchStub({ openai: 200 });
    const r = await validateEnv({ keys: [{ envVar: 'TEST_DIRECT', provider: 'openai' }] });
    assert.equal(r.ok, true);
    assert.equal(r.passed[0].required, true);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TEST_DIRECT;
  }
});
