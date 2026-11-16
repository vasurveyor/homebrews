# Brewing knowledge pilot

This is a local companion to the public CSB Recipe Box. Ask questions in the
browser or CLI and get **retrieved, attributed findings with video citations**.
There is no general-purpose model improvising brewing answers. The pilot has ten
video records, nine English caption imports, and 75 reviewed findings. One video
is description-only after transcript access failures. Notes are deliberately
partial; these are not ten complete, executable recipes.

One educational selection is published under **City Steading Fermenstation**;
its actual creator/channel identity is retained rather than relabeled as CSB.
The corpus is ready for additional creators, but contains no Doin’ the Most
findings yet.

## Run

From the repository root, with Python 3.10+ installed:

```sh
python -m knowledge serve
```

Open <http://127.0.0.1:8765>. On Windows, use `py` instead of `python` if needed.
The server binds only to loopback and exposes the interface and `/ask`; it does
not serve repository files, raw transcripts, or private state. It is a personal
local server, not an authenticated multi-user deployment.

```sh
python -m knowledge status
python -m knowledge evidence EFPxb3n2Wuc fg
python -m knowledge validate
python -m knowledge ask "What does this creator recommend about backsweetening?"
python -m knowledge ask "Which videos discuss a stalled fermentation problem?"
python -m knowledge ask "backsweetening" --creator "City Steading"
python -m unittest discover -s knowledge/tests -v
```

Use `evidence VIDEO_ID FINDING_ID` to inspect a supporting excerpt, or add
`--context` with the private state to inspect the complete referenced passage.

The included catalog and short evidence excerpts work without private transcripts.
For a complete local audit or reprocessing, unpack the separately supplied private
state archive **outside this repository**, then pass its directory before the command:

```sh
python -m knowledge --state /path/to/csb-private-state validate
python -m knowledge --state /path/to/csb-private-state serve
```

Otherwise state defaults to `~/.local/share/csb-knowledge`. Set
`CSB_KNOWLEDGE_HOME` or use `--state` to change it. Private files are written
atomically with owner-only file permissions where supported. Keep the entire
state directory private. The software refuses state/export locations inside the
public repository, including resolved symlinks. Do not copy state into a Pages
publish directory, Git, or an Obsidian vault with public publishing enabled.

## What is stored where

| Location | Contents | Intended visibility |
|---|---|---|
| `index.html`, existing `.github/scripts/` and recipe workflows | Existing recipe site/updater | Public; unchanged |
| `knowledge/pilot.json` | Video metadata, partial curated findings, short supporting excerpts, real caption times, links, review flags | Public, reviewable pilot notes |
| `knowledge/access-report.json` | Observed transcript-access successes/failures; no signed URLs or credentials | Public |
| Private `videos/VIDEO_ID.json` | Full imported caption segments and creator descriptions, findings, source hashes | Local/private |
| Private `attempts.json` | Import successes, failures, duplicates, reprocessing events | Local/private |
| Private `candidates/` | Unreviewed passage windows for manual extraction | Local/private |
| Private `exports/` | Concise Markdown notes; no full transcript | Local/private until explicitly shared |

No personal batch notes or credentials were imported. No Second Brain vault was
opened or written. Public excerpts are not full transcripts. Exporting notes is
not authorization to publish someone else’s full captions.

## Transcript access and manual import

Access was tested before building the pipeline. See [access-report.json](access-report.json)
and [PILOT_REPORT.md](PILOT_REPORT.md). Watch-page metadata works here, but direct
signed caption requests returned `HTTP 200` with **empty bodies**. The connected
transcript provider worked for nine English tracks, with intermittent rate limits.
A page containing “Show transcript” is not itself a transcript. An outer tool
`success: true` is not enough: check each provider item for `error` and
`has_transcript`, the language, and nonempty timed segments.

The official YouTube Data API was **not** used to download other creators’
captions. Its ownership/authorization constraints make it unsuitable as a general
caption download path for this project. No video/audio was downloaded, and no
paid audio transcription was enabled.

Manual import accepts provider/normalized JSON, WebVTT, SRT, or plain UTF-8 text:

```sh
python -m knowledge import-transcript AtZE2YKbeUA /path/to/captions.vtt --source youtube_captions
python -m knowledge import-transcript AtZE2YKbeUA /path/to/creator.txt --source creator_transcript
python -m knowledge import-transcript AtZE2YKbeUA /path/to/transcription.json --source authorized_transcription
```

The last command imports an **already authorized transcription**; it does not
obtain audio or call a speech service. Confirm the file actually contains speech
from the selected video. Plain text imports have null timestamps. The importer
never uses a title, description, chapter list, or AI memory as substitute speech.
Use `--source-url` for a creator-provided transcript URL when appropriate. Preserve
uncertain terms in the transcript; mark uncertainty on extracted findings.

Minimum timed JSON (the text below is a synthetic format example, not evidence):

```json
{
  "video_id": "AtZE2YKbeUA",
  "has_transcript": true,
  "language_code": "en",
  "kind": "manual",
  "segments": [
    {"start_ms": 12500, "duration_ms": 2000, "text": "Synthetic format example."}
  ]
}
```

Firecrawl `youtube-com/videos/video_transcript` exports are also accepted, either
the inner record or a `data.alexandria` envelope. Retained tool results must be
exported in full; do not import a retention pointer or a partial page as a complete
transcript. Signed caption URLs expire; they are not stored as permanent citations.

Direct caption probing remains available, with explicit per-video commands:

```sh
python -m knowledge probe AtZE2YKbeUA
python -m knowledge retry AtZE2YKbeUA
```

These use the same free watch-page/caption route and record failures. Retry is an
explicit action; there is no retry loop or permanent “seen” suppression. Respect
provider `Retry-After` and service terms. Neither command calls the paid connected
provider. A network failure is not proof the video has no captions.

## Reprocessing and review

An exact repeated file import is idempotent. A changed transcript archives and
removes previous speech-based findings from retrieval until reviewed again.
Importing the exact pilot source file can retain findings only when its hash and
all evidence references match. Old private records override the public seed so a
new import cannot quietly fall back to stale public claims.

```sh
python -m knowledge reprocess VIDEO_ID
```

This versioned extractor conservatively selects relevant passage windows. It
**does not automatically convert those windows into reviewed brewing advice**.
Open the resulting private candidate JSON, compare the context with the source,
and create a findings file with:

```json
{
  "video_id": "AtZE2YKbeUA",
  "source_sha256": "copy the imported transcript sha256",
  "extraction_version": "manual-review-v1",
  "findings": []
}
```

Fill `findings` using the schema described in [DATA_FORMAT.md](DATA_FORMAT.md) and
the public pilot examples, then import:

```sh
python -m knowledge import-findings VIDEO_ID /path/to/findings.json
```

A finding needs an exact supporting passage, source segment range, real timestamp
or null, attribution mode, review status, and reviewer. Pending findings are not
searched. The importer checks source revision, passage text, segment bounds,
timestamps, calculations, and duplicate IDs. These checks establish traceability,
not semantic truth: the reviewer must still verify that a passage supports the
claim, especially causal claims and ambiguous measurements.

To add a video from another creator, supply metadata JSON with `id`, `title`,
`creator`, `published_at`, and canonical `url`; optionally include `creator_id` and
`description`. Then:

```sh
python -m knowledge add-video /path/to/metadata.json
```

This registers one description-only record with no inferred findings. Import a
transcript and review evidence separately. Duplicate video IDs are rejected.

## Markdown exports

```sh
python -m knowledge export
python -m knowledge export --out /path/to/staging-notes
```

Exports use video IDs for stable filenames, frontmatter, provenance, attribution,
review flags, and clickable timestamps. They exclude full transcripts and pending
claims. Export to a staging folder, review, and copy the notes into Obsidian yourself.
Do not point `--out` at your Second Brain during this pilot. Existing files with
the same video IDs in an export directory are replaced, so use a dedicated folder.

## Services, credentials, costs, and update policy

| Operation | Requirement/cost |
|---|---|
| Included notes, search, local UI, validation, exports | Python stdlib; no API keys, model charges, subscriptions or embeddings |
| Direct watch/caption probe | Internet/YouTube access; no paid API used; can fail or be blocked |
| Connected transcript import used in this pilot | Firecrawl connection; contract reported **5 credits per video transcript**; one-off manual acquisition, not built into scheduled jobs |
| Plain page scrape tested as fallback | **1 credit** observed; returned page/chapters/comments, not spoken transcript |
| Future authorized audio transcription | Not enabled; requires lawful audio access, an explicit service choice, and its per-minute pricing |
| Existing recipe updater | Existing optional `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; unchanged and separate |

Observed one-off retrieval receipts totaled 55 transcript credits (nine English
tracks and two default-language tracks not used) plus one page-scrape credit.
Rate-limited calls reported zero credits. Dollar conversion depends on the user’s
provider plan and is not known here. No new credentials are required for the
working local pilot. Keep future keys in environment variables or a private
service configuration, never in JSON, exports, or Git. `.env` files are ignored.

No new recurring or full-channel processing was enabled. The new CI workflow only
runs offline tests and validation; it has no secret access or deployment step.

## Limitations and next stage

Search is lexical over reviewed notes, not every raw caption token. Generic
follow-up and disagreement demonstrations are curated evidence comparisons, not a
universal contradiction detector. Unsupported questions return “Insufficient
evidence”; ambiguous broad searches may return related evidence rather than a
complete answer. Semantic similarity would not fix missing sources or review.

The pilot uses automatic captions, not audiovisual verification. Numbers, spice
counts, visual hydrometer readings, and handling demonstrations can require
watching the video. The remaining English transcript failure, numeric ambiguities,
and a genuine cross-creator disagreement are open items. See the report for the
manual source checks and [remaining-channel proposal](PILOT_REPORT.md#remaining-channel-proposal).
