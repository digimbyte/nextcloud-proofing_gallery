# Administrator guide

This guide covers installation and operation of Proofing Gallery.

New-gallery defaults include filename, capture date, last modified date and file size, plus direction. These settings are copied on creation; existing galleries change only through an explicit owner action or rollout. The health view reports ready, pending and failed capture-date projections. The recoverable metadata background job processes at most `metadataBatchSize` files per invocation and obeys `metadataMaxBytes`. A media-index rebuild requeues failed projections. No public request extracts image bytes for sorting.

## Requirements and installation

- Nextcloud 33–35
- PHP 8.2.36–8.6 and the extensions required by Nextcloud; GD is needed for
  watermarked previews and contact sheets
- SQLite, MariaDB/MySQL, or PostgreSQL
- Nextcloud cron, plus a configured mail transport when invitations or email
  notifications are enabled

Nextcloud 35 requires PHP 8.3 or later. Nextcloud 31/32 no longer receive app updates. Upgrade the server one major version at a time to at least 33 before updating the app. Only PHP versions supported by the installed server are supported.

Verify the downloaded `proofing_gallery.tar.gz` against `SHA256SUMS` and its
GitHub artifact attestation. Extract it so the final directory is
`custom_apps/proofing_gallery`, then run:

```bash
sudo -u www-data php occ app:enable proofing_gallery
sudo -u www-data php occ background:cron
```

Back up database, data directory, configuration, and appdata before upgrades.
Nextcloud runs app migrations while enabling or upgrading. Do not skip supported
Nextcloud server upgrade steps.

### Recover a failed 0.9.0 upgrade

If a 0.9.0 upgrade left Nextcloud in maintenance mode, keep maintenance mode
enabled and back up the database, `config/`, data directory, and appdata. Install
the verified signed 0.9.1 archive by replacing only
`custom_apps/proofing_gallery`; do not uninstall the app or delete its tables,
jobs, galleries, links, or feedback. Restart the AIO Nextcloud container or the
PHP workers to clear OPcache, then run from the Nextcloud root:

```bash
sudo -u www-data php occ upgrade
sudo -u www-data php occ status --output=json
sudo -u www-data php occ app:list --output=json
```

Recovery is complete when `maintenance` and `needsDbUpgrade` are both `false`
and Proofing Gallery reports version 0.9.1. If the retry fails, leave maintenance
mode enabled, retain the backup and logs, and investigate the new error.

## Access and policy

Administration settings → Additional settings → Proofing Gallery controls which
groups may create or publish, feature availability, gallery defaults, branding,
media services, resource limits, and retention. Instance policy is enforced on
the server, including existing galleries where a capability must fail closed.
Native Nextcloud sharing, password, expiration, and upload restrictions remain
authoritative; this app never weakens them.

**Client star ratings and pick or reject** controls both private star ratings
and photo decisions. It is enabled by default on new installations. Upgrades
retain the previous instance choice, including the former implicit disabled
default. This administrative permission allows gallery owners to enable the
features; gallery and public-link settings still determine their actual use.
Blocked feedback controls explain the restriction to owners.

Public reviewers may use guest identities or existing signed-in Nextcloud
accounts. Account UIDs establish authorship, not additional permissions. Earlier
guest contributions are not reassigned by matching names or email addresses.
Private feedback stays private to its author and authorized gallery managers;
owner changes to an account's selection are delivered only to the permitted
review audience. Guest uploads remain a separate guest-only workflow.

The account-attribution migration retains the highest-ID duplicate account
feedback row before adding uniqueness constraints; guest comments and pins are
not reassigned. A subsequent migration adds a nullable event recipient UID so
owner attribution remains distinct from private account delivery. Complete the
normal database upgrade before serving the new application code.

Review public-link, mail, and group policy before onboarding users. Keep guest
downloads and uploads disabled unless required. Set limits according to PHP,
proxy, storage, and worker capacity rather than relying on browser validation.

The administration UI is divided into **General**, **Media**, **Security**, and
**Operations**. General contains access policies, feature switches, groups,
branding, and defaults for new projects. Media contains video processing and
local or external media search. Security contains upload and delivery limits,
Live Push, custom-domain requests, and the optional Files Retention handoff.
Operations contains health, maintenance, domain approval, and the offline admin
documentation.

The effective public capability is the intersection of the instance policy,
gallery settings, public-link policy, and— for event delivery—the release-wave
policy. A more permissive setting at a lower level cannot override a disabled
instance feature. Existing galleries keep their settings when new defaults are
changed.

## Nextcloud ecosystem integrations

Proofing Gallery integrates with the surrounding Nextcloud workspace while
keeping Files as the authority for file access:

- **Files** adds an “Open or create customer gallery” folder action and a
  sidebar tab. The app also publishes privacy-minimal Files metadata: whether a
  folder is a gallery source plus coarse gallery and workflow states. It does
  not store gallery names, public links, guest details, or internal IDs there.
- **Unified Search** finds galleries the current user owns or directly manages.
  **Smart Picker** reference previews use the same authorization boundary.
- **Dashboard** lists galleries that need attention, such as recent review
  feedback or an incomplete delivery workflow.
- **Projects** can link an authorized gallery as a native collaboration
  resource. Removing a project relation never deletes or unpublishes a gallery.
- **Flow** exposes reversible gallery operations such as archive, restore,
  complete, publish, and revoke. Configure them only for narrowly scoped
  workflows; every operation is authorized as the triggering user.
- **Context Chat** is enabled automatically when the optional app and a
  compatible Nextcloud API are present. Only sanitized gallery metadata is
  indexed. Source files, previews, public tokens, guest identities, comments,
  passwords, and private links are excluded.
- **Talk** can create one private review room per client link. The current user
  is its moderator; rooms are never public and can be removed from the review
  panel. Only Talk's conversation ID and URL are stored.
- **Calendar** deadlines and **Deck** cards are user-owned records. A gallery
  purge removes Proofing Gallery's local references but deliberately retains
  those records; users delete them in Calendar or Deck. Talk rooms created by
  the app are removed during a gallery purge before the local reference is
  deleted.

Context Chat and Projects are optional. Their absence must not affect the core
gallery application. After enabling or disabling an optional integration,
restart PHP workers or clear OPcache if your deployment keeps app bootstrap
state in memory.

### Agent and automation API

An authenticated, current-user OCS API is available below
`/ocs/v2.php/apps/proofing_gallery/api/v1/agent`. It offers curated reads and
explicit, reversible mutations. Mutations require an idempotency request ID;
state changes also require the gallery's expected revision. The API deliberately
does not expose public-link passwords, raw guest personal data, permanent
deletion, arbitrary file reads, or administrator impersonation.

The stable OCS agent API is part of the app contract. The repository also
includes an experimental, locally maintained Context Agent tool module at
`integrations/context_agent/proofing_gallery.py`. Install it only through the
Context Agent deployment mechanism appropriate to your Nextcloud environment;
it is not loaded by the PHP app itself. The upstream contribution was closed for
product scope, so this module is optional local integration, not an upstream-shipped
capability. The initial integration is deliberately
read-only: it can list galleries, inspect one gallery, check publishing
readiness, and search gallery filenames. It does not expose guest feedback or
any create, publish, workflow, access, or review mutation. Treat returned
titles, paths, and filenames as untrusted user content, retain Nextcloud audit
logs, and grant the agent no credentials beyond the invoking user's session. A
standalone external MCP server is intentionally unnecessary: the module calls
the same authenticated OCS contract and inherits its authorization boundary.

Useful example prompts include:

- “Which Proofing Galleries are currently published?”
- “Is Editorial Edit ready to publish? Do not change anything.”
- “Find files containing ‘coast’ in the Proofing Gallery ‘The Shoreline Edit’.”

The tool names deliberately include `proofing_gallery` so the model does not
confuse these operations with general Files or Photos searches.

### Event delivery administration

Event projects use one source folder with explicit shared, group, private, or
not-delivered subfolder roles. The owner prepares recipients in the ledger and
publishes a release wave. Each generated link is restricted to the shared roots,
the recipient's group roots, and exactly one private root. Recipient email
addresses and optional PINs are encrypted; plaintext PIN CSV handoff is
available only through the short-lived owner action after release.

Waves can be saved as drafts, scheduled, released immediately, cancelled,
retried for failed recipients, or repaired when a source scope becomes
unavailable. A release is processed in bounded background batches, so cron must
run reliably for large events. Link rotation and invitation resend affect only
the selected recipient. The wave download policy can allow no downloads,
individual files, saved selections, or the complete gallery, but never escapes
the recipient's folder scope.

## Background jobs and monitoring

Run Nextcloud cron at least every five minutes. Monitor Nextcloud logs filtered
for `proofing_gallery`, the failed-jobs list, mail delivery, preview generation,
and the app's **System status** section. It reports bounded operational counts,
cleanup health, upload state, video jobs, semantic indices, notifications, and
preview storage without revealing credentials or user paths.

Periodic jobs are declared in the app manifest and registered by Nextcloud on
install or update; normal web requests must not re-register them. Projection
backfills start only after schema migrations, persist their cursor and retry
state, and resume automatically after a failed batch. The setup check reports
missing periodic jobs, failed projections, and in-progress projection work.

These checks also appear as native setup checks in Administration settings →
Overview. On Nextcloud 33 and newer, `/metrics` exports bounded OpenMetrics
families for lifecycle totals, queues, integration delivery, last cleanup, and
derivative bytes. They contain no user, gallery, file, path, link, or guest
identifiers. Restrict access with `openmetrics_allowed_clients`.

Capacity planning includes source files in Files, temporary resumable chunks,
generated previews, video derivatives, database indices, and accepted uploads.
Cleanup is eventual; reserve headroom for interrupted jobs. Keep database and
appdata backups consistent if feedback, inbox uploads, or generated state matter.

Monitor event releases through the recipient ledger and failed-job list. A
partially failed wave is not an all-or-nothing rollback: successful recipients
remain released and only failed recipients should be retried. Do not treat a
later, more permissive wave as an update to links from an earlier wave.

## Video processing

Install `ffmpeg` and `ffprobe` on every web or cron worker that may process
jobs. Configure a trusted absolute executable path. The app invokes processes
without a shell, bounds source size, duration, output height, concurrency, and
wall time, and writes H.264/AAC derivatives to private appdata. Originals remain
read-only. Failed jobs retry a bounded number of times and stale derivatives are
removed according to retention policy.

If transcoding is disabled or unavailable, browser-compatible MP4/WebM can
still stream. Other formats fail closed with a preparation or unavailable state.

## Metadata, XMP, and semantic search

Metadata indexing reads a bounded allowlist of EXIF/IPTC values and stores
ETag-bound records. XMP writes require writable source folders, create or merge
`<basename>.xmp`, disable external XML entities, enforce a size cap, and stop on
concurrent source or sidecar changes. Disable XMP writes instance-wide if the
workflow is not required.

Semantic search is disabled by default. The local provider uses filenames and a
small descriptive metadata allowlist without transferring previews. The HTTPS
provider is a separate opt-in and must use TLS; administrators must explicitly
allow bounded preview transfer. Originals, GPS, ratings, private keywords, and
credentials are never sent. Validate the provider's retention, access control,
location, availability, and data-processing terms before enabling it.

## Live Push

Live Push is disabled by default. Credentials are scoped to one folder gallery
and optional subfolder and grant upload only—never list, read, or delete. Clients
send an HTTPS `PUT` body to:

```text
/apps/proofing_gallery/live-push/upload?filename=<url-encoded-name>
```

They authenticate with the generated HTTP Basic credentials. Rotate or revoke
credentials independently of public gallery links. The app does not implement
FTP or FTPS; a protocol gateway is outside its security boundary and must
validate TLS, conceal credentials, deny reads, and avoid unsafe logs.

## Custom domains

Custom domains are disabled by default. Activation requires an exact DNS TXT
challenge, a public DNS result, a valid HTTPS endpoint, and administrator
approval. Configure the host as a Nextcloud trusted domain and route it to the
same frontend while preserving the original Host header. Only `/` should enter
the gallery-domain resolver; Nextcloud `/s/`, `/apps/`, `/ocs/`, and static paths
must remain available.

Removing DNS is not revocation. Revoke the mapping or native public link in the
app. Continuous revalidation fails closed when ownership, address, TLS, or the
Nextcloud endpoint becomes stale.

## Collections, storage, and lifecycle

Collections keep ordered file references in the database and an empty native
share anchor under `.proofing-gallery/collections`. Never store user content in
those anchors. Cleanup removes only old, empty, unreferenced anchors that match
the generated naming format. Recursive galleries use a bounded database index
of file identity and sort metadata, never image bytes.

Archived owners can inspect a categorized dry-run, export app records, and
schedule their removal with a 30-day grace period. The staged worker removes
only Proofing Gallery records and private appdata; originals remain in
Nextcloud. System status exposes due purge, lifecycle, guest-session,
media-index, integration, and retention backlogs through indexed counters.

Media counting has a separate persisted projection and is independent of the
media-index limit. Each job examines at most 500 entries and resumes from its
saved cursor; only a complete generation replaces the previous count. The
upgrade queues all existing galleries, including archives. System status shows
ready, pending, failed and stalled counts. Cron reconciliation runs every
15 minutes to resume work stalled for 15 minutes and refresh snapshots older
than one day. File events normally invalidate counts immediately. A source
that becomes unreadable is reported as unavailable rather than as an empty
gallery; restoring access is picked up by reconciliation.

For an optional Files Retention handoff, select one existing system tag under
Security. Owners opt in per folder gallery. The tag is set on archive and
removed on restore. Proofing Gallery never deletes the tagged folder; test the
independent Nextcloud Files Retention rule on disposable data.

Disabling the app preserves data and stops app access. Before uninstalling,
export required selections and feedback and resolve pending uploads. Revoking a
public link is the fastest first response to a leaked token.

## User migration

Proofing Gallery participates in Nextcloud's User Migration framework. Its
portable manifest contains folder-backed galleries as unpublished drafts,
design presets, invitation templates, and personal settings; source folders use
relative paths. Collection members are exported as user-relative paths and are
rebuilt after their folder-based source galleries. Unavailable source folders or
collection members are skipped and reported without publishing a partial gallery.

Imports are additive. Public links, passwords, guests, feedback, managers,
audit data, branding assets, hero/logo file IDs, and active lifecycle or
retention rules are not transferred. Missing folders and policy-incompatible
entries are skipped and reported by the migration frontend.

## Upgrade and recovery checks

After installation or upgrade:

1. Check `occ app:list` and background-job failures.
2. Open the app as a permitted user and create a private test gallery.
3. Verify password, expiry, revocation, preview, and download policy.
4. Check mail only if configured and run one background-job cycle.
5. Inspect the Proofing Gallery system-status section.

If a source folder is lost, restore it from the normal Nextcloud backup or let
the owner select a validated replacement. Restore database and appdata together
when recovering review history. For security defects use GitHub's private
vulnerability reporting; include affected versions and reproduction steps but
never real client data or credentials.

Existing primary links retain their permission and navigation choices during upgrades. Only areas matching gallery defaults continue to inherit. Legacy automatic folder depths are frozen for separately configured navigation. Previously overwritten choices cannot be recovered without historical data.
