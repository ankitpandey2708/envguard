import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Get the project root by walking up from the script's location.
 * Script location: node_modules/@scope/pkg/dist/cli/shared.js
 * Walks up: shared.js -> dist/cli -> dist -> @scope/pkg -> node_modules -> project root (5 levels)
 */
export function getProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
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