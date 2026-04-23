import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProjectRoot, isEnvguardInstalled, GUARD_PREFIX, readPackageJson } from './shared.js';

export function updateBuildScript(): void {
  // Skip if we're developing envguard itself (no node_modules/envguard or scoped version)
  if (!isEnvguardInstalled()) return;

  const projectRoot = getProjectRoot();
  const pkgPath = resolve(projectRoot, 'package.json');
  const pkg = readPackageJson(pkgPath);

  if (!pkg) return;

  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (!scripts) return;

  const buildScript = scripts['build'];
  if (!buildScript) return;

  // Already has the guard
  if (buildScript.startsWith(GUARD_PREFIX)) return;

  scripts['build'] = GUARD_PREFIX + buildScript;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// Run when script is executed directly
updateBuildScript();