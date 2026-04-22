import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const GUARD_PREFIX = 'envguard validate && ';

export function removeBuildScriptGuard(): void {
  // Only run if envguard was just uninstalled (no longer in node_modules)
  if (existsSync(resolve(process.cwd(), 'node_modules', 'envguard'))) {
    return;
  }

  const pkgPath = resolve(process.cwd(), 'package.json');
  
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