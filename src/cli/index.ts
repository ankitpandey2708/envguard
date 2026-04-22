#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadConfig, ConfigError, type Config } from '../core/config.js';
import { validateEnv, type ValidationResult } from '../core/validator.js';
import { initEnvguard } from './init.js';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
) as { version: string };
const VERSION = pkg.version;

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
  --json                machine-readable JSON output
  --debug               log request metadata (no secrets printed)
  -h, --help            show this help

Exit codes:
  0  success
  1  validation failed or keys not matched
  2  config or internal error
`.trimStart();

interface CliOptions {
  command: string;
  config?: string;
  provider?: string;
  apiKey?: string;
  json: boolean;
  debug: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const opts: CliOptions = { command: '', json: false, debug: false, help: false };

  if (args[0] && !args[0].startsWith('-')) {
    opts.command = args.shift()!;
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--config':   opts.config   = args[++i]; break;
      case '--provider': opts.provider = args[++i]; break;
      case '--api-key':  opts.apiKey   = args[++i]; break;
      case '--json':     opts.json     = true; break;
      case '--debug':    opts.debug    = true; break;
      case '--help':
      case '-h':         opts.help     = true; break;
    }
  }

  return opts;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ok: 'OK', invalid: 'INVALID', denied: 'DENIED', missing: 'MISSING', unknown: 'UNKNOWN',
  };
  return labels[status] ?? status.toUpperCase();
}

function printHuman(result: ValidationResult): void {
  process.stdout.write(`envguard v${VERSION} — validating API keys...\n\n`);

  for (const key of [...result.passed, ...result.failed, ...result.warnings]) {
    const sym = key.status === 'ok' ? '✔' : (!key.required ? '!' : '✖');
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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help || opts.command === 'help') {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (opts.command === 'init') {
    const result = await initEnvguard(process.cwd(), opts.apiKey);
    process.stdout.write(`envguard v${VERSION} — init\n\n`);
    process.stdout.write(`Found ${result.matched.length} API key(s):\n`);
    for (const key of result.matched) {
      process.stdout.write(`  ${key.envVar} → ${key.provider}\n`);
    }
    if (result.unmatched.length > 0) {
      process.stdout.write(`\nSkipped ${result.unmatched.length} non-API vars (or add manually):\n`);
      for (const v of result.unmatched.slice(0, 5)) {
        process.stdout.write(`  ${v}\n`);
      }
      if (result.unmatched.length > 5) {
        process.stdout.write(`  ... and ${result.unmatched.length - 5} more\n`);
      }
    }
    process.stdout.write(`\nCreated envguard.json\n`);
    process.stdout.write(`Run 'envguard validate' to test your keys.\n`);
    process.exit(0);
  }

  if (opts.command && opts.command !== 'validate') {
    process.stderr.write(`Unknown command: ${opts.command}\n\n${HELP}\n`);
    process.exit(2);
  }

  let config: Config;
  try {
    config = await loadConfig(opts.config);
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : (err as Error).message;
    process.stderr.write(`[envguard] Config error: ${msg}\n`);
    process.exit(2);
  }

  if (opts.provider) config = { ...config, keys: config.keys.filter(k => k.provider === opts.provider) };

  if (config.keys.length === 0) {
    process.stderr.write('[envguard] No keys matched the given filters — nothing to validate.\n');
    process.exit(2);
  }

  let result: ValidationResult;
  try {
    result = await validateEnv(config);
  } catch (err) {
    process.stderr.write(`[envguard] Error: ${(err as Error).message}\n`);
    process.exit(2);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHuman(result);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
  process.stderr.write(`[envguard] Unexpected error: ${(err as Error).message}\n`);
  process.exit(2);
});
