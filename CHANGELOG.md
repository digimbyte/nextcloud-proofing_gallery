# Changelog

## Unreleased

- require PHP 8.2.36 or newer. Installations on PHP 8.2.35 must upgrade PHP
  before updating the app.

## 0.13.0 — 2026-10-30

- support Nextcloud 33–35; Nextcloud 31/32 no longer receive app updates
- use the modern Files integration throughout; new local instances use Nextcloud 35

- update frontend libraries and browser test tools; fix security findings in
  markdown-it, follow-redirects, DOMPurify, and fast-uri
- modernize the frontend toolchain with jsdom 30 and TypeScript 6
- include displayed ratings and comment counts in review button labels for
  assistive technologies and voice control
- require PHP 8.2.35 or newer and update the PHP test tooling to PHPUnit 11;
  upgrade PHP before updating the app on installations running an older version

- let Fotobox kiosks show and print a photo's QR code before uploading it:
  galleries return a `photoLink`, and the guest page waits for the photo and
  opens it once it arrives

- show each project's phase and the client work waiting for the photographer
  (open selections, uploads to approve, submitted or overdue review rounds,
  links expiring within a week) on gallery cards, in a new "Needs attention"
  view and in an Overview status panel with the client link
- show selections as cards with photo thumbnails, an open/completed filter and
  one primary action; show client likes, selections and comments per photo and
  keep portrait thumbnails uncropped in the Photos workspace
- flag overdue review rounds, use one locale-aware date format, open Share with
  the client links and keep the guest sort order in Design
- show a separate error state with retry when galleries cannot be loaded
- give proofing clients a visible "Select photos" bar with the selection count,
  rules and due date, and a prefilled "Send selection" step
- render shared galleries without Nextcloud page chrome: link previews for
  messengers, a gallery-specific home-screen manifest and theme color, and no
  Nextcloud app banner
- show the cached grid image while the full lightbox image loads, use an opaque
  lightbox backdrop and hide file names there unless the gallery shows them
- fix invisible like badges and solid button labels, missing Ionic spacing,
  clipped titles on phones and inconsistent selected-tile states

Upgrade note: Nextcloud 33–35 is required; installations on 31/32 must upgrade
Nextcloud before updating the app. PHP 8.2.35 remains the app minimum; Nextcloud
35 requires PHP 8.3 or newer. Back up the database, configuration and data before
upgrading. Existing gallery covers, link restrictions and feedback are preserved;
media counts continue rebuilding through background jobs after the upgrade.

- fix recursive media counts, cover previews and favicons; preserve custom heroes
- harden access checks, private guest uploads, recoverable review delivery and
  event publication; retain original media and scoped links during recovery
- add bounded orphan metadata maintenance and reliably release database cursors

## 0.12.0 — 2026-10-09

- preserve separately configured primary-link download, upload, export, metadata
  and navigation settings; offer independent permission and navigation inheritance
- synchronize native download restrictions with effective gallery and link rules

- honor the chosen project purpose when applying gallery defaults; start new
  proofing projects with private star ratings and pick/reject feedback
- explain administrative, gallery and link feedback restrictions; let primary
  links explicitly inherit feedback permissions or retain their own choices
- enable client ratings by default on new installations while preserving
  existing administrative settings and restrictions during upgrades
- apply feedback permissions consistently to public viewing and mutations,
  and keep filename CSV exports working when client ratings are disabled

- show the white app icon in the header and app menu and the dark one on light
  backgrounds such as the administration settings, notifications and search

- simplify the owner workspace, expose photo sorting on desktop and mobile,
  improve gallery action menus and organize design settings with a reachable
  mobile preview
- preserve cross-gallery deep links and browser history, save pending edits
  before switching galleries, and ignore outdated gallery load responses
- update frontend libraries, development tools and pinned GitHub Actions;
  require upgrades from the latest stable release before publishing

Upgrade note: existing administrator choices and public-link restrictions are
preserved. New installations enable client ratings by default; new proofing
projects enable ratings and pick/reject when permitted by the administrator.
Primary links can inherit feedback, delivery permissions and navigation
independently, while separately configured links retain their settings.
Previously overwritten settings cannot be recovered without historical data.

## 0.11.0 — 2026-10-04

- add administrator defaults, per-gallery image ordering, and personal visitor
  choices with a reset action; sort naturally by filename or by capture date,
  last modified date, or file size in either direction across galleries,
  collections, and culling
- index capture dates privately in bounded background jobs, keep images without
  a capture date at the end, and preserve pagination and the active image when
  changing the sort order
- add a Fotobox project workflow and authenticated gallery provisioning and
  JPEG upload API with repeatable requests and stable photo links for QR codes;
  external photobooth software can integrate with the API and is not included
- preserve each public link's folder restrictions when changing a gallery source;
  report missing folders and disable links without matching folders until repaired
- recover deleted gallery shares explicitly while retaining link identities and
  review history, and keep folder names visible in public galleries
- apply public preview language changes consistently, keep concurrent public
  link listings read-only, and improve action-label contrast
- update frontend, PHP tooling, and GitHub Actions dependencies; strengthen
  browser setup checks and verify published package attestations

Upgrade note: existing collections keep their original order. Capture-date
indexing continues in the background after upgrading; images can move into
their dated position as metadata becomes available. Images without a capture
date remain visible at the end. Gallery and visitor sort choices do not grant
access to additional folders or expose private capture-date metadata.

## 0.10.0 — 2026-09-10

- make collaborative reviews clearer with separate general feedback and image
  discussions, labelled review colors, localized headers, and account
  attribution for signed-in reviewers while retaining guest authorship
- keep ratings, selections, and link restrictions private, and safely refresh
  open viewers after a user or guest is removed
- preserve image discussions across replies and deletions, while keeping
  annotations aligned during zoom and improving touch panning
- make updates safer for existing galleries and event deliveries by completing
  required data updates before the new version becomes active
- update bundled third-party libraries to address known security advisories

## 0.9.1 — 2026-09-06

- fix upgrades for installations left in maintenance mode by 0.9.0: install 0.9.1
  and run the normal Nextcloud upgrade again without deleting galleries, links,
  feedback, or background jobs
- keep cleanup jobs running reliably after an upgrade so existing galleries can
  continue their automatic data maintenance
- add an automated recovery test that reproduces the failed 0.9.0 upgrade and
  verifies recovery with 0.9.1 on SQLite, MariaDB, and PostgreSQL

## 0.9.0 — 2026-09-04

- add guided **New project** workflows for showcases, finished-photo delivery,
  client selections, collaborative review, receiving files, and private event
  folders, with workflow-specific gallery modes and moderated upload inboxes
- add Studio workspaces for overview, photos, culling, design, links, review,
  team, automation, privacy, and history, including reusable artwork assets and
  a live design preview
- improve owner and client review with photo comparison, loupe and filmstrip
  culling, annotations, comments, named selections, and per-link selection
  limits and due dates; submitted selections can be locked for delivery
- add private event delivery for schools, sports, and other volume jobs with a
  recipient ledger, CSV import, encrypted contact data, locales, assigned
  shared/group/private folders, one-time PINs, invitations, scheduled release
  waves, retries, repairs, and link rotation
- keep every event recipient inside their assigned folders and apply layered
  access rules at gallery, public-link, and release-wave level
- let owners choose whether guests can download nothing, individual files,
  saved selections, or the complete gallery; offer original or metadata-free
  JPEGs, optional watermarks, and printable contact sheets
- refresh public galleries with responsive mobile navigation, appearance themes,
  album covers, story layouts, event albums, richer metadata, private client
  identity signals, comparison, annotations, and improved mobile actions
- expand the user and administration guides for project setup, event delivery,
  settings, privacy, downloads, and operational workflows

## 0.8.2 — 2026-08-19

- rebuild public galleries as platform-adaptive Ionic apps with Geist typography,
  coral accents, native headers and sheets, swipe paging, and no fixed bottom bar
- add policy-gated whole-gallery ZIP downloads, reels-style slideshow progress,
  and accessible hover and focus contrast across light and dark Ionic sheets
- speed up multi-file owner uploads with batched session creation, parallel
  direct streaming for small files, capability-aware browser concurrency, and
  destination locks limited to the final conflict-safe commit

## 0.8.1 — 2026-08-18

- allow owner, guest, direct, and Live Push uploads to finalize concurrently by
  coordinating individual sessions and serializing only the shared destination
  commit, including conflict-safe names for simultaneous matching files
- return deterministic HTTP 423 `upload_busy` responses with bounded lock waits
  and retry only owner finalize requests without retransmitting uploaded chunks
- harden the experimental Context Agent integration with four explicit
  read-only tools, privacy-minimized results, deterministic schemas, and a
  reproducible live evaluation workflow
- consolidate risk-aware CI gates, stabilize scheduled scaling and SQLite
  upgrade coverage, and refresh reviewed frontend, PHP, and Actions dependencies

## 0.8.0 — 2026-08-08

- keep large custom-domain histories bounded with status-scoped cursor pages,
  server-side search, responsive incremental loading, and in-place operations
- register periodic maintenance through Nextcloud app metadata so application
  requests no longer reset cron timestamps or trigger daily jobs repeatedly
- make schema-dependent lifecycle and gallery-list backfills resumable after
  upgrades, retry failures from a persisted cursor, and report their state in
  native setup checks and operational health
- harden Calendar, Deck, and Talk review links against duplicate or orphaned
  resources and distinguish the stable agent API from the experimental Context
  Agent module in capabilities
- add a checksummed public-release upgrade baseline, full privacy-purge and cron
  regression coverage, larger scheduled scaling fixtures, and live optional-app
  integration CI
- pin the persistent Studio environment by platform digest while keeping the
  disposable development stack on current image tags; add safe refresh and
  diagnostic workflows that preserve volumes and never migrate implicitly
- resolve release-script CodeQL findings, enforce Node 24.11 before frontend
  gates, and update actionable transitive JavaScript security fixes
- reorganize owner projects into deep-linkable Overview, Photos, Cull, Design,
  Share, Review and secondary workspaces, with client results shown before
  configuration and legacy links normalized automatically
- refine the Editorial Darkroom with a focused loupe/inspector split, deliberate
  tap-to-toggle and swipe navigation, and viewport-safe desktop and mobile chrome
- add deep-linkable administration categories, live operational health refresh,
  and a shared mobile-safe Save/Discard bar for administrator and personal settings

## 0.7.0 — 2026-08-07

- radically modernize public galleries with configurable compact and immersive
  openings, refined glass surfaces, responsive controls, and animated viewing
- preserve complete portrait and landscape photographs in justified grids and
  replace cropped list strips with a useful photographic contact sheet
- make the lightbox touch-safe with tap-to-toggle controls, bidirectional swipe
  navigation, pinch zoom, two visible arrows, and a hideable session filmstrip
- keep culling navigation and virtualized side or bottom filmstrips within the
  viewport across large collections and narrow mobile layouts
- add a reproducible 30-photo local Studio library and six polished desktop and
  mobile screenshots for the Nextcloud App Store

## 0.6.2 — 2026-08-06

- repair legacy gallery share tokens with a new idempotent upgrade migration
  while preserving existing primary public links and archived-gallery safety
- update the transitive build-time `fast-uri` dependency to 3.1.5 to resolve
  GHSA-7p8r-x3mc-p8w7 without unrelated lockfile churn
- stabilize owner-dashboard visual verification and retain Playwright reports,
  traces, screenshots, and videos when browser CI fails
- add reproducible signed packages and protected publication to the Nextcloud
  App Store alongside checksums, an SPDX SBOM, and artifact attestations

## 0.6.1 — 2026-08-02

- keep virtualized public-gallery rows below immersive headers on desktop and
  mobile so every image remains visible and interactive
- preserve guest feedback actions while collaboration updates are delayed or
  temporarily rate-limited, including fast interactions during initialization
- let compact culling controls scroll out of the way while keeping the photo
  and bottom filmstrip together inside the viewport
- cover automatic side and bottom filmstrip placement in the real Nextcloud
  browser flow and reset the Docker gateway during local E2E preparation

## 0.6.0 — 2026-08-02

- redesign public galleries as immersive, mobile-first presentations with
  configurable title visibility, photo count, title sizing, and local modern or
  editorial typefaces
- add minimal, compact, and cinematic openers plus an immediate desktop and
  phone live preview for unpublished design changes
- migrate existing galleries to the new modern presentation defaults while
  retaining validated settings compatibility
- keep every photo reachable in narrow one-column galleries with corrected
  window virtualization, resize measurement, and independent pagination
- reshape owner culling around a viewport-bound, virtualized Lightroom-style
  filmstrip that adapts between the right side and bottom placement
- persist each photographer's filmstrip preference across devices and add
  focused previous/next navigation with automatic active-thumbnail tracking

## 0.5.1 — 2026-08-02

- fix SPDX SBOM generation for release archives
- make release publication independent of a checked-out Git worktree
- migrate existing public links in cursor-free batches for reliable SQLite upgrades

## 0.5.0 — 2026-08-02

- publish the first stable GitHub release with verified Nextcloud 31–34 support
- add bilingual user and administrator guides both offline in the app and on GitHub Pages
- add reproducible release, documentation, dependency, and security automation
- document contribution, support, disclosure, privacy, and release verification workflows
- remove private maintainer contact data and prepare a sanitized public Git history

## 0.5.0-alpha.3 — 2026-08-02

- make archive and restore fail closed while preserving public-link credentials
- stream media and ZIP exports, bound request bodies, and commit uploads atomically
- add retryable video leases plus atomic media and generation-based search indexing
- enforce feature gates, scoped presentation assets, public rate limits, and collaboration quotas
- revalidate custom domains continuously and fail closed when verification becomes stale
- align Live Push with its implemented HTTPS PUT ingress and clarify local metadata search
- split workflow routes out of the gallery controller and expand lifecycle cleanup

## 0.5.0-alpha.2 — 2026-08-02

- Added upload-only Live Push credentials with independent rotation and
  revocation for direct camera-to-gallery delivery.
- Added administrator-approved custom gallery domains with DNS ownership,
  public-address, TLS, and Nextcloud endpoint verification.
- Added optional local semantic search and video derivatives with explicit
  capability reporting and privacy-safe lifecycle cleanup.
- Split growing gallery workflows into focused repositories and services,
  modernized the frontend toolchain, and tightened responsive navigation,
  action-menu layering, accessibility, and reduced-motion behavior.

## 0.5.0-alpha.1 — 2026-08-01

- Added an indexed, cursor-paged media foundation with recursive folder views,
  folder/type grouping, bounded virtual grids, and resilient progressive images.
- Added a keyboard-first owner culling desk with ratings, picks/rejects, color
  labels, undo, saved cross-device views, and conflict-aware Adobe XMP sync.
- Replaced single-link delivery with independently scoped public links and
  per-link locale, view, download, metadata, upload, feedback, expiry, password,
  owner-rating threshold, audit, and native Nextcloud share controls.
- Added private client star ratings and pick/reject signals with owner-only
  aggregation and an explicit, idempotent preview-before-promotion workflow.
- Added configurable slideshows that pause in hidden tabs, accessible shortcut
  help, and privacy-bounded RFC 4180 UTF-8 CSV composers for owners and guests.
- Hardened collection policy serialization, collection media membership,
  scoped comment mutation, and cross-link selection export authorization.
- Refined the bold responsive culling and public interfaces with 44-pixel touch
  targets, sticky mobile action decks, visible keyboard focus, and reduced-motion
  alternatives.

## 0.4.0-alpha.3 — 2026-08-01

- Added grouped, localized Nextcloud notification-center alerts for comments,
  completed selections, client uploads, manager assignments, and automatic
  public-link revocations with deep links and bounded retries.
- Added separate per-gallery and personal defaults for native notifications and
  email digests while preserving existing email subscriptions during upgrades.
- Completed the native Activity integration and exposed notification delivery
  availability, pending work, and failures in the administrator system status.

## 0.4.0-alpha.2 — 2026-07-31

- Added a dedicated global administration area with server-enforced feature,
  publishing, group-access, retention, branding, and gallery-default policies.
- Added personal cross-device defaults for project creation, design, language,
  lifecycle suggestions, folders, and automatic activity subscriptions.
- Surface effective capabilities from Proofing Gallery and inherited Nextcloud
  sharing policies while preserving existing public links until explicit revoke.
- Added conflict-aware APIs to preview and apply selected defaults to existing
  galleries, plus bounded bulk revocation and reusable instance logos.

## 0.4.0-alpha.1 — 2026-07-31

- Added purpose-led project creation with safe in-app Nextcloud folder creation.
- Added optimistic revisions, automatic settings saves, offline retry, and conflict recovery.
- Reshaped gallery administration around Plan, Photos, Style, Delivery, and Results.
- Added concurrent owner upload progress with partial success and per-file retry.
- Added workflow completion plus opt-in automatic link revocation and recoverable archiving.
- Unified download controls in the Delivery workspace and expanded German localization.

## 0.3.0-alpha.1 — 2026-07-31

- Index bounded EXIF and IPTC image metadata into Nextcloud FilesMetadata and
  add owner filters for capture date, camera, lens, keywords, and ratings.
- Keep public metadata private by default and let owners expose only selected,
  privacy-safe fields per gallery; GPS data is never included publicly.
- Add conflict-safe, Adobe-named XMP sidecars for descriptive metadata without
  modifying originals or discarding unrelated third-party XMP properties.
- Export client selections into standard XMP rating, label, keyword, and
  Lightroom hierarchy fields plus a versioned Proofing Gallery namespace.
- Add administrator bounds for metadata file size, batch processing, and XMP
  writes, with responsive owner and public metadata interfaces.

## 0.2.0-beta.4 — 2026-07-31

- Add an expressive, image-led gallery shell, animated lightbox and feedback
  panels, mobile action rails, and clearer content/settings workspaces.
- Add owner-side batch operations, file version replacement and restoration,
  QR sharing, richer selection management, and expanded mobile/a11y coverage.
- Revalidate clean installs, upgrades, packages, bundle budgets, and the full
  Nextcloud 31–34 database compatibility matrix.

## 0.2.0-beta.3 — 2026-07-31

- Add owner-scoped gallery presets with validated design, access, feedback,
  and public-language defaults while preserving source folders and share links.
- Let owners explicitly deliver public galleries and invitation mail in English
  or German, independent of the owner's current interface language.
- Add reusable plain-text invitation templates with bounded, server-rendered
  gallery, owner, and URL placeholders and an editable final message.
- Add opt-in event subscriptions for owners and individual managers with
  immediate or daily delivery, locale controls, deduplicated worker retries,
  and scoped unsubscribe links.
- Cover reusable workflows, mail delivery, accessibility, mobile layout,
  upgrades, packaging, and supported Nextcloud/database combinations.

## 0.2.0-beta.2 — 2026-07-31

- Scale collection assembly with owner-only source filtering, gallery and
  current-folder search, bounded pagination, stable selections, and stale
  response protection.
- Reconcile only empty, unreferenced collection anchors older than 24 hours
  through bounded daily cleanup and an administrator dry-run endpoint.
- Lazy-load public lightbox, feedback, and upload code, defer collaboration
  bootstrap beyond first paint, and enforce a 55 KiB eager public JS budget.
- Add deterministic collection, anchor-safety, browser, accessibility,
  security, bundle, and throttled Chrome DevTools performance regressions.

## 0.2.0-beta.1 — 2026-07-31

- Add ordered virtual collections across the owner's existing galleries
  without copying original media.
- Keep collection delivery behind an empty native Nextcloud link-share anchor
  and revalidate membership and source readability for every media request.
- Add an owner collection builder with optimistic revision protection and
  explicit unavailable-source recovery.

## 0.1.0-beta.4 — 2026-07-31

- Cache gallery media summaries by source-folder ETag so unchanged owner
  lists avoid repeated directory scans while retaining deterministic covers.
- Split notification dialogs from the owner shell and enforce raw-entry and
  eager-gzip bundle budgets during every production build.
- Distinguish never-run, healthy, overdue, and failed cleanup jobs with safe
  operational diagnostics in the Nextcloud administrator settings.
- Extend automated recovery, cache, public-bootstrap, policy, and lifecycle
  regression coverage.

## 0.1.0-beta.3 — 2026-07-31

- Add stable source-folder status and a safe owner-only recovery flow that
  preserves the native public-share token and existing feedback history.
- Return file counts and cover identity with gallery lists, eliminating the
  per-gallery preview request fan-out, and lazy-load settings and modal code.
- Bootstrap the first public media page in the authenticated server response
  and preload the first image to improve first-media rendering.
- Add server-wide administrator policies for uploads, deliveries, and
  retention plus cleanup, queue, and preview-cache health diagnostics.
- Configure Beads Dolt synchronization through the Git remote and verify a
  clean cross-machine bootstrap.

## 0.1.0-beta.2 — 2026-07-30

- Replace the long owner settings page with task-focused Overview, Design,
  Access, Feedback, and Activity workspaces.
- Add real gallery covers and media previews, compact gallery rows, explicit
  archive restoration, and permission-aware owner, editor, and viewer roles.
- Add user and group access management directly to the Access workspace.
- Add compact and cinematic public openers, a mobile feedback sheet, a
  viewport-safe lightbox, and a non-overlapping public footer.
- Clarify password updates so an empty form no longer removes an existing
  gallery password unintentionally.
- Pause background collaboration polling while the public page is hidden and
  improve control names, form metadata, responsive navigation, and empty
  states.

## 0.1.0-beta.1 — 2026-07-30

- Add folder-backed presentation and collaborative proofing galleries.
- Add native Nextcloud public shares, passwords, expiry, invitations, and
  user/group gallery managers.
- Add responsive public gallery, lightbox, video streaming, customizable
  branding, and server-rendered preview watermarks.
- Add likes, colors, comments, annotations, named selections, exports,
  downloads, ZIP delivery, and printable contact sheets.
- Add resumable guest uploads with a hidden moderation inbox.
- Add activity provider, email notifications, and lifecycle cleanup.
- Add English/German localization, accessibility and visual E2E checks, and a
  Nextcloud 31–34 × SQLite/MariaDB/PostgreSQL compatibility matrix.
- Add reproducible App Store packaging and operator, privacy, architecture,
  user, and development documentation.
