# Pilot report — November 11, 2026

## Result and scope

A local browser/CLI knowledge assistant, ten cataloged videos, nine imported
English automatic-caption tracks, and 75 partial evidence-linked findings.
The public recipe page, existing updater, recipe workflows, and seen/flagged
state are unchanged from inspected commit `452fcccec6c113c24bab9d41efd0bd3cd94ac03e`.
No deployment, recurring paid processing, full-channel import, personal batch-note
import, or Second Brain write was performed.

This is a usable reviewed-notes pilot, **not a completed transcript collection or
an autonomous recipe extractor**. One video remains description-only. Candidate
extraction is repeatable, but promotion to advice/findings requires source review.
There is no confirmed cross-creator disagreement in this CSB-family selection.

## Repository/updater inspection

The repository had one `index.html`, two utility scripts, recipe/removal workflows,
and seen/flagged JSON; no `AGENTS.md`, package manifest, or test suite was present.
The updater reads the most recent YouTube RSS entries and tries each watch page
for a fuller description. It optionally calls Claude, falls back to a rule parser,
adds ingredient cards, and records no-recipe/unread cases. Its workflow commits
recipe changes and requests a Pages rebuild. Educational/tasting videos without
an ingredient list become seen/flagged records rather than searchable knowledge.

The existing updater is therefore a **description-based recipe importer**, not a
speech pipeline. Its `fg`/ABV fields are not the evidence model for this pilot.
The companion keeps separate original, intermediate, fermented, post-addition,
and post-sweetening measurements, and labels its own calculations. No existing
card was silently reinterpreted as transcript-backed knowledge.

All changes are additive on `feat/source-backed-brewing-pilot`. The new workflow
only runs offline validation/tests with `contents: read`; it has no scheduled
acquisition or publishing step.

## Transcript-access experiment

| Route actually tested | Observation | Decision |
|---|---|---|
| YouTube RSS and watch pages | Feed and all ten watch-page metadata requests succeeded | Metadata/descriptions only; not evidence of speech |
| Signed YouTube caption URLs for the avocado follow-up | JSON3 and XML returned HTTP 200 with zero bytes | Record a failure, not an empty successful transcript |
| Connected `youtube-com/videos/video_transcript` provider | Nine English timed ASR tracks exported; some attempts rate-limited with a 60-second retry interval | Working pilot route; preserve failures and provenance |
| Provider default language | Two requests selected Arabic ASR before an English track was explicitly selected | Those tracks were not used as English evidence |
| Plain video-page scrape fallback | Page/chapters/comments/recommendations; “Show transcript” without speech | Excluded from transcript-backed findings |
| Official YouTube API caption download | Not used | No assumption that another creator’s captions are downloadable with a personal API key |
| Audio download/transcription | Not used | No audio acquisition, transcription credential, or paid recurring service enabled |

The access report preserves provider request IDs and each latest result. Successful
track counts were checked during export. Failures in an outer successful tool
response were not treated as imports. Source access is environment-specific and
must be probed again on another machine or runner.

## Pilot inventory

| Video | Coverage | Topics / role |
|---|---|---|
| [Avocado Mead — Really?](https://www.youtube.com/watch?v=geBml1e3zFY) | English ASR, 633 cues | Original recipe, mixing, gravity |
| [Avocado Mead — additions and adjustments](https://www.youtube.com/watch?v=EFPxb3n2Wuc) | English ASR, 1,571 cues | Linked follow-up, spices, stable gravity, later sweetening |
| [Our Backsweetening Secrets](https://www.youtube.com/watch?v=wkMfTcUg4IY) | English ASR, 753 cues | Instructional discussion; actual publisher City Steading Fermenstation |
| [Sweetening, Adjusting Flavors…](https://www.youtube.com/watch?v=TM83WJvfKBA) | English ASR, 873 cues | Instruction, stalled-batch discussion, ABV inputs |
| [Stabilizers in Mead: Mistake?](https://www.youtube.com/watch?v=qupXap5BBOE) | English ASR, 1,184 cues | Controlled batch comparison, subjective tasting, dated experience |
| [Wild Yeast Fermentation Gone Bad](https://www.youtube.com/watch?v=AtZE2YKbeUA) | **Description-only** | English transcript attempts rate-limited; no speech findings extracted |
| [Peach Perry… Everything Went Wrong](https://www.youtube.com/watch?v=-0mXCpl6KfY) | English ASR, 2,051 cues | Recipe stages, suspected stall, later apple-juice addition |
| [Dandelion Wine](https://www.youtube.com/watch?v=vXMZRdNbNvc) | English ASR, 1,099 cues | Recipe, fermented versus sweetened gravity |
| [Red Hots Mead](https://www.youtube.com/watch?v=SP9adI1mLoA) | English ASR, 1,270 cues | Staged honey feeds, candy/water additions |
| [Caramel Apple Bochet — one year](https://www.youtube.com/watch?v=mK0d4ulSvrw) | English ASR, 1,801 cues | Combined recipe/conditioning/one-year tasting, extra honey, ambiguous numeric captions |

Full publication/retrieval times, creator/channel IDs, source fingerprints, and
related creator links are in the data. Related links outside these ten are recorded
as links only; they were not processed as additional pilot videos.

## Manual source comparison

Here “manual” means Codex compared the curated notes against the retrieved creator
description and English caption context. **It does not mean a human brewer checked
the notes or that audio/visual content was verified.** All 75 findings were checked
for exact passage membership and timestamp alignment against the private sources.
The checks below concentrated on ingredients, sequence, and numerical traps.

| Source check | Comparison and disposition |
|---|---|
| Avocado original: honey and OG | Description’s 2½ lb agrees with spoken amount around 5:56. The measured OG is 1.096 around 13:05, not the earlier erroneous 1.020 sample. Original water alternatives (96 oz / 2700 mL) remain approximate and flagged; they are not silently made equivalent. |
| Avocado follow-up: stages | Reading 1.016 at about 4:15 is explicitly preliminary. Stable 1.012 around 11:26 is kept as fermented FG. Description supplies 2 small cloves, 2 cracked cardamom pods, 20 allspice berries; caption context around 17:00–18:15 agrees on smaller cloves/pods/roughly twenty berries, with a “half cloves” ASR artifact in context. Later sweetened 1.022 around 46:36 is separate. |
| Backsweetening lesson | About 4:22 rejects one universal target gravity; 18:12 describes small additions with repeated tasting. These are creator recommendations, not a measured sugar dose that can be copied to every batch. |
| Dandelion: quantities and gravity | Caption around 0:15 states 2 lb sugar; around 1:42 estimates 15 g freeze-dried flowers; description retains original alternatives. Around 18:51 the calculation uses 1.080 → 0.994, whereas around 23:04 the later sweetened reading is 1.016. No ABV calculation uses the latter. |
| Red Hots: stage totals | Recipe total is 4 lb honey in 2 + 1 + ½ + ½ lb feeds. Around 27:03 the captions identify five 4½ oz candy bags, and around 27:22 two cups of dissolving water. Original 1.070 precedes feeds; 1.072 around 32:32 is after candy. Do not treat these as simple original/final inputs. |
| Caramel apple: omissions and ASR | Initial description has one cooked + one uncooked pound of honey; around 26:29 another pound is added. Later readings show continuing fermentation. The extra feed is retained separately. Caption “1.18” is not normalized to an invented 1.118 or 1.180. One-year aroma comments near 55:15 differ from early spice-dominant tasting near 32:12. |
| Stabilizer experiment | Fermented 0.998 precedes split/sweetening. Proposed 1.012–1.014 is a sweetness target, not measured fermented FG. Preferences are limited to the tested batch. The pilot’s own 9.45% ABV arithmetic links 1.070 and 0.998 and explicitly excludes later dilution. |
| Troubleshooting and disagreement | pH is a host hypothesis, not a confirmed cause. “Yeast holes” is uncertain ASR likely referring to hulls. Caption coefficient 135 versus another video’s 131.25 remains a possible transcription conflict. February “never used” stabilizers and August testing them are chronological change, not simultaneous contradictory rules. |

Description-based ingredient findings are marked `source_checked`, with untimed
description citations. Transcript-derived observations are `transcript_checked`.
The evidence model can preserve a passage even where its claim is uncertain;
flags prevent it from masquerading as settled brewing knowledge. Visual identity
of tasting samples, hydrometer scales, and uncertain ASR numbers remain appropriate
items for a person to verify in the videos.

## Answer demonstrations

[SAMPLE_ANSWERS.md](SAMPLE_ANSWERS.md) is generated by the actual assistant code.
It demonstrates the four requested questions plus unsupported questions.

- Backsweetening: source-attributed advice to add small amounts, taste repeatedly,
  and choose sweetness for the particular brew.
- Recipe versus later tasting: the explicitly linked avocado follow-up adds spices
  and later sweetens; fermented and sweetened readings remain distinct.
- Fermentation problem: retrieves the peach-perry possible stall and instructional
  discussion of a suspected pH-related stall, with uncertainty intact.
- Disagreement: presents a **candidate** numerical-caption conflict and a dated
  experience change. The pilot cannot honestly demonstrate a confirmed two-creator
  disagreement because none was established by this selection.
- Unsupported arsenic testing or xylitol guidance: “Insufficient evidence,” even
  when the question includes a familiar term such as backsweetening.

Citations use cue starts or description labels; no chapter times were assigned to
speech. Automated citation checks verify exact passage membership, source revision,
segment range, and start time. They do not prove every factual claim is true or
that a subjective preference is generalizable.

## Verification

- 24 offline unittest tests: ingestion failures/retries, deduplication, VTT/SRT and
  untimed imports, non-finite/negative/out-of-order timestamps, passage mismatches,
  changed source versions, stale findings, candidate review isolation, gravity
  roles, calculation and normalization inputs, retrieval, creator filtering,
  honest insufficiency, Markdown exports, and public/private path separation.
- Actual HTTP integration test: starts the local server, asks a question, verifies
  source links, rejects private/raw file routes, malformed JSON, and foreign origins.
- Catalog validation passes against the public excerpts and separately against
  all nine private caption sources and full creator descriptions.
- Browser visual QA **not completed**: Playwright’s bundled browser was absent;
  launching installed Chromium failed because the execution sandbox denied its
  process-singleton socket. This is a specific environment limitation; desktop
  and mobile rendering have not been claimed as verified.
- Existing recipe page/updater/workflow/state are byte-identical to the inspected
  base. No existing recipe workflow was executed.

## Remaining channel proposal

1. First complete the missing English import and audiovisual review of flagged
   quantities, then freeze an evaluation set of real questions and known answers.
2. Discover metadata into a queue keyed by video ID. Use RSS for recent uploads
   and an authorized metadata source for older inventory. Treat public metadata
   access separately from transcript access; do not assume an API key grants
   third-party caption download permission.
3. Acquire captions in small, explicitly budgeted batches. Select a verified
   language track, save original inputs privately, record costs and failures, obey
   retry intervals, and support creator-provided/manual transcripts. Only consider
   audio transcription after access, service, and budget are explicitly authorized.
4. Run versioned candidate extraction, followed by schema-constrained extraction
   if a chosen model materially saves review work. Require original quantities,
   roles/stages, input-linked arithmetic, exact supporting passages and flags.
   Treat transcript text as data, never pipeline instructions. Do not auto-promote
   model output to reviewed claims.
5. Check recipe quantities and transitions for every recipe; sample additional
   technique passages and all contradictions/corrections. Confirm same-batch links
   from evidence, not title similarity. Preserve superseded claims with dates and
   correction relations rather than erasing the earlier source.
6. Evaluate lexical recall/citation precision and unsupported-question behavior.
   Consider SQLite FTS before embeddings. Add semantic retrieval only if measured
   missed relevant evidence justifies its dependencies/cost; keep JSON authoritative.
7. Add Doin’ the Most as a separately attributed creator and deliberately choose
   paired discussions to establish genuine supported disagreements. Export to an
   Obsidian staging folder for user review, not directly to the vault.
8. For sharing/self-hosting, add authentication/TLS and explicit access boundaries;
   this loopback pilot server is not an internet-facing production service. Enable
   a schedule only after approval, with per-run video/cost limits, retry queues,
   atomic updates, review gates, and private source backups.

No part of this proposal has been enabled as a recurring job or full-channel run.
