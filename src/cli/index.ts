#!/usr/bin/env node
import { loadConfig, ConfigError, type Config } from '../core/config.js';
import { validateEnv, keyOutcome, type ValidationResult, type KeyStatus, type KeyOutcome } from '../core/validator.js';
import { initEnvguard, loadEnvFiles, type InitResult, type InitStatus } from './init.js';
import { VERSION } from '../version.js';
import { safeExit } from './shared.js';

const HELP = `
envguard v${VERSION} — validate API keys before deployment

Usage:
  envguard <command> [options]

Commands:
  validate               Validate API keys (default)
  init                   Scan .env files and generate envguard.json

Options:
  --config <path>       path to config file (default: auto-detect envguard.json)
  --provider <id>       only validate keys for a specific provider
  --api-key <key>       OpenRouter API key for init (or set OPENROUTER_API_KEY)
  --model <id>          OpenRouter model for init (or set OPENROUTER_MODEL; default: openrouter/free)
  --fail-fast           stop after first required key failure
  --json                machine-readable JSON output
  -h, --help            show this help

Exit codes:
  0  success
  1  validation failed or keys not matched
  2  config or internal error
`.trimStart();

const COMMANDS = ['validate', 'init', 'help'] as const;
type Command = typeof COMMANDS[number];

/** Resolved command: a known one, or the raw unknown token (reported as an error). */
type ParsedCommand = { kind: 'known'; name: Command } | { kind: 'unknown'; name: string };

interface CliOptions {
  command: ParsedCommand;
  config?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  failFast: boolean;
  json: boolean;
  help: boolean;
  /** Non-fatal parse problems (unknown flags, flags missing a value), printed to stderr. */
  warnings: string[];
}

const VALUE_FLAGS = { '--config': 'config', '--provider': 'provider', '--api-key': 'apiKey', '--model': 'model' } as const;
const BOOL_FLAGS = { '--fail-fast': 'failFast', '--json': 'json', '--help': 'help', '-h': 'help' } as const;

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const opts: CliOptions = { command: { kind: 'known', name: 'validate' }, failFast: false, json: false, help: false, warnings: [] };

  if (args[0] && !args[0].startsWith('-')) {
    const name = args.shift()!;
    opts.command = (COMMANDS as readonly string[]).includes(name)
      ? { kind: 'known', name: name as Command }
      : { kind: 'unknown', name };
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg in VALUE_FLAGS) {
      const next = args[i + 1];
      // A following flag is never a value: `--api-key --json` must not swallow --json.
      if (next === undefined || next.startsWith('-')) {
        opts.warnings.push(`${arg} expects a value — ignoring it`);
        continue;
      }
      opts[VALUE_FLAGS[arg as keyof typeof VALUE_FLAGS]] = next;
      i++;
    } else if (arg in BOOL_FLAGS) {
      opts[BOOL_FLAGS[arg as keyof typeof BOOL_FLAGS]] = true;
    } else {
      opts.warnings.push(`unknown option ${arg} — ignoring it (see --help)`);
    }
  }

  return opts;
}

const STATUS_LABELS: Record<KeyStatus, string> = {
  ok: 'OK',
  invalid: 'INVALID',
  denied: 'DENIED',
  missing: 'MISSING',
  unknown: 'UNKNOWN',
};

const OUTCOME_SYMBOL: Record<KeyOutcome, string> = { passed: '✔', failed: '✖', warning: '!' };

function statusLabel(status: KeyStatus): string {
  return STATUS_LABELS[status];
}

function printHuman(result: ValidationResult): void {
  process.stdout.write(`envguard v${VERSION} — validating API keys...\n\n`);

  for (const key of [...result.passed, ...result.failed, ...result.warnings]) {
    const sym = OUTCOME_SYMBOL[keyOutcome(key)];
    const detail = key.message ? ` – ${key.message}` : '';
    const tag = !key.required ? ' (optional)' : '';
    process.stdout.write(`${sym} ${key.envVar} (${key.provider}): ${statusLabel(key.status)}${detail}${tag}\n`);
  }

  process.stdout.write('\nSummary:\n');
  process.stdout.write(`  Passed:   ${result.passed.length}\n`);
  process.stdout.write(`  Failed:   ${result.failed.length}\n`);
  process.stdout.write(`  Warnings: ${result.warnings.length}\n\n`);

  if (!result.ok) {
    const n = result.failed.length;
    process.stdout.write(`Deployment blocked: ${n} required key${n === 1 ? '' : 's'} failed validation.\n`);
  } else if (result.warnings.length > 0) {
    process.stdout.write(`All required keys validated. Proceeding with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.\n`);
  } else {
    process.stdout.write('All keys validated successfully.\n');
  }
}

/** Closing line(s) for each init outcome. Record type forces a message for every status. */
const INIT_FOOTER: Record<InitStatus, (r: InitResult) => string> = {
  skipped: () => `No new env vars to add — envguard.json is up to date.\n`,
  unchanged: () => `\nNo new API keys to add — envguard.json unchanged.\n`,
  updated: r => `\nUpdated envguard.json (added ${r.matched.length} new key(s))\nRun 'envguard validate' to test your keys.\n`,
  created: () => `\nCreated envguard.json\nRun 'envguard validate' to test your keys.\n`,
};

async function handleInitCommand(opts: CliOptions): Promise<void> {
  let result: InitResult;
  try {
    result = await initEnvguard(process.cwd(), opts.apiKey, undefined, opts.model);
  } catch (err) {
    process.stderr.write(`[envguard] Init error: ${(err as Error).message}\n`);
    return safeExit(2);
  }

  process.stdout.write(`envguard v${VERSION} — init\n\n`);
  if (result.status !== 'skipped') printInitAnalysis(result);
  process.stdout.write(INIT_FOOTER[result.status](result));
  return safeExit(0);
}

function printInitAnalysis(result: InitResult): void {
  const sections: string[] = [];

  if (result.matched.length > 0) {
    sections.push(
      `Found ${result.matched.length} API key(s):\n` +
      result.matched.map(k => `  ${k.envVar} → ${k.provider}\n`).join('')
    );
  }
  if (result.unregistered.length > 0) {
    const uniqueProviders = [...new Set(result.unregistered.map(s => s.provider!))];
    let s = `⚠ ${result.unregistered.length} key(s) use ${uniqueProviders.length} unregistered provider(s):\n`;
    for (const provider of uniqueProviders) {
      const keys = result.unregistered.filter(k => k.provider === provider);
      s += `  ${provider} (${keys.length} key${keys.length === 1 ? '' : 's'}):\n`;
      s += keys.map(k => `    - ${k.envVar}\n`).join('');
    }
    s += `  These keys were NOT added to envguard.json.\n`;
    s += `  Request provider support: https://github.com/ankitpandey2708/envguard\n`;
    sections.push(s);
  }
  if (result.unmatched.length > 0) {
    sections.push(
      `Skipped ${result.unmatched.length} non-API vars :\n` +
      result.unmatched.map(v => `  ${v}\n`).join('')
    );
  }

  process.stdout.write(sections.join('\n'));
}

async function handleValidateCommand(opts: CliOptions): Promise<void> {
  let config: Config;
  try {
    config = await loadConfig(opts.config);
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : (err as Error).message;
    process.stderr.write(`[envguard] Config error: ${msg}\n`);
    return safeExit(2);
  }

  if (opts.provider) config = { ...config, keys: config.keys.filter(k => k.provider === opts.provider) };

  if (config.keys.length === 0) {
    process.stderr.write('[envguard] No keys matched the given filters — nothing to validate.\n');
    return safeExit(2);
  }

  // Auto-load only the env vars listed in config (minimal memory footprint)
  loadEnvFiles(process.cwd(), config);

  let result: ValidationResult;
  try {
    result = await validateEnv(config, { failFast: opts.failFast });
  } catch (err) {
    process.stderr.write(`[envguard] Error: ${(err as Error).message}\n`);
    return safeExit(2);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHuman(result);
  }

  return safeExit(result.ok ? 0 : 1);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  for (const w of opts.warnings) process.stderr.write(`[envguard] Warning: ${w}\n`);

  // --help wins over any command, including an unknown one
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return safeExit(0);
  }

  const { command } = opts;
  if (command.kind === 'unknown') {
    process.stderr.write(`Unknown command: ${command.name}\n\n${HELP}\n`);
    return safeExit(2);
  }

  switch (command.name) {
    case 'help':
      process.stdout.write(HELP + '\n');
      return safeExit(0);
    case 'init':
      return handleInitCommand(opts);
    case 'validate':
      return handleValidateCommand(opts);
  }
}

main().catch(async err => {
  process.stderr.write(`[envguard] Unexpected error: ${(err as Error).message}\n`);
  return safeExit(2);
});
