import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StubRules } from './helpers/stub-fetch.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '../cli/index.js');
const STUB = pathToFileURL(join(here, 'helpers/stub-fetch.js')).href;

// Pass through only what Node needs to run, so the developer's real API keys never leak in.
const BASE_ENV = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
    .flatMap(k => process.env[k] !== undefined ? [[k, process.env[k]!]] : []),
);

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** envguard.json after the run, or null if absent. */
  configFile: string | null;
}

function envguard(
  args: string[],
  setup: { files?: Record<string, string>; env?: Record<string, string>; stub?: StubRules } = {},
): Run {
  const dir = mkdtempSync(join(tmpdir(), 'envguard-test-'));
  try {
    for (const [name, content] of Object.entries(setup.files ?? {})) writeFileSync(join(dir, name), content);
    const r = spawnSync(process.execPath, ['--import', STUB, CLI, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...BASE_ENV, ...setup.env, STUB: JSON.stringify(setup.stub ?? {}) },
    });
    const cfgPath = join(dir, 'envguard.json');
    return {
      code: r.status,
      stdout: r.stdout.replace(/\r/g, ''),
      stderr: r.stderr.replace(/\r/g, ''),
      configFile: existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const config = (keys: Array<{ envVar: string; provider: string; required?: boolean }>, concurrency = 5) =>
  JSON.stringify({ concurrency, keys });

const llm = (suggestions: Array<{ envVar: string; provider: string }>, unmatched: string[] = []): StubRules => ({
  'openrouter.ai': { llm: JSON.stringify({ suggestions: suggestions.map(s => ({ ...s, reason: 'API key' })), unmatched }) },
});

// =====================================================================
// validate
// =====================================================================

test('validate: all keys ok → exit 0 with success summary', () => {
  const r = envguard([], {
    files: { 'envguard.json': config([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]) },
    env: { OPENAI_API_KEY: 'k' },
    stub: { openai: 200 },
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /✔ OPENAI_API_KEY \(OpenAI\): OK\n/);
  assert.match(r.stdout, /All keys validated successfully\./);
});

test('validate: human output marks failed (✖) and optional (!) keys', () => {
  const r = envguard([], {
    files: {
      'envguard.json': config([
        { envVar: 'OPENAI_API_KEY', provider: 'openai' },
        { envVar: 'GEMINI_KEY', provider: 'gemini', required: false },
      ]),
    },
    env: { OPENAI_API_KEY: 'k' },
    stub: { openai: 401 },
  });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /✖ OPENAI_API_KEY \(OpenAI\): INVALID – provider returned HTTP 401\n/);
  assert.match(r.stdout, /! GEMINI_KEY \(Google Gemini\): MISSING – environment variable not set \(optional\)\n/);
  assert.match(r.stdout, /Deployment blocked: 1 required key failed validation\./);
});

test('validate --json: stable shape with status and reason', () => {
  const r = envguard(['--json'], {
    files: { 'envguard.json': config([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]) },
    env: { OPENAI_API_KEY: 'k' },
    stub: { openai: 'timeout' },
  });
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), {
    ok: false,
    passed: [],
    failed: [{
      envVar: 'OPENAI_API_KEY', provider: 'OpenAI', status: 'unknown', reason: 'timeout',
      required: true, message: 'request timed out after 5s',
    }],
    warnings: [],
  });
});

test('validate: loads only configured vars from .env', () => {
  const r = envguard(['--json'], {
    files: { 'envguard.json': config([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]), '.env': 'OPENAI_API_KEY=fromfile\n' },
    stub: { openai: 200 },
  });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).passed[0].reason, 'http_ok');
});

test('validate --provider: filters keys; no match → exit 2', () => {
  const files = { 'envguard.json': config([{ envVar: 'A', provider: 'openai' }, { envVar: 'B', provider: 'stripe' }]) };
  const ok = envguard(['--json', '--provider', 'openai'], { files, env: { A: 'k' }, stub: { openai: 200 } });
  assert.equal(ok.code, 0);
  assert.deepEqual(JSON.parse(ok.stdout).passed.map((k: { envVar: string }) => k.envVar), ['A']);

  const none = envguard(['--provider', 'nope'], { files });
  assert.equal(none.code, 2);
  assert.match(none.stderr, /No keys matched the given filters/);
});

test('validate: config errors → exit 2', () => {
  assert.equal(envguard([]).code, 2);
  assert.match(envguard([]).stderr, /No config file found/);
  assert.match(envguard(['--config', 'x.json']).stderr, /Config file not found: .*x\.json/);
  const bad = envguard([], { files: { 'envguard.json': config([{ envVar: 'A', provider: 'nope' }]) }, env: { A: 'k' } });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /unregistered provider "nope"/);
});

// =====================================================================
// argument parsing
// =====================================================================

test('args: unknown option warns on stderr but still runs', () => {
  const r = envguard(['--failfast'], {
    files: { 'envguard.json': config([{ envVar: 'A', provider: 'openai' }]) },
    env: { A: 'k' },
    stub: { openai: 200 },
  });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Warning: unknown option --failfast/);
});

test('args: value flag without value warns and does not swallow the next flag', () => {
  const r = envguard(['--config', '--json'], {
    files: { 'envguard.json': config([{ envVar: 'A', provider: 'openai' }]) },
    env: { A: 'k' },
    stub: { openai: 200 },
  });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Warning: --config expects a value/);
  assert.equal(JSON.parse(r.stdout).ok, true, '--json must still apply');
});

test('args: help, unknown command', () => {
  for (const args of [['--help'], ['-h'], ['help'], ['frob', '--help']]) {
    const r = envguard(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.match(r.stdout, /^envguard v[\d.]+ — validate API keys before deployment/, args.join(' '));
  }
  const unknown = envguard(['frob']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^Unknown command: frob/);
});

// =====================================================================
// init
// =====================================================================

test('init: creates config with registered keys only', () => {
  const r = envguard(['init', '--api-key', 'k'], {
    files: { '.env': 'OPENAI_API_KEY=x\nOPENAI_MODEL=gpt\nFOO_KEY=y\n' },
    stub: llm([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }, { envVar: 'FOO_KEY', provider: 'foo' }], ['OPENAI_MODEL']),
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Found 1 API key\(s\):\n {2}OPENAI_API_KEY → openai\n/);
  assert.match(r.stdout, /1 key\(s\) use 1 unregistered provider\(s\):\n {2}foo \(1 key\):\n {4}- FOO_KEY\n/);
  assert.match(r.stdout, /Skipped 1 non-API vars :\n {2}OPENAI_MODEL\n/);
  assert.match(r.stdout, /Created envguard\.json\n/);
  assert.deepEqual(JSON.parse(r.configFile!), { concurrency: 5, keys: [{ envVar: 'OPENAI_API_KEY', provider: 'openai' }] });
});

test('init: skipped when every env var is already configured (no LLM call)', () => {
  const existing = config([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]);
  const r = envguard(['init', '--api-key', 'k'], {
    files: { '.env': 'OPENAI_API_KEY=x\n', 'envguard.json': existing },
    stub: {}, // an LLM call would 404 and fail the run
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No new env vars to add — envguard\.json is up to date\./);
  assert.equal(r.configFile, existing);
});

test('init: updated merges new keys as optional', () => {
  const r = envguard(['init', '--api-key', 'k'], {
    files: { '.env': 'OPENAI_API_KEY=x\nSTRIPE_KEY=y\n', 'envguard.json': config([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]) },
    stub: llm([{ envVar: 'STRIPE_KEY', provider: 'stripe' }]),
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Updated envguard\.json \(added 1 new key\(s\)\)/);
  assert.deepEqual(JSON.parse(r.configFile!).keys, [
    { envVar: 'OPENAI_API_KEY', provider: 'openai', required: true },
    { envVar: 'STRIPE_KEY', provider: 'stripe', required: false },
  ]);
});

test('init: unchanged when new vars contain no registered API keys — file untouched', () => {
  const existing = config([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]);
  const r = envguard(['init', '--api-key', 'k'], {
    files: { '.env': 'OPENAI_API_KEY=x\nOPENAI_MODEL=gpt\n', 'envguard.json': existing },
    stub: llm([], ['OPENAI_MODEL']),
  });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.stdout, /Found 0|Updated/);
  assert.match(r.stdout, /No new API keys to add — envguard\.json unchanged\./);
  assert.equal(r.configFile, existing);
});

test('init: refuses to overwrite an invalid existing config', () => {
  for (const broken of [
    '{ "keys": [ { "envVar": "MY_KEY", "provider": "openai" }, ] }', // bad JSON
    '{ "keys": [ { "envVar": "MY_KEY" } ] }',                         // schema error
  ]) {
    const r = envguard(['init', '--api-key', 'k'], {
      files: { '.env': 'OPENAI_API_KEY=x\n', 'envguard.json': broken },
      stub: llm([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]),
    });
    assert.equal(r.code, 2, broken);
    assert.match(r.stderr, /Init error: Existing .*envguard\.json is invalid/, broken);
    assert.match(r.stderr, /Refusing to overwrite it/, broken);
    assert.equal(r.configFile, broken, 'file must be untouched');
  }
});

test('init: config with empty keys array is treated as fresh', () => {
  const r = envguard(['init', '--api-key', 'k'], {
    files: { '.env': 'OPENAI_API_KEY=x\n', 'envguard.json': '{ "keys": [] }' },
    stub: llm([{ envVar: 'OPENAI_API_KEY', provider: 'openai' }]),
  });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Created envguard\.json/);
});

test('init: expected failures → exit 2 with "Init error"', () => {
  const noEnv = envguard(['init', '--api-key', 'k']);
  assert.equal(noEnv.code, 2);
  assert.match(noEnv.stderr, /Init error: No \.env files found/);

  const noKeys = envguard(['init', '--api-key', 'k'], { files: { '.env': 'OPENAI_MODEL=gpt\n' }, stub: llm([], ['OPENAI_MODEL']) });
  assert.equal(noKeys.code, 2);
  assert.match(noKeys.stderr, /Init error: No API keys detected/);

  const noLlmKey = envguard(['init'], { files: { '.env': 'OPENAI_API_KEY=x\n' } });
  assert.equal(noLlmKey.code, 2);
  assert.match(noLlmKey.stderr, /requires an OpenRouter API key/);
});
