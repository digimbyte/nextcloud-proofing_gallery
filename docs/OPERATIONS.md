# Operations

## Requirements

- Nextcloud 33–35
- PHP 8.2.36–8.6 with the extensions required by Nextcloud; GD is required for
  watermarked previews and contact sheets
- SQLite, MariaDB/MySQL, or PostgreSQL
- a working Nextcloud background-job runner
- configured Nextcloud mail transport for invitations and subscribed event
  notifications

## Install and upgrade

Extract the signed release so the app directory is
`custom_apps/proofing_gallery`, then run:

```bash
sudo -u www-data php occ app:enable proofing_gallery
sudo -u www-data php occ background:cron
```

Nextcloud runs database migrations during enable and upgrade. Back up the
Nextcloud database and data directory before upgrading. Never skip Nextcloud
major versions during a server upgrade.

### Recover a failed 0.9.0 upgrade

Some 0.9.0 upgrades can leave Nextcloud in maintenance mode because a persisted
cleanup job cannot be constructed. The supported recovery keeps the database,
gallery data, and queued jobs intact:

1. Keep maintenance mode enabled and make a fresh backup of the Nextcloud
   database, `config/`, data directory, and appdata.
2. Download `proofing_gallery.tar.gz` and `SHA256SUMS` for the signed 0.9.1
   release from GitHub and verify the archive before extracting it. Do not use
   a checkout from `main`.
3. Stop web/PHP workers, replace only
   `custom_apps/proofing_gallery` with the verified 0.9.1 directory, and keep
   the old app directory as a temporary backup until recovery is confirmed.
   Restart the workers or the AIO Nextcloud container so stale OPcache code is
   gone.
4. From the Nextcloud root, run the CLI upgrade as the web user:

   ```bash
   sudo -u www-data php occ upgrade
   sudo -u www-data php occ status --output=json
   sudo -u www-data php occ app:list --output=json
   ```

   The status must report `maintenance: false` and `needsDbUpgrade: false`, and
   Proofing Gallery must report version 0.9.1. Run `occ upgrade` again only if
   Nextcloud reports that migrations are still pending.

Do not uninstall or disable Proofing Gallery, delete its database tables or
background jobs, turn maintenance mode off before the upgrade succeeds, or
restore only part of the database/appdata pair. If the retry fails, leave
maintenance mode enabled, retain the logs and backup, and investigate the new
error before changing the installation.

## Jobs, storage, and mail

Run cron at least every five minutes. Monitor Nextcloud's log for
`proofing_gallery`, failed background jobs, preview-generation failures, and
mail transport errors. Capacity planning should include originals in Files,
temporary resumable chunks, and appdata preview derivatives.

Event email is opt-in and queued. Only a gallery owner or an individual
Nextcloud user already assigned as a gallery manager can be subscribed; groups
and arbitrary addresses are rejected. Immediate messages are dispatched by the
five-minute job. Daily events from the same UTC day share a delivery boundary
and are coalesced per recipient/gallery. Queue records use a subscription/event
unique key, and claimed records are not sent again after success. Failed claims
return to the queue after a bounded delay; claims abandoned for 15 minutes are
recovered. Each mail contains a random scoped link that disables only its own
recipient/gallery subscription.

Owner uploads below the Files app chunk threshold are prepared in one batch
request and streamed directly into uniquely named hidden files in the gallery
folder. Larger or resumed uploads retain 5 MiB chunks. Administrators can configure the
per-file upload limit, selection-delivery limits, and retention periods in
Administration settings → Additional settings → Proofing Gallery. The same
section shows pending and unreviewed uploads, preview-cache use, and the last
attempt and successful cleanup. A daily cleanup is considered overdue after 36
hours; failed runs expose only a non-sensitive error code and remain visible as
failed Nextcloud background jobs. Cleanup is eventual, so allow headroom for interrupted
uploads. Native Nextcloud retention, backup, encryption, and object-storage
policies still apply to gallery source folders.

The browser shares the Files app's bounded parallel-request capability, with a
fallback of five workers. Streaming, MIME validation, and chunk assembly for
different uploads run concurrently. Only the final conflict check, backup, and
atomic move are serialized per destination folder; full file writes and their
Nextcloud hooks do not hold that logical lock. Temporary lock contention is returned
as HTTP 423 with `code: upload_busy` and a `Retry-After` header; clients should
retry only the finalization request and must not resend completed chunks.

Nextcloud's optional dirty-database-query detector can report read-after-write
paths triggered by Activity, encryption, metadata, or other file hooks during
an otherwise successful upload. Correlate these entries by request ID and HTTP
status before treating them as an upload failure. Keep
`loglevel_dirty_database_queries` at its normal debug level in production and
raise it temporarily only while diagnosing replica-consistency paths; do not
disable required file hooks merely to suppress these diagnostics.

### Event delivery waves

Event releases are queued in bounded batches and can be immediate or scheduled.
Each recipient is processed independently: successful links remain valid when
another recipient fails, and a partial-failure wave exposes only the failed
rows for retry. Publication claims expire after five minutes and carry fencing
tokens so superseded workers cannot commit a link. A periodic recovery job
requeues stalled waves, including jobs lost after process termination. Automatic
claim recovery stops after five attempts; explicit retry starts a new attempt
budget. Link rotation and invitation resend are also recipient-scoped.
The event policy is captured with the wave and is intersected with the global,
gallery, and public-link policies. It controls no-download, individual,
selection, or complete-gallery delivery without ever crossing the recipient's
assigned folder roots.

Plan capacity for the number of recipient links, native public shares, queued
mail messages, and temporary PIN handoff data in addition to source media and
preview derivatives. Run cron continuously during a large release and monitor
the recipient ledger, event operations endpoint, Nextcloud failed jobs, and
integration/mail logs until the wave reaches `released` or `partial_failed`.

### Capacity and backlog monitoring

The Administration settings system-status section reads indexed counters for
scheduled, running, and due gallery purges, due lifecycle actions, expired guest
sessions, queued media-index folders, failed retention handoffs, and integration
outbox work. These counters do not enumerate gallery media or open source
folders. Investigate when due work grows over multiple cron cycles, a media scan
stays unchanged for more than 15 minutes, or the oldest purge remains due after
a full daily cleanup.

Pull requests run a bounded scale smoke with 20 galleries and 100 media rows.
The scheduled `Scaling` workflow exercises 250 galleries and 1,000 media rows.
Tune these fixtures with `E2E_SCALE_GALLERIES` and `E2E_SCALE_IMAGES`; never use
client material for a load fixture.

### Controlled deletion and Nextcloud retention

An owner can export app data for a gallery, archive it, and schedule permanent
removal after a 30-day grace period. Cancellation is possible until processing
starts. Processing is resumable and deletes at most 1,000 rows from one table
per step. It removes Proofing Gallery database rows and private appdata chunks;
the source folder and original Nextcloud files are outside its scope.

Identified guests can export their own review data or erase it immediately.
User and group deletion events remove scoped assignments and personal app
records; galleries owned by a deleted user are revoked, archived, and scheduled
with the same grace period.

The optional Files Retention handoff is disabled by default. An administrator
selects one existing Nextcloud system tag, and each folder-gallery owner opts in
separately. Proofing Gallery assigns that tag on archive and removes the same tag
on restore. The app never invokes file or folder deletion for this integration.
Any later deletion is performed solely by the independently configured
Nextcloud Files Retention rule. Test it on disposable data first.

## HTTPS Live Push ingress

Live Push is disabled by default. An administrator enables the HTTPS ingress
before photographers can create credentials. Every credential is scoped to one
folder gallery and an optional subfolder, has no read/list/delete capability,
and can be rotated or revoked without changing public links.

Clients send each file as an HTTPS `PUT` to
`/apps/proofing_gallery/live-push/upload?filename=<url-encoded-name>` on the
Nextcloud origin using the generated username and password as HTTP Basic
authentication. The request body is the file body; success returns HTTP 201.
The app rejects disabled, revoked, archived, oversized, unsupported, or
invalidly scoped uploads and rate-limits anonymous requests.

The app does not implement FTP or FTPS. If a camera cannot send HTTPS PUT, an
operator-managed gateway may translate its protocol to this ingress. That
gateway is outside this app's security boundary and must deny listing and
downloads, avoid logging passwords, and validate Nextcloud's TLS certificate.

## Custom gallery domains

Custom domains are disabled by default. After enabling them, a photographer can
request one domain for an active client link. The app displays a unique TXT
challenge at `_proofing-gallery.<domain>`. An administrator verifies the request;
activation requires both the exact public DNS value and a TLS-valid HTTPS
endpoint. IP literals and private/reserved host suffixes are rejected.

Before verification, configure the domain as a Nextcloud `trusted_domain`, issue
its TLS certificate, and route the domain to the same Nextcloud frontend. Rewrite
only `/` to `/apps/proofing_gallery/domain`; forward `/s/*`, `/apps/*`, `/ocs/*`,
and static Nextcloud paths unchanged while preserving the original `Host` header.
The entry endpoint redirects to the mapped native share on the same HTTPS host,
so password, expiry, capability, and revocation enforcement remains in Nextcloud.
Never use a redirect to a different untrusted origin. Removing DNS alone is not
revocation: revoke the mapping or its public link in Proofing Gallery as well.

The **Photo metadata** administration section separately bounds the maximum
image size processed for embedded EXIF/IPTC data and the number of files in one
manual indexing run. XMP sidecar writing can be disabled instance-wide without
disabling metadata reads. Processing is local to the Nextcloud instance and
uses FilesMetadata for ETag-bound index records. Size limits reduce memory and
temporary-disk exposure; they are not upload limits.

XMP writes create `<basename>.xmp` in the original's folder and therefore
require a writable source folder. Backups and storage quotas should account for
these small files. Sidecars are capped at 1 MiB, external XML entities are
disabled, and writes use source/sidecar ETags to surface concurrent changes.

Collection galleries create empty native share anchors below each owner's
`.proofing-gallery/collections` directory. The application database contains the
ordered source references; anchors must stay empty and are not media storage.
The lifecycle job removes orphaned collection rows and memberships. It also
reconciles at most 100 collection anchors per daily run. Only folders whose
names are exactly 32 lowercase hexadecimal characters, which are empty, at
least 24 hours old, and not referenced by a collection gallery are deleted.
Referenced, recent, non-empty, or irregularly named folders are never removed.
Never place user files in these directories.

Recursive folder galleries maintain a bounded media index in the app database.
The index stores file identity, relative path, MIME type, size, modification
time, and sort keys, not image bytes. Rebuilds run in bounded background batches
and stop at the administrator-defined maximum. Public links can further reduce
the visible result by start path and minimum owner rating. Monitor background
jobs and the administration health summary after enabling recursive delivery on
large existing folders.

### Video transcoding

Install `ffmpeg` and `ffprobe` on every Nextcloud web and cron worker that may
run Proofing Gallery jobs. The Administration settings page verifies the
configured executable and reports pending, failed, and completed derivatives.
Conversion is enabled by default but fails closed: MP4/WebM sources continue to
stream directly, while camera formats that a browser cannot play show a clear
preparation or unavailable state until a derivative is ready.

Each source is copied to a private temporary file and processed without a shell.
The app verifies the duration with `ffprobe`, enforces source-size, duration,
height, concurrency, and wall-clock limits, and writes an H.264/AAC MP4 plus a
JPEG poster to appdata. Originals are read-only. Jobs are keyed by owner, file,
ETag, and profile, so repeated page views do not duplicate work and replacing a
source invalidates the old result. Failures retry at most three times with a
cooldown. The lifecycle job removes derivatives after the configured retention
period; active content is regenerated on demand.

For production, keep the executable field at a trusted absolute path (for
example `/usr/bin/ffmpeg`), run cron at least every five minutes, and budget
temporary disk for one source plus one output per configured parallel job.
Restricting concurrency is especially important on shared PHP workers.

### Semantic search

Semantic search is off by default. The local provider hashes filenames and a
small allowlist of descriptive metadata into normalized vectors entirely inside
Nextcloud. It is useful for bilingual concept queries without moving previews.
The HTTPS vision provider is a separate opt-in: administrators must configure
an HTTPS endpoint and explicitly allow external preview transfer. Requests
contain only a bounded 384-pixel preview or the search text; originals, GPS,
ratings, private keywords, and gallery credentials are never included.

The provider endpoint accepts `POST` JSON with `model` and an `input` object
(`type=image`, `mimeType`, `data` or `type=text`, `text`) and returns an
`embedding` number array plus optional `concepts`. Redirects, oversized
responses, non-finite vectors, and unexpected status codes fail closed.
Nextcloud's outbound HTTP protections remain active.

Administrators control the provider, model, image/video scope, maximum media
per gallery, batch size, and preview budget. Photographers explicitly queue an
index from the culling desk. Indices are tied to source ETags and provider/model;
they can be deleted per gallery through the API or instance-wide from
Administration settings → Proofing Gallery → Semantic search.

Administrators can inspect the same bounded scan without changing files. The
endpoint defaults to dry-run; pass `dryRun=false` only after reviewing the
candidate count:

```bash
curl -u admin -H 'OCS-APIRequest: true' -X POST \
  'https://cloud.example/ocs/v2.php/apps/proofing_gallery/api/v1/admin/collection-anchors/reconcile?format=json&dryRun=true'
```

The response and the Administration settings cleanup summary report scanned
anchors, candidates, and deletions without exposing user IDs or paths.

## Recovery and removal

Gallery originals remain ordinary Nextcloud files and can be restored with the
normal backup process. Database and appdata must be restored together if
feedback or pending uploads matter.

If a source folder is missing or no longer readable, the gallery Overview shows
“Folder unavailable”. Its owner can choose a replacement folder without
changing the public URL; the app updates the native Nextcloud share node and
keeps gallery activity and reviewer feedback intact.

For collections, missing source galleries or files are reported as unavailable
in the owner's Content workspace. Restore the original node/source gallery or
remove the reference and save a new collection revision. Unavailable entries
are never served to guests.

Disabling the app stops access but preserves data. Before uninstalling, export
needed selections and feedback and decide how pending inbox uploads should be
handled. Revoking a gallery link is the fastest incident-response action for a
leaked token.

## Verification

Run `make test-compat` to exercise the full supported server/database matrix.
Run `UPGRADE_DATABASE=sqlite|mariadb|postgres make test-upgrade` for an explicit
schema-and-sentinel-data upgrade on each database family.
Run `make verify-package` to build the release archive and install it on a fresh
Nextcloud 35 SQLite instance.

## Bounded orphan file-metadata maintenance

The standalone CLI in `scripts/cleanup-orphan-metadata.php` requires the current
checked-out app code in the Nextcloud installation and PHP CLI access. It only
handles an explicit JSON list of positive file IDs and a known numeric storage
ID; it never discovers and deletes records automatically. Use a maintenance
window and a reviewed list of already orphaned IDs. The default is dry-run:

```bash
NEXTCLOUD_ROOT=/var/www/html php scripts/cleanup-orphan-metadata.php \
  --ids=/absolute/reviewed-orphan-ids.json --storage=1
```

The JSON result reports requested/unique IDs, existing files, eligible metadata
and cleaned or missing records. Add `--execute` only for the reviewed orphan
scope. Before each call it rechecks live file-cache entries and sends at most
500 IDs to Nextcloud's public metadata API. Older servers used the single-file
API. File contents are never deleted. Database failures logged internally by
Nextcloud are detected by checking the remaining metadata/index records; rerun
with the same list to resume an interrupted cleanup. Each batch commits
atomically: a failed batch rolls back while earlier completed batches remain
committed. The CLI refuses HTTP use.

Nextcloud's metadata and index services currently split large ID lists but pass
the original list to each query. A minimal, unapplied upstream patch is retained
at `tooling/upstream/nextcloud-metadata-batches.patch`. This repository does not
patch the installed Nextcloud server. Compatibility acceptance uses 8,500
synthetic orphan IDs, a live file, duplicates, dry-run, interruption and resume.

For repeated transaction diagnostics, run the compatibility script with
`NEXTCLOUD_VERSIONS=33 DATABASES=sqlite AUDIT_SMOKE_REPETITIONS=20`. Every iteration
must pass; this is repetition, not a retry policy. Materialized query helpers
close their owned cursors; the legacy streaming row helper still leaves cursor
ownership with its caller. The original sporadic CI lock remains unconfirmed.

Nextcloud 35 requires PHP 8.3 or later. Nextcloud 31/32 no longer receive app updates. Upgrade the server one major version at a time to at least 33 before updating the app. Only PHP versions supported by the installed server are supported.
