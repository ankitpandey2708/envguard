import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD_PREFIX = 'envguard validate && ';

// Get project root from the script's location (node_modules/@scope/pkg/dist/cli/postinstall.js)
function getProjectRoot(): string {
  // Go up: postinstall.js -> dist/cli -> @scope/pkg -> node_modules -> project root
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export function removeBuildScriptGuard(): void {
  const projectRoot = getProjectRoot();

  // Only run if envguard was just uninstalled (no longer in node_modules)
  const isStillInstalled =
    existsSync(resolve(projectRoot, 'node_modules', 'envguard')) ||
    existsSync(resolve(projectRoot, 'node_modules', '@ankitpandey2708', 'envguard'));
  if (isStillInstalled) {
    return;
  }

  const pkgPath = resolve(projectRoot, 'package.json');
  
  if (!existsSync(pkgPath)) {
    return;
  }

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return;
  }

  if (!pkg.scripts) {
    return;
  }

  const buildScript = pkg.scripts['build'];
  
  // Only remove guard if it exists
  if (!buildScript || !buildScript.startsWith(GUARD_PREFIX)) {
    return;
  }

  // Remove the guard prefix
  pkg.scripts['build'] = buildScript.slice(GUARD_PREFIX.length);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  
  console.log('[envguard] ✓ Removed envguard validation from build script');
}