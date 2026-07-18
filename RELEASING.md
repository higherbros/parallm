# Releasing Parallm

This checklist separates repository preparation from the external actions that make a release public.

## One-time setup

1. Make the GitHub repository public when the project is ready to announce.
2. Enable GitHub private vulnerability reporting.
3. Confirm control of the `parallm` package name on npm.
4. Require two-factor authentication or configure npm trusted publishing for releases.

## Prepare a release

1. Update the version in `package.json` and release notes as needed.
2. Confirm the working tree contains only intended release changes.
3. Install exactly the locked dependencies and run the complete gate:

   ```bash
   pnpm install --frozen-lockfile
   pnpm run test:all
   pnpm run smoke:package
   pnpm audit --prod
   ```

4. Run one authenticated end-to-end comparison from the built CLI:

   ```bash
   node dist/cli/bin.js run "Reply with exactly PARALLM_SMOKE_OK." \
     --target codex:default@low \
     --target codex:default@medium \
     --timeout 90s \
     --format json
   ```

5. Verify both attempts succeeded, returned the expected output, and contain no unexplained diagnostics.
6. Review the packed file list and package metadata before publishing.

## Publish

Publishing changes external state and should be performed intentionally by a maintainer:

```bash
npm publish
```

The `prepublishOnly` script reruns type checking, tests, coverage, build, and the clean packed-install smoke test. After npm confirms the package, create and push the matching Git tag and GitHub release, then verify installation from the registry in a new temporary directory.
