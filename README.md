# Proofing Gallery

[![CI](https://github.com/soerennb/nextcloud-proofing_gallery/actions/workflows/ci.yml/badge.svg)](https://github.com/soerennb/nextcloud-proofing_gallery/actions/workflows/ci.yml)
[![Documentation](https://github.com/soerennb/nextcloud-proofing_gallery/actions/workflows/docs.yml/badge.svg)](https://soerennb.github.io/nextcloud-proofing_gallery/)

Proofing Gallery is a native Nextcloud app for branded client delivery and
collaborative photo proofing. A gallery either references an existing Nextcloud
folder or assembles an ordered virtual collection from several owned galleries.
Originals remain in Files while the app adds a customizable public presentation,
guest feedback, selections, secure downloads, and an upload inbox.

## Included

Proofing Gallery is organized around photographer workflows: create a guided
showcase, delivery, selection, proofing, or receiving-files project and then
work through its focused Overview, Photos, Cull, Design, Share, Review, Team,
Automation, Privacy, and History workspaces.

- presentation and collaborative proofing modes
- standard Nextcloud public-link protection, password, and expiry
- responsive image/video gallery with nested folders, previews, lightbox,
  slideshow, zoom, pan, and byte-range video streaming
- bounded FFmpeg background transcoding for camera formats, with browser-ready
  H.264/AAC MP4 derivatives, generated posters, and administrator controls
- optional owner search over local filenames and metadata, plus scene search
  through an explicitly enabled HTTPS vision provider
- optional HTTPS Live Push ingestion through upload-only, gallery-scoped
  credentials that can be rotated or revoked independently; camera-protocol
  translation is deliberately left to an operator-managed gateway
- administrator-approved custom gallery domains with DNS ownership and HTTPS
  verification, immediate revocation, and canonical link generation
- logo, hero image/focal point, accent, typography, welcome copy, filenames,
  and server-rendered preview watermarks
- likes, color states, comments, image annotations, named selections, and
  CSV/plain-text exports
- separate general comments and expandable pin conversations, with panels beside
  the selected detail, color-labelled review states, and account-aware authorship
- individual downloads, selected ZIP files, and printable contact sheets
- resumable guest uploads to a hidden moderation inbox
- user/group gallery managers, activity filters, and opt-in event digests for
  owners and individual managers
- reusable gallery and invitation templates plus explicit German/English
  public-gallery and mail delivery
- ordered, copy-free collections spanning the owner's folder galleries, with
  unavailable-source diagnostics and conflict-safe editing
- bounded EXIF/IPTC indexing through Nextcloud FilesMetadata, with owner-side
  capture date, camera, lens, keyword, and rating filters
- per-gallery public metadata disclosure that starts with no shared fields and
  permanently excludes GPS, private keywords, ratings, and workflow labels
- direct Adobe-compatible `<basename>.xmp` editing for titles, descriptions,
  creators, copyright, keywords, ratings, and labels while originals stay intact
- client-selection round trips into standard XMP/Lightroom fields and a
  versioned Proofing Gallery namespace for workflow fidelity
- recursive, cursor-paged galleries with folder/type grouping and bounded
  virtual grids for large photographic deliveries
- a keyboard-first owner culling desk with ratings, picks/rejects, color labels,
  conflict-aware XMP synchronization, batch undo, and cross-device saved views
- multiple independently scoped public links per gallery, each with its own
  start folder, presentation mode, language, download and feedback policy
- volume-event deliveries that combine shared folders with exactly one private
  participant folder per link, including CSV assignment, optional PINs and
  encrypted recipient contact data without copying originals
- private per-client star ratings and decisions, owner-side aggregates, and an
  explicit preview-before-promotion workflow that never writes XMP implicitly
- a field-selectable, privacy-bounded UTF-8 CSV export composer with preview and
  clipboard support, plus configurable resource-aware slideshows

For private volume events, shared, group, and participant folders are released
through recipient-specific links. CSV assignment, encrypted contact data,
optional PINs, scheduled waves, retries, invitations, and link rotation are
handled in the Event delivery workspace. The download policy is selected per
release wave and is intersected with the instance, gallery, and link policies;
existing links are not silently expanded by a later wave.

## Local development

Requirements: Docker with Compose, Node.js 24.22.1 or newer within 24.x, npm 11,
PHP 8.2.36 or newer, and Composer 2.

```bash
cp .env.example .env
nvm use
npm ci
composer install
make dev-up
```

Nextcloud is available at <http://localhost:8080> and Mailpit at
<http://localhost:8026>. The credentials in `.env.example` are local-only.

```bash
make build
make docs
make lint
make test
npm run test:e2e
make test-compat
make occ CMD="app:list"
make dev-logs
make dev-down
```

`make dev-reset` deletes only this Compose project's containers and volumes,
including all local development data, and requires `CONFIRM_RESET=yes`.

## Packaging

```bash
make appstore
make verify-package
```

The reproducible unsigned artifact is written to
`build/artifacts/appstore/proofing_gallery.tar.gz`. Signing credentials are
deliberately not stored in this repository. Maintainers should follow the
[App Store publishing runbook](docs/APPSTORE-PUBLISHING.md) for certificate
registration, signed package verification, and protected release automation.

### Install a GitHub release

Download `proofing_gallery.tar.gz` and `SHA256SUMS` from the matching
[GitHub release](https://github.com/soerennb/nextcloud-proofing_gallery/releases).
Verify the checksum and, when the GitHub CLI is available, the artifact
attestation before extracting the archive:

```bash
sha256sum --check SHA256SUMS
gh attestation verify proofing_gallery.tar.gz --repo soerennb/nextcloud-proofing_gallery
tar -xzf proofing_gallery.tar.gz -C /path/to/nextcloud/custom_apps
sudo -u www-data php /path/to/nextcloud/occ app:enable proofing_gallery
```

Starting with the first App Store release, the protected release workflow
publishes the reproducible, Nextcloud-signed package to both GitHub and the
Nextcloud App Store.

## Documentation

- [Documentation website](https://soerennb.github.io/nextcloud-proofing_gallery/)
- [English user guide](docs/en/user-guide.md)
- [German user guide](docs/de/benutzerhandbuch.md)
- [English administrator guide](docs/en/admin-guide.md)
- [German administrator guide](docs/de/administrationshandbuch.md)
- [Development guide](docs/DEVELOPMENT.md)
- [App Store publishing](docs/APPSTORE-PUBLISHING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Privacy and security](docs/PRIVACY.md)
- [GitHub repository setup](docs/GITHUB-SETUP.md)

The user guide is available through **Help** in the app. The administrator guide
is embedded in the Proofing Gallery administration settings. Both are built
from the same Markdown files as GitHub Pages and work without internet access.

## Contributing and support

Use [GitHub Discussions](https://github.com/soerennb/nextcloud-proofing_gallery/discussions)
for questions and the structured [issue forms](https://github.com/soerennb/nextcloud-proofing_gallery/issues/new/choose)
for bugs and features. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting
changes. Suspected vulnerabilities must be reported privately as described in
[SECURITY.md](SECURITY.md), never in a public issue.

## Compatibility

The automated container matrix covers Nextcloud 33–35 with SQLite, MariaDB, and
PostgreSQL. PHP 8.2.36–8.6 is declared; CI runs the supported baseline and current
PHP versions. Nextcloud 35 requires PHP 8.3 or later; use only PHP versions
supported by the installed server. The PHP 8.6 job is a forward compatibility
check. Routine browser E2E coverage uses Chromium with Axe accessibility
and desktop/mobile interaction and reachability checks. Weekly and explicit
comprehensive runs also check the review viewer in Firefox and WebKit.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
