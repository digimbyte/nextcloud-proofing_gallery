# Dependency maintenance

## Routine update groups

Weekly npm patch and minor version updates use two groups: `npm-runtime` for
production dependencies and `npm-development` for development dependencies.
Runtime updates, including Vue, require manual review. Development, Composer
development and safe GitHub Actions groups remain eligible for squash
auto-merge after the required checks pass. Major updates require manual review;
Ionic packages and Vitest packages each retain a coordinated major-update group.
The seven-day cooldown applies to version updates, not security updates.

Review dependency updates in the internal tree as well as public GitHub history
before preparing a sanitized export, so an export cannot undo a merged update.
For frontend runtime updates, verify gallery and culling layouts on desktop and
at 390 px, including image reachability, filmstrips and reduced motion.

## November 2026 maintenance

The November 17 refresh updates the compatible npm patch/minor dependencies
and Composer development packages within their existing version ranges. It
also adopts fast-xml-parser 5.12.1 and jsdom 31.0.1, incorporating the pending
Dependabot parser and jsdom updates on the retained Node 24.22.1 baseline.
Stylelint remains on 17: `@nextcloud/stylelint-config` 3.2.2 requires
`stylelint ^17.9.1`, so the Stylelint 18 update must wait for a compatible
Nextcloud configuration. Vite 7, TypeScript 6.0, DBAL 3, PHPUnit 11 and the
`dev-stable33` OCP branch retain the project's compatibility baselines.

Keep the scoped `stylelint-config-recommended-vue` → `stylelint-config-html`
1.1.0 override while the Vue configuration requires `postcss-html ^1.0.0`.
Its open-ended HTML configuration range otherwise selects version 2, which
requires `postcss-html ^2.0.0` and makes the peer dependency tree inconsistent.
Remove this override once the upstream configuration supports a consistent
combination, and verify a clean `npm ci` before adoption.

The follow-redirects 1.16.2 update resolves GHSA-mrwp-f3q8-3g9p.
Minimatch 11.0.4 resolves GHSA-g3hv-75wg-m249 across runtime and development
consumers. A global exact override replaces the earlier WebDAV-only 10.2.6
override so nested copies cannot retain the vulnerable implementation.

Minimatch 11 changes its parsed matcher representation and removes legacy APIs
including `makeRe`. The scoped js-beautify override therefore selects Glob
14.0.3, which supports Minimatch 11; forcing Glob 13 onto the new matcher is
not supported. Node 24.22.1 satisfies both packages' engine requirements.
Remove these overrides once the parent packages support the fixed versions.
The dependency compatibility tests cover each consumer's resolution, bounded
level-two preprocessing, WebDAV basename filtering, Glob file discovery and
EditorConfig matching. Full frontend gates additionally exercise ESLint and
the TypeScript tooling. No advisory exemptions are added.

The app requires PHP 8.2.36 or newer, with Composer resolving against that exact
minimum. PHPUnit 11 is the newest major compatible with PHP 8.2. Keep the OCP
stubs on `dev-stable33` and DBAL on 3.x to continue checking the oldest supported
Nextcloud API. Refresh Roave advisories without ignoring its PHP conflicts.
Installations with an older PHP version must upgrade PHP before updating the
app; Nextcloud 33–35 remain supported.

## October 2026 maintenance

The security refresh combines the markdown-it 15.0.3 and follow-redirects
1.16.1 fixes with DOMPurify 3.4.17 and fast-uri 3.1.9. The latter packages
remain transitive dependencies; their parents already allow these fixed
versions. Keep the production audit free of findings and do not add advisory
exceptions to the full audit.

The October frontend toolchain adopted jsdom 30 and TypeScript 6.0.3 on the
retained Node 24.22.1 baseline. The unused `baseUrl` option was removed instead
of suppressing its deprecation. Dependabot may update jsdom normally, while
TypeScript 6.1 and later remain excluded until the Vue and lint tooling support
them. The stable
Nextcloud Vite configuration still requires Vite 7; do not adopt the Vite 8
configuration while it is only available as a prerelease.

## Guarded Braces development dependency

The CSS tooling previously installed `braces` 3.0.3, affected by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
There is no advisory exception in the audit gate. Its implementation is replaced
by `@dieub/braces-depth-guard` 3.0.3-pn.3, a third-party MIT-licensed derivative,
through a private CommonJS adapter. This is a reviewed implementation change,
not an official upstream fixed release or a scanner exemption.

The original registry tarball is retained unchanged under `tooling/vendor`.
Its SHA-256 is
`bfddf5527888add524fb533818cd5c56ed66e9d0454705e1a4ef002de9905227`.
The registry SHA-512 integrity, signatures and GitHub OIDC provenance were
verified with `npm audit signatures` before adoption. Every packaged file
matches source commit
[`305a2e4bfe324bb53c336c1b03387ee1251c926f`](https://github.com/dieub/braces-depth-guard/commit/305a2e4bfe324bb53c336c1b03387ee1251c926f),
published by [workflow run 37222647499](https://github.com/dieub/braces-depth-guard/actions/runs/37222647499).
The original MIT license and package identity remain in the archive. It has no
installation lifecycle scripts. Clean installations use the retained tarball;
never substitute new bytes under its current filename or version.

The review covered the changes against upstream 3.0.3: parser and recursive AST
depth limits, option validation, and parent-cycle rejection. The 764 unchanged
upstream tests passed against the installed replacement, as did the derivative's
799-test suite. `npm run test:dependencies` runs on every preflight and checks
archive integrity, consumer resolution, depth 100/101 and excessive nesting,
fractional limits, cyclic parent links, ordinary ranges/escapes and micromatch
compatibility. All consumers must resolve the adapter and the canonical guarded
implementation; an original registry Braces installation is rejected.

The guards bound nesting to 100, not expansion cardinality, AST width, acyclic
parent-chain length, or arbitrary object getters. The application's consumers
are development-time glob tools. These limits do not justify accepting arbitrary
user-controlled glob or AST input in the app.

The differently named derivative is not automatically matched by advisories
against upstream Braces. Review upstream advisories and releases weekly and
before any release, record applicable findings in the issue tracker, and compare
them with the retained implementation. Monitor
[upstream issue 70](https://github.com/micromatch/braces/issues/70) and published
registry releases. Once an official fixed release passes the same regression,
consumer and frontend gates, remove the adapter, archive and override together.
Do not infer security from a green scanner alone.

## Declaration tooling and crypto polyfills

Keep the scoped `@nextcloud/vite-config` → `vite-plugin-dts` 5.1.2 override until
the upstream configuration adopts the optional API Extractor dependency itself.
Its removal must not bring back `sprintf-js` or API Extractor. Review with a
clean install, lockfile inspection, audit, frontend gates and public CI.

The remaining Elliptic low advisory is inherited through the Vite configuration's
browser polyfills. Monitor a compatible upstream replacement without forced
major overrides. Production dependencies must continue to pass the audit without
findings. The development-only `pbkdf2` dependency is patched to 3.1.7.

## Server support policy

Support regularly maintained Nextcloud community releases. After upstream EOL,
raise the minimum in the next feature release and announce it in the changelog.
No separate legacy maintenance branch is planned. Review Nextcloud 33 support
in February 2027. Existing published packages remain available.
