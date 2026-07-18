# Releasing Parallm

Publishing is performed by [the npm release workflow](.github/workflows/publish.yml) when a maintainer publishes a GitHub release. The workflow verifies the release tag, runs the complete quality and package gates, audits production dependencies, and publishes with provenance. Stable releases use npm's `latest` tag; GitHub prereleases use `next`.

## One-time bootstrap

The npm package must already exist before npm will accept a trusted-publisher configuration. Use a short-lived token for the first release only:

1. Enable two-factor authentication on the npm maintainer account and confirm that the unscoped `parallm` name is still available.
2. Enable GitHub private vulnerability reporting.
3. In the GitHub repository, create an environment named `npm`. Restrict deployments to protected `v*` tags and add required reviewers if desired.
4. Create a short-lived [granular npm access token](https://docs.npmjs.com/creating-and-viewing-access-tokens/) with read/write access to all packages and **Bypass 2FA** enabled. Access to all packages is needed only because `parallm` does not exist yet.
5. Store that token as an environment secret named `NPM_TOKEN` on the GitHub `npm` environment.
6. Prepare and publish the first GitHub release using the checklist below.
7. After the first version appears on npm, configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with these exact values:

   | Setting | Value |
   | --- | --- |
   | Provider | GitHub Actions |
   | Organization or user | `higherbros` |
   | Repository | `parallm` |
   | Workflow filename | `publish.yml` |
   | Environment | `npm` |
   | Allowed action | `npm publish` |

8. Delete the `NPM_TOKEN` GitHub environment secret and revoke the granular token on npm.
9. In the npm package settings, select **Require two-factor authentication and disallow tokens**.

All later releases authenticate through GitHub OIDC. The workflow's `id-token: write` permission is intentionally limited to the publish job, and npm automatically links the public package to its public source through provenance.

## Prepare a release

1. Update the version in `package.json` and release notes as needed. Use a SemVer prerelease version such as `0.2.0-beta.1` only for a GitHub release marked as a prerelease.
2. Confirm the working tree contains only intended release changes.
3. Install exactly the locked dependencies and run the complete local gate:

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
6. Commit the version and release-note changes, merge them to `main`, and wait for CI to pass.

## Publish

1. On GitHub, create a release targeting the release commit on `main` with the tag `v<package.json version>`; for example, package version `0.1.0` must use tag `v0.1.0`.
2. Mark the GitHub release as a prerelease if and only if the package version contains a SemVer prerelease suffix.
3. Publish the GitHub release and approve the `npm` environment deployment if protection rules require it.
4. Wait for the **Publish to npm** workflow to finish. Do not publish the same version manually after the workflow has started.
5. Verify installation from the registry in a new temporary directory.

An npm version cannot be overwritten. If publication fails after npm has accepted the version, bump the package version and create a new release rather than retrying with altered contents.
