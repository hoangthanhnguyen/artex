# Provenance notice

Verified on 2026-11-03. This file records where the source in this repository comes
from and which alternatives were checked, so the origin stays traceable.

## Source in use

| Item | Value |
| --- | --- |
| Upstream repository | `github.com/Autumn-27/artex` (deleted from GitHub) |
| Fetched from | `proxy.golang.org`, the Go module proxy |
| Version | v0.3.15, the last published tag |
| Published | 2026-10-07T12:54:02Z |
| Git commit | `e6ec56999175509551a1e43a3ee3b053d0941bd9` |
| Git ref | `refs/tags/v0.3.15` |
| Files | 600 |
| h1 (dirhash) | `maolFfGTu2/JCOSR1Lua75lNdA/DC9nfAYKonsmc/wE=` |

The `Origin` metadata is returned by the proxy at
`/github.com/!autumn-27/artex/@v/v0.3.15.info`.

## Checksums

```
github.com/Autumn-27/artex v0.3.15 h1:maolFfGTu2/JCOSR1Lua75lNdA/DC9nfAYKonsmc/wE=
github.com/Autumn-27/artex v0.3.15/go.mod h1:co3w1e4uo1uPJWi+2Eyinpuqutk54GofVoGvIFuZTIc=
```

`sum.golang.org` is a signed, append-only ledger. It proves the module content has
not changed since it was published; it does not prove authorship. For a deleted
repository this is the strongest verification still available.

## Published tags

19 tags: `v0.1.0`, `v0.1.1`, `v0.2.0`, `v0.3.0` through `v0.3.15`.

```bash
curl -sS 'https://proxy.golang.org/github.com/!autumn-27/artex/@v/list' | sort -V
```

## Alternatives checked

| Source | Result |
| --- | --- |
| `trhhubsd/ARTEX` | 600/600 files identical to v0.3.15; only `README.md` and `docker-compose.yml` changed (image pointed at `tomicdd/artex`). A copy, not the original |
| `instaboosterwesd/artex-browser-chat` | 355/589 files modified, 131 extra files. Contains `jwt.key`, `.env`, a 51 MB `bin/artex-linux-amd64` and a mitmproxy CA private key |
| `wufufu770/reArtex` | Self-labelled 0.4.0/0.4.1, no public checksum |
| `200210xsb/artex-full` | Self-labelled 0.3.19 to 0.3.22 |
| Docker Hub `autumn27/artex` | No longer exists |
| Docker Hub `tomicdd/artex` | Only `latest`, linux/amd64, pushed 2026-10-08, 652 MB; a fork of trhhubsd |
| Wayback Machine | Not usable for source code |

Conclusion: no maintained copy newer than v0.3.15 exists. The 0.4.x builds are
self-numbered fork products, not comparable to each other and not verifiable.

## Technical notes

Upstream's Dockerfile does not build from source: it `COPY dist/${TARGETARCH}/artex`,
requiring a prebuilt Linux binary produced only by its CI. This repository therefore
uses a rewritten multi-stage Dockerfile that builds both the frontend and the
backend inside the image.

## English translation

`localize-source.mjs` uses the TypeScript parser to translate literals, JSX and the
literal parts of template strings before compilation; interpolated expressions,
comments and regular expressions are left untouched. The runtime overlay
(`patches/english-ui/EnglishOverlay.tsx`) is a fallback for known dynamic strings;
it translates display attributes in place and skips input values, code and editor
regions and `[data-no-i18n]`.

Dictionary sources:

| File | Role |
| --- | --- |
| `locale-zh.json` | 2,839 base entries, from the `horizonl/ARTEX` fork, branch `english-ui` |
| `extra-zh.json` .. `extra4-zh.json` | Added here, from strings scanned out of the UI |
| `translations.json` | Base table (~2,619 entries): frontend and backend strings |
| `gen-dicts.mjs` | Generates `extra5-zh.json` (static map) and `auto-patterns.json` (regex) from `translations.json` |
| `auto-patterns.json` | Patterns for strings with placeholders: frontend `${...}` and Go `%s`/`%d`/`%q`/`%w` |
| `server-logs.json` | 178 backend log format strings to English |
| `translate-api.mjs` | Translates through an OpenAI-style chat/completions endpoint; the key is read from an environment variable |

The `locale-zh.json` dictionary comes from a fork based on an upstream older than
v0.3.15 (missing `validatePassword`, `InsertSettingIfAbsent`), so only its
dictionary is used, not its code.

The whole tree is a derivative work of ARTEX (AGPL-3.0) and keeps that license.

## Norma (the command harness)

ARTEX does not run shell commands directly: every agent command goes through the
`github.com/Autumn-27/norma` harness. Upstream v0.3.15 pins `v0.4.3`. This repository
adds a `replace` directive to use `github.com/BaaRai/Norma v0.4.4` (a superset, same
original module path `Autumn-27/norma`).

| Item | Value |
| --- | --- |
| Replacement module | `github.com/BaaRai/Norma v0.4.4` |
| h1 (dirhash) | `x5UAeaTuhREI1GiIYuwIEybRxr/pLCeCUvXmUbwv5Is=` |
| go.mod h1 | `BudWrf7iHl96FgHqFr/HwN3mKYmGjJDt+xL2ZHXfFZw=` |
| Hash source | `https://sum.golang.org/lookup/github.com/!baa!rai/!norma@v0.4.4` |
| Production files changed | 13 |
| Test files added | 7 |
| Upstream files removed/replaced | 0 |

The `replace` directive and the two `go.sum` lines are written by
`patches/goal-gate/apply.mjs`, not left to `go mod tidy`: the build runs
`go mod download` from `src/go.mod` plus `src/go.sum` only, so a missing checksum
line fails the build.

Changes in the replacement module:

| Group | Content |
| --- | --- |
| `llm/*`, `harness/query.go`, `noaadapter/project.go` | Gemini `thought_signature` round-trip |
| `tool/helpers.go`, `shell_session.go`, `task.go` | UTF-8 rune-safe truncation |
| `tool/task.go` | Clean old session; always set `PAGER`/`GIT_PAGER`/`SYSTEMD_PAGER`/`DEBIAN_FRONTEND` non-interactive |
| `llm/anthropic.go`, `types.go` | `Usage.MergeEcho`, avoiding a 0 input-token count when a provider reports 0 at `message_start` |

## Third-party skills

Vendored skills keep their own licenses. For example, `skills/php2shell/` is MIT
(see `skills/php2shell/LICENSE`).

## License

AGPL-3.0. The full text is in `LICENSE`.
