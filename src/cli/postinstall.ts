import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const GUARD_PREFIX = 'envguard validate && ';

export function updateBuildScript(): void {
  // Skip if we're developing envguard itself (no node_modules/envguard or scoped version)
  const isInstalled =
    existsSync(resolve(process.cwd(), 'node_modules', 'envguard')) ||
    existsSync(resolve(process.cwd(), 'node_modules', '@ankitpandey2708', 'envguard'));
  if (!isInstalled) {
    return;
  }

  const pkgPath = resolve(process.cwd(), 'package.json');
  
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