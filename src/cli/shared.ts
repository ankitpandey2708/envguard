import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Prefix prepended to the build script by postinstall. */
export const GUARD_PREFIX = 'envguard validate && ';

export interface EnvEntry {
  key: string;
  value: string;
}

/**
 * Get the project root by walking up from the script's location.
 * Traverses parent directories until it finds package.json.
 * Skips envguard's own package.json (inside node_modules).
 */
export function getProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) { // stop at filesystem root
    if (existsSync(resolve(dir, 'package.json'))) {
      // Skip if we're inside envguard package (node_modules/@scope/pkg/)
      if (dir.includes('node_modules')) {
        dir = dirname(dir);
        continue;
      }
      return dir;
    }
    dir = dirname(dir);
  }
  return dir;
}

/**
 * Check if envguard is installed in the project.
 * Handles both unscoped (envguard) and scoped (@ankitpandey2708/envguard) packages.
 */
export function isEnvguardInstalled(): boolean {
  const projectRoot = getProjectRoot();
  return (
    existsSync(resolve(projectRoot, 'node_modules', 'envguard')) ||
    existsSync(resolve(projectRoot, 'node_modules', '@ankitpandey2708', 'envguard'))
  );
}

export const ENV_FILE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.prod',
];

/**
 * Scan a directory for standard .env file names.
 * Returns absolute paths for files that exist.
 */
export function scanEnvFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of ENV_FILE_PATTERNS) {
    const path = resolve(dir, name);
    if (existsSync(path)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Read, parse, and return the full package.json object.
 * Returns undefined if the file doesn't exist or can't be parsed.
 */
export function readPackageJson(pkgPath: string): Record<string, unknown> | undefined {
  if (!existsSync(pkgPath)) return undefined;

  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function parseEnvFile(filePath: string): EnvEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const entries: EnvEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    entries.push({ key, value });
  }

  return entries;
}