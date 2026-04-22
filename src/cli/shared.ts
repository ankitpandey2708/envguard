import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Get the project root by walking up from the script's location.
 * Traverses parent directories until it finds package.json.
 * Robust against file structure changes.
 */
export function getProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) { // stop at filesystem root
    if (existsSync(resolve(dir, 'package.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  // Fallback: return current directory if no package.json found
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