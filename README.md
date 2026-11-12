# CSB Recipe Box

The existing GitHub Pages recipe catalog remains in `index.html`. The source-backed knowledge pilot is separate under `knowledge/`; the weekly recipe-card updater continues to own the page structure and counts.

## Knowledge pilot

The pilot contains 10 City Steading Brews videos spanning recipes, instruction, troubleshooting, experiments, and a recipe/follow-up tasting pair. Each finding is classified as creator advice, a reported batch result, an AI interpretation, or a calculation and carries an evidence passage plus timestamp where captions provide one.

```powershell
npm test
npm run knowledge:validate
npm run knowledge:ask -- "What does this creator recommend about backsweetening?"
npm run knowledge:export
```

The search is deliberately lexical and dependency-free. It is small, inspectable, and adequate for this pilot; semantic search would add cost and make evidence selection harder to audit without a demonstrated retrieval problem.

### Sync the full Recipe Box without duplicates

`npm run knowledge:sync` reads the existing recipe cards, keys records by the canonical 11-character YouTube video ID, rejects mismatched card/URL IDs, and skips duplicate IDs. It writes a portable inventory plus catalog-only knowledge records. Reviewed pilot records override matching catalog records during search and export, so the seven pilot videos also present in the Recipe Box are not duplicated.

Catalog-only records preserve the existing card's title, date, category, ingredients, and stated gravity/ABV, but are explicitly marked `catalog_only_needs_transcript_review`. They are not presented as transcript-backed findings. Fetch captions with `.venv\\Scripts\\python.exe knowledge\\scripts\\fetch-captions.py`; successful prior imports are skipped, failures remain retryable with `--retry-failed`, and `--force` reprocesses every requested ID. The normal Obsidian export includes reviewed records only; add `--include-catalog` when provisional catalog-only notes are wanted.

The 2026-11-12 full Recipe Box attempt retained the seven previously successful recipe-video transcripts and recorded `IpBlocked` for all 295 new IDs. Those failures are intentionally committed in the manifest so another environment can retry them without treating the catalog fields as transcript evidence.

### Transcript access tested on 2026-11-12

| Method | Result in this environment |
|---|---|
| YouTube watch-page metadata | Worked for metadata and advertised caption tracks |
| Direct advertised timed-text URL | Returned HTTP success with an empty body for all 10 pilot videos |
| `youtube-transcript-api==1.2.3` | Worked for all 10 videos, returning timestamped English auto-captions |
| Official YouTube Data API caption download | Not used; it generally requires authorization to manage/download caption resources and is not assumed to work for another creator |
| Manual transcript import | Supported by `node knowledge/scripts/import-video.js VIDEO_ID --manual PATH` when authorized text is supplied |
| Audio transcription | Not used; no audio was downloaded and no paid transcription was enabled |

To retry public caption retrieval:

```powershell
python -m pip install youtube-transcript-api==1.2.3
python knowledge/scripts/fetch-captions.py
```

The importer is idempotent by video ID, increments attempt counts, records failures, and allows reprocessing. Full transcripts are written to `knowledge/private/transcripts/` and excluded from Git. Committed records contain only short supporting excerpts. A failed record remains in `knowledge/import-manifest.json` and can be retried; absence of a transcript must never be filled from a title, description, or model memory.

### Data layout

- `knowledge/videos/pilot.json`: portable JSON knowledge records and evidence excerpts.
- `knowledge/import-manifest.json`: import attempts, source, extraction version, and review state.
- `knowledge/pilot-videos.json`: selected IDs and their pilot roles.
- `knowledge/private/`: ignored full transcripts and any personal notes.
- `knowledge/exports/obsidian/`: generated concise Markdown notes; generation does not write to an Obsidian vault.
- `.env*`: ignored credentials. This pilot requires no credentials.

All original quantities are retained as strings. Normalized values are optional and explicitly marked as calculated with their inputs. Gravity fields distinguish fermentation final gravity from gravity after backsweetening. Auto-caption uncertainty and visual-only checks are carried in the record for review.

### Costs and services

The checked-in workflow uses free public pages/captions, Node, Python, and one pinned Python package. There is no recurring job and no enabled paid service. Public caption access can change or be blocked by IP/region; manual import is the fallback. Future authorized audio transcription would incur provider or compute costs and should be opt-in, with audio and full transcripts kept private.

### Updating and expanding

1. Add video IDs and roles to `knowledge/pilot-videos.json` (include educational videos even without recipes).
2. Run the caption importer; inspect failures and use manual import only for legitimately obtained transcript text.
3. Extract short, attributed findings into JSON. Preserve description-only status when no transcript exists.
4. Run validation and manually compare quantities, stages, gravity labels, and several timestamp links against the video.
5. Set review status only after that comparison, then regenerate the Obsidian export.

For the remaining channel, process small review batches (for example 20 videos), prioritize explicit recipe/follow-up links and troubleshooting topics, and keep an exception queue for missing captions, uncertain measurements, and visual-only evidence. Add another creator as a separate source namespace so disagreements stay attributed rather than flattened into a single “rule.”

## Existing site compatibility

Do not rename or restructure the five drink sections in `index.html`, card IDs, filter counts, or the updater's expected count strings. The knowledge pilot does not modify `index.html`, `.github/scripts/update-recipes.js`, or the scheduled updater workflow.

