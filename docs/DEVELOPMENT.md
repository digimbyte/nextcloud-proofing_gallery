# Development guide

## Setup

Copy `.env.example`, install Node and Composer dependencies, then run
`make dev-up`. Compose starts Nextcloud 35, MariaDB, Redis, cron, and Mailpit.
The repository is mounted as `custom_apps/proofing_gallery`.

Build assets after changing Vue or CSS:

```bash
npm run build
```

When localized source strings were added or changed, run `npm run build:l10n`
before the regular build. The localization build extracts every `t()`/`n()`
source key and fails when a German translation is missing. Edit
`scripts/build-l10n.mjs`; generated files in `l10n/` are release inputs.

The app source remains bind-mounted during development. After changing public
PHP routes, templates, or controller constructors, run
`docker compose restart nextcloud` to clear PHP OPcache before validating the
change.

## Persistent remote test tenant

A Docker-capable Linux VM can be used as a persistent manual-QA tenant when
Docker is not installed on the editing workstation. Keep source and build
dependencies in a staging directory outside the live Nextcloud Compose tree.
Build and test in disposable containers, then copy only a successful runtime
tree into the tenant's `custom_apps/proofing_gallery` directory.

Before deployment, record `occ status`, the enabled-app list, migration state,
and container health. Keep the previous app directory only during the immediate
HTTP, `occ`, log, and browser checks. Restore it only if that deployment fails;
delete it as soon as the replacement passes so the development tenant retains
only the latest verified app build. Never reset the tenant's Compose volumes as
part of an app deployment.

Keep rollback copies outside `custom_apps`; Nextcloud scans every directory in
that path and a backup containing the same app ID can cause duplicate-app
discovery. App Store packages intentionally omit development-only `scripts/`,
so run migration diagnostics from the source staging tree rather than assuming
they are installed with the runtime package.

The persistent tenant is for manual integration and browser QA only. Do not
run this repository's Playwright global setup against it: the current E2E
fixtures assume the disposable `admin` / `admin` tenant, rewrite that user's
preferences, and remove prior `E2E` fixtures. Use `npm run test:e2e` only with
the repository's isolated loopback Compose stack, or refactor the harness for
a dedicated test identity before targeting another tenant.

For frontend-only UI work, a persistent pinned Node container may run
`npm run watch` against the staging checkout. Run the affected Vitest files
during each small iteration and copy only generated `build`, `css`, and `js`
assets into the installed development app. Stable entry assets must be served
without long-lived caching on that development host so a refresh discovers
new content-hashed chunks. Run the complete lint, unit, build, package, PHP,
and compatibility gates at milestones and before publication. Never use the
frontend-only path for PHP, routes, migrations, or dependency changes.

Machine-specific addresses, SSH key locations, credentials, and deployment
commands belong in an ignored local runbook under `.local/`, never in tracked
documentation.

## Documentation sources and builds

The English and German user and administrator guides under `docs/en/` and
`docs/de/` are the canonical content sources. Vite compiles those four Markdown
files into the offline **Help** view and administrator settings. The same files
are rendered into the GitHub Pages site by `npm run build:docs`. The repository
root `docs/USER-GUIDE.md` is an intentionally synchronized English mirror for
existing links and must remain byte-identical to `docs/en/user-guide.md`.

Run the non-mutating documentation checks before committing content changes:

```bash
npm run check:docs
npm run build:docs
```

The checker validates required bilingual guides, local Markdown links, the
synchronized mirror, and the declared screenshot thumbnail pairs. Technical
documents remain repository documentation; only the public overview, language
overviews, user/admin guides, and English development landing page are built as
GitHub Pages routes.

## Persistent demo studio

The regular E2E tenant is disposable test infrastructure. For visual QA,
product demos, and App Store screenshots, use the separate persistent studio:

```bash
make studio-up
make studio-doctor
make studio-library-check
make studio-seed
make studio-browser-check
make studio-screenshots
make studio-screenshot-pairs
```

It uses an isolated Compose project and named volumes, serves only on
`127.0.0.1:8081`, and keeps its galleries across `studio-down`/`studio-up`.
Defaults are `studio` / `studio-demo`; local overrides belong in the ignored
`.env.studio`. `studio-reset` removes only studio volumes and requires
`CONFIRM_STUDIO_RESET=yes`.

The disposable development stack intentionally follows current image tags;
use `make dev-pull` to refresh it. The persistent Studio reads reviewed
linux/amd64 digests from `.env.studio.images`. `make studio-refresh` pulls and
recreates those containers while preserving volumes. It never applies pending
app migrations: inspect them with `make studio-migration-status`, apply them
explicitly with `make studio-migrate`, then use `make studio-doctor` to inspect
image provenance, versions, schema state, projection progress, and cron jobs.

Generated demo images live in the ignored `.local/demo-library/` directory.
Their prompts, dimensions, provenance, and checksums are versioned in
`demo/library-manifest.json`. The seeder refuses non-loopback URLs and is
idempotent: gallery IDs and public tokens remain stable. Approved screenshots
are copied to `docs/public/screenshots/`; local source media never enters the
App Store archive.

Screenshot capture is a separate reviewed phase: use only seeded fictional data,
inspect rendered desktop and mobile results with DevTools/CDP, and update
`appinfo/info.xml` only after the approved full-size and thumbnail pairs are
present. `studio-screenshots` writes the complete candidate matrix to
`.local/screenshot-candidates/`; `studio-screenshot-pairs` copies only the
approved names (or `SCREENSHOT_NAMES="..."` supplied names) into the tracked
App Store asset directory and generates the matching thumbnails.

## Quality checks

```bash
npm run lint
npm test
composer lint
composer test
npm run test:e2e
make test-compat
```

Keep automated tests focused on access and privacy boundaries, data integrity,
core gallery workflows, and failure cases that are difficult to verify manually.
Do not add standalone tests for fixed labels, CSS classes, presentation defaults,
trivial mappings, or behavior already adequately covered by another test.
Use the smallest useful layer: domain tests for algorithms and policy rules,
component tests for asynchronous state and draft preservation, and Docker-backed
tests for Nextcloud, storage, database and browser integration. A security test
must exercise behavior or actual output; searching source code for a string does
not establish a privacy or authorization guarantee.

`npm run test:e2e` prepares only the repository's running loopback Compose
instance: it resets local brute-force state and disables Nextcloud request
throttling in that disposable development container before Playwright starts.
Remote `NEXTCLOUD_URL` targets and production installations are never changed.
Use `npm run test:e2e:raw` when the target manages its own isolation.

Ordinary E2E runs use Chromium. To run the review viewer in Firefox and WebKit
as well, install their runtimes and opt in explicitly:

```bash
npx playwright install --with-deps chromium firefox webkit
E2E_CROSS_BROWSER=1 npm run test:e2e -- tests/e2e/review-viewer.spec.ts
```

The two `@protected` cases run separately with Nextcloud brute-force and rate
limit protection enabled, and are excluded from ordinary runs:

```bash
E2E_SECURITY_PROTECTIONS=1 npm run test:e2e
```

CI uses Chromium for pull requests and runs the additional review engines in
the weekly and manually dispatched workflows. Ordinary compatibility checks
cover Nextcloud 33 and 35 with SQLite; the weekly/manual checks cover 33–35 on all three databases.
Release installation coverage remains 33–35 on SQLite, MariaDB and PostgreSQL,
and upgrade checks retain all three database families.

### Browser diagnosis

Use Chrome DevTools/CDP before Playwright for fast JavaScript, DOM, and layout
diagnosis. Check Console and Network, computed styles, `getBoundingClientRect()`
geometry, and `elementFromPoint()` hit testing at the affected viewport.

Use an isolated agent-owned browser context and close it completely when the
check is finished. Stale public-share tabs can continue polling deleted tokens,
trigger Nextcloud brute-force protection for the Docker gateway, and eventually
make the shared DevTools protocol time out.

Use Playwright afterward for reproducible acceptance. The standard wrapper
resets loopback and Docker-gateway protections before the run and restores the
original configuration afterward. For public-gallery or culling changes,
verify desktop and 390 px mobile layouts, scroll reachability, horizontal
overflow, media hit testing, rows below the hero, and side and bottom filmstrip
placement inside the viewport.

For feedback panels, test the overflow model rather than requiring every item
to fit at once. A history of 20 or more comments must scroll inside the panel;
headers, comment text, identity labels, edit controls, and the composer must not
be clipped, overlapped, or made unreachable at short viewport heights. Selecting
an image annotation may keep its marker visible for context, but the comment
workflow must remain usable without relying on the marker staying on screen.

Playwright global setup creates and later supersedes its own E2E gallery.
Browser acceptance checks use behavior, geometry, hit testing and accessibility
rather than pixel snapshots. Failure screenshots and traces remain available
in the Playwright report. App Store and documentation screenshots continue to
use the separately reviewed screenshot-studio workflow.

`npm run perf:public` enforces the documented Slow-4G/4× CPU public-gallery
budgets: at most 12 seconds for the first cacheless browser visit and 4 seconds
for the warm median in the same browser context. `LCP_COLD_BUDGET_MS`,
`LCP_WARM_BUDGET_MS`, and `LCP_ROUNDS` are
available for explicit diagnostic runs; release validation uses the defaults.

The compatibility harness uses isolated Compose project names and deletes only
containers, networks, and volumes it created. Restrict a local run with, for
example, `NEXTCLOUD_VERSIONS=34 DATABASES=sqlite`.

### Nextcloud integration compatibility

The optional ecosystem adapters must remain load-safe on every supported
Nextcloud release. Run the compatibility harness across Nextcloud 33–35 before
changing registration code, and cover the current server with Docker-backed
tests for Files actions/sidebar, capabilities, OCS response envelopes, Search,
Dashboard, Projects, Flow, and optional Context Chat registration. The
Nextcloud 33 boundary selects the modern Files client API; older supported
servers use the legacy adapter.

The curated agent contract lives under `/api/v1/agent` in the app's OCS route
table. New mutations must be current-user scoped, idempotent, revision-safe,
auditable, and reversible. Do not add password reads, guest PII, arbitrary file
access, permanent deletion, or administrative impersonation. Update the PHP
contract tests and `integrations/context_agent/proofing_gallery.py` together.

Context Agent integrations are distributed as upstream Python modules, not as
an independently privileged MCP daemon. Compile-check the module with
`python3 -m py_compile integrations/context_agent/proofing_gallery.py`; never
commit its generated `__pycache__` directory.

### Context Agent manual gate

The deterministic contract suite is dependency-light and should run on every
change to the upstream module:

```bash
./scripts/test-context-agent.sh
```

Before updating the upstream Context Agent pull request, also run the isolated
live gate against the loopback studio:

```bash
make context-agent-eval-up
make context-agent-eval
make context-agent-eval-down
```

The first setup downloads a 4.6 GiB quantized Llama model into the ignored
`.local/context-agent-eval/` cache. Context Agent 2.8.0 and LLM2 2.8.0 are
digest-pinned, the model URL is commit-pinned and SHA-256 checked, and only the
studio Docker network is used. The gate verifies the real MCP `tools/list`
schemas, English and German tool selection, the distinction from unified
Nextcloud search, complete gallery lists, media search, injected-text handling,
an explicit read-only response to publish requests, and an unchanged gallery
snapshot. Synthetic traces are written to the ignored
`.local/context-agent-eval/latest-results.json`; inspect them before treating
the manual gate as passed.

The evaluator limits active Context Agent categories to Proofing Gallery and
Nextcloud unified search so routing remains competitive without spending most
of the local model context on unrelated tools. Teardown unregisters only the
two evaluator ExApps and daemon entries and removes their containers; it never
removes studio volumes or the model cache. LLM2 2.8.0 currently declares
Python 3.10 support while using `asyncio.TaskGroup`; the stack script records
and applies a local runtime compatibility shim so the published image can be
used for this gate without modifying its application code.

## Database changes

Point replies use `parentId` referencing a root comment in the same gallery,
file and visible feedback scope. Nested replies and foreign/private roots are
rejected. The server copies the root annotation; client-supplied reply coordinates
are not authoritative. Responses expose `threadId` independently of coordinates,
so coincident pins remain distinct. Deleted roots retain a text-free tombstone
while replies survive, including when their original author is deleted.

Add a new monotonically increasing migration; do not modify released
migrations. Use Nextcloud's schema abstraction exclusively and rerun all three
database engines. Keep controllers thin and put authorization and domain rules
in services or dedicated domain objects.

The persistent screenshot studio never applies pending app migrations
implicitly. Inspect it with `./scripts/studio-stack.sh migration-status` and,
after reviewing the result, apply them explicitly with `./scripts/studio-stack.sh
migrate`. `studio-stack.sh up` stops when bind-mounted code is newer than the
persistent database schema.

## Release

Set the same semantic version in `appinfo/info.xml`, `package.json`, and
`package-lock.json`, update the changelog, then run `make verify-package`.
Run `make test-upgrade` as well when a release adds database migrations. The
release gate downloads the matching published package and `SHA256SUMS`, verifies
the checksum, and tests preserved galleries against the current package in an
isolated Nextcloud 34 instance without importing the sanitized public Git
history into the internal repository.
Signing is performed afterward with the maintainer's Nextcloud certificate and
private key outside this repository. `make appstore` remains the credential-free
unsigned build. Once the official certificate is available, use
`make verify-signed-package` with `APP_PRIVATE_KEY_FILE` and
`APP_PUBLIC_CRT_FILE`; see the [App Store publishing runbook](APPSTORE-PUBLISHING.md).

Metadata changes must retain the public allowlist boundary, source-ETag binding,
1 MiB sidecar limit, DTD/network rejection, and preservation of unknown XMP
namespaces. Test both clean sidecar creation and merges with third-party fields.

### Supported server versions

Proofing Gallery supports Nextcloud 33–35. PHP 8.2.36 remains the app minimum;
Nextcloud 35 itself requires PHP 8.3 or later. Use only PHP versions supported
by the installed Nextcloud release; the PHP 8.6 unit job is a forward check,
not a claim that every server supports it.

New development instances use Nextcloud 35. Before starting an existing 34
instance with the new defaults, set `NEXTCLOUD_IMAGE=nextcloud:34-apache` in
its ignored `.env` (or `.env.studio` for Studio). Upgrade persistent servers
separately with backups; never reset volumes to change server versions.

Run `UPGRADE_DATABASE=sqlite ./scripts/test-server-upgrade.sh` to test a real
34 → 35 server upgrade. The script owns and removes its isolated volumes.
It preserves original files, galleries, public links and feedback. Existing
`make test-upgrade` tests remain on 34 so released app baselines can install.

PR compatibility checks cover 33/35 with SQLite; weekly/manual and release
checks cover 33/34/35 with SQLite, MariaDB and PostgreSQL. Browser suites use
35, with focused integration and gallery checks on 33/34.
