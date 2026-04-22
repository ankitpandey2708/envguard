# Publishing to npm

This guide covers manual publishing of the `envguard` package to the npm registry.

## Prerequisites

1. **npm account** at [npmjs.com](https://www.npmjs.com)
2. **Logged in locally** — run `npm login` once on your machine
3. **Package name**: Using scoped name `@ankitpandey2708/envguard`

## Version Bumping Strategy

Uses [Semantic Versioning](https://semver.org/):
- `npm version patch` — Bug fixes (1.0.0 → 1.0.1)
- `npm version minor` — New features, backward compatible (1.0.0 → 1.1.0)
- `npm version major` — Breaking changes (1.0.0 → 2.0.0)

## Publishing Steps

### First Time Publishing

```bash
# 1. Build the project
npm run build

# 2. Check package name is available (replace 'envguard' if needed)
# https://www.npmjs.com/package/envguard

# 3. If name taken, edit package.json and add a scope:
#   name: @yourusername/envguard

# 4. Login to npm (if not already)
npm login

# 5. Publish
npm publish
```

### Subsequent Releases

```bash
# 1. Make your code changes and commit
git add .
git commit -m 'feat: add new provider'

# 2. Bump version (choose one)
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes

# 3. Build before publishing
npm run build

# 4. Publish to npm
npm publish

# 5. Push commits and tags to GitHub
git push
git push --tags
```

## Verification

```bash
# Check published version
npm view envguard

# Install locally to test
npm install envguard

# Run the CLI
npx envguard
```

## Pre-publish Checklist

- [ ] Run tests (`npm run test`)
- [ ] Run linter (`npm run knip`)
- [ ] Verify `README.md` is complete
- [ ] Check `package.json` metadata is accurate
- [ ] Ensure no secrets in `dist/` folder

## Unpublishing (if needed)

```bash
# Remove a published package (within 72 hours)
npm unpublish envguard@1.0.0

# Or unpublish entire package
npm unpublish envguard --force
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `E403` - Package name taken | Change name in `package.json` or use scoped name |
| `E401` - Not authenticated | Run `npm login` |
| `ENEEDAUTH` - Token issue | Delete `~/.npmrc` and re-login |
| Build errors | Run `npm run build` and fix TypeScript errors |

## Notes

- Package is configured with Node.js `>=20` requirement
- Builds to `dist/` folder with TypeScript declarations
- CLI binary exposed as `envguard` command