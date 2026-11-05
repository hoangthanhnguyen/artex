# ARTEX — all-in-one Docker stack

ARTEX is an autonomous, agent-driven penetration-testing platform. This repository
packages the upstream ARTEX v0.3.15 source into a single Docker Compose stack that
builds from source, with an English user interface and English backend logs.

It is a derivative work of ARTEX (AGPL-3.0). See `LICENSE` and `NOTICE.md`.

## Requirements

- Docker Desktop, or Docker Engine with the Compose v2 plugin.
- About 3 GB of free disk for the image and the Postgres volume.
- On Windows, `docker.exe` must be on `PATH`. Docker Desktop normally adds
  `C:\Users\<user>\AppData\Local\Programs\DockerDesktop\resources\bin`.
  Open a new terminal after installing Docker, and verify with `docker version`.
- Optional: `node`, to apply the local patches to a locally fetched source tree on
  Windows. The image build applies them regardless.

## Install

```sh
# 1. Create the environment file and set a Postgres password.
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

# 2. Build and start.
docker compose up -d

# 3. First run: create the admin account at http://localhost:8787/setup
```

The pinned upstream source is fetched and checksum-verified during the first
build, which takes several minutes. Later builds reuse the cache.

`src/` is fetched by the build from the Go module proxy and is not committed. On
Windows you can also fetch it ahead of time with `./fetch-source.ps1`.

## Configuration

All settings are optional and live in `.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` | `artex` | Postgres user |
| `POSTGRES_PASSWORD` | required | Postgres password |
| `POSTGRES_DB` | `artex` | Postgres database |
| `ARTEX_VERSION` | `0.3.15` | Version string embedded in the binary |
| `ARTEX_IMAGE` | `artex:local` | Image tag |
| `WITH_CHROMIUM` | `1` | `1` installs Chromium (~400 MB); `0` removes browser automation |
| `WITH_RECON` | `1` | `1` installs the recon toolbox; `0` skips it |
| `ARTEX_LLM_PROVIDER` | empty | LLM provider profile |
| `ARTEX_LLM_BASE_URL` | empty | LLM base URL |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | empty | LLM credentials for the environment path |

## Ports

| Port | Used for |
| --- | --- |
| 8787 | Web UI and API |
| 8788 | Traffic-recording proxy (bound to `127.0.0.1`) |

## Data and persistence

Everything persistent is a bind mount inside this folder, so copying the folder
moves the whole state.

| Host path | Container path | Contents |
| --- | --- | --- |
| `data/` | `/app/data` | `jwt.key`, recorded traffic, MITM CA |
| `pgdata/` | `/var/lib/postgresql/data` | Full Postgres database |
| `skills/` | `/app/skills` | Skills |

`jwt.key` is symlinked into the data volume, so recreating the container does not
rotate the signing key and sign everyone out.

Stopping or removing the containers, or rebooting the host, keeps the data.
`src/`, `data/`, `pgdata/` and `.env` are gitignored and never committed.

## Browser automation

The agent drives a browser through the Playwright MCP. The image uses Debian's
Chromium (not the Playwright bundle), symlinked to `/opt/google/chrome/chrome`,
because Playwright resolves the `chrome` channel at that exact path. Running as
root requires `--no-sandbox`; pass it when configuring the browser MCP.

`WITH_CHROMIUM=0` drops the browser entirely (about 400 MB smaller); the agent
then only has Bash and HTTP tools.

## English localization

The upstream UI and backend contain Chinese strings. This repository translates
display text only:

- Build time: `patches/english-ui/localize-source.mjs` translates matched UI
  literals, JSX text and template parts with the TypeScript parser. Literals used
  for comparison (`includes`/`startsWith`/`endsWith`/`indexOf`, `==`/`!=`, `case`)
  and comments are left verbatim, and a `--check` pass fails the build if a string
  is left untranslated.
- Runtime: `patches/english-ui/EnglishOverlay.tsx` and the JSON dictionaries
  translate dynamic server text, placeholders, titles and aria-labels as a fallback.
- Backend logs: `patches/english-ui/apply-server-logs.mjs` rewrites only the format
  argument of `log.*` calls, so newly emitted logs are English.

Prompts, the tool descriptions and schemas sent to the model, skill content and
comparison tokens are deliberately **not** translated, because changing them can
change agent behaviour.

## Recon toolbox

When `WITH_RECON=1`, the image installs nuclei, httpx, subfinder, katana, ffuf,
dalfox and sqlmap. Every release asset is SHA256-verified at build time and a
mismatch aborts the build.

## Common commands

```sh
docker compose logs -f artex      # follow logs
docker compose restart artex      # restart after editing a skill
docker compose build              # rebuild the image
docker compose down               # stop (keeps data/ and pgdata/)
docker compose down -v            # stop and remove the image's anonymous volumes
```

`down -v` does not delete `data/` or `pgdata/` (they are bind mounts). To wipe
state, remove both folders after `down`.

## Security

ARTEX is an autonomous offensive agent: it scans, attempts exploits and decides
its own next step.

- Do not run it bridged into a home LAN; use NAT or host-only networking.
- Do not point it at systems you are not authorised, in writing, to test.
- `data/` holds `jwt.key`; do not commit or copy it carelessly.
- Port 8788 is bound to `127.0.0.1` on purpose: the recording proxy is a MITM.

## License

AGPL-3.0. This repository is a derivative work of ARTEX
(`github.com/Autumn-27/artex`, AGPL-3.0). See `LICENSE` and `NOTICE.md` for
provenance, checksums and third-party attribution.
