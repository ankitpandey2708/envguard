import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProjectRoot, isEnvguardInstalled } from './shared.js';

const GUARD_PREFIX = 'envguard validate && ';

export function updateBuildScript(): void {
  // Skip if we're developing envguard itself (no node_modules/envguard or scoped version)
  if (!isEnvguardInstalled()) {
    return;
  }

  const projectRoot = getProjectRoot();
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

// Run when script is executed directly
updateBuildScript();