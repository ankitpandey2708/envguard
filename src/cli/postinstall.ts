import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD_PREFIX = 'envguard validate && ';

// Get project root from the script's location (node_modules/@scope/pkg/dist/cli/postinstall.js)
function getProjectRoot(): string {
  // Go up: postinstall.js -> dist/cli -> @scope/pkg -> node_modules -> project root
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export function updateBuildScript(): void {
  const projectRoot = getProjectRoot();

  // Skip if we're developing envguard itself (no node_modules/envguard or scoped version)
  const isInstalled =
    existsSync(resolve(projectRoot, 'node_modules', 'envguard')) ||
    existsSync(resolve(projectRoot, 'node_modules', '@ankitpandey2708', 'envguard'));
  if (!isInstalled) {
    return;
  }

  const pkgPath = resolve(projectRoot, 'package.json');
  
  if (!existsSync(pkgPath)) {
    return;
  }

  let pkg: { scripts?: Record<string, string>; name?: string };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return;
  }

  if (!pkg.scripts) {
    return;
  }

  const buildScript = pkg.scripts['build'];
  
  if (!buildScript) {
    return;
  }

  // Already has the guard
  if (buildScript.startsWith(GUARD_PREFIX)) {
    return;
  }

  // Update the build script
  pkg.scripts['build'] = GUARD_PREFIX + buildScript;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  
  console.log('[envguard] ✓ Added envguard validate to build script');
}