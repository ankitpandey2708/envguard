import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProjectRoot, isEnvguardInstalled } from './shared.js';

const GUARD_PREFIX = 'envguard validate && ';

export function removeBuildScriptGuard(): void {
  // Only run if envguard was just uninstalled (no longer in node_modules)
  if (isEnvguardInstalled()) {
    return;
  }

  const projectRoot = getProjectRoot();
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

}

// Run when script is executed directly
removeBuildScriptGuard();