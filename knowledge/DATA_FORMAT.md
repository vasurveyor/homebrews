# Portable data format (version 1)

JSON is the source of truth; Markdown is an export. All times are original caption
milliseconds, not estimated word offsets. Segment arrays are ordered; ranges are
zero-based and inclusive. Caption cues can overlap in time. Null means unknown,
not zero. Publication and retrieval are separate ISO dates/times.

A video record contains `id`, `title`, actual `creator`/optional `creator_id`,
canonical YouTube `url`, `published_at`, `retrieved_at`, `metadata_source`,
`coverage` (`transcript_backed` or `description_only`), `extraction_version`,
`review_status`, `completeness`, `relations`, and `findings`. Unknown fields can
be added without changing the recipe page. A relation records its target video,
type, and source passage; a creator link alone does not prove a correction or a
same-batch follow-up. The avocado comparison additionally relies on the explicitly
named link and follow-up context.

Private records may contain full `description` and `transcript`. Transcript fields
include `source`, optional `provider`, `source_url`, `language`, caption `kind`
(`asr`, `manual`, or unknown), `retrieved_at`, `sha256` of the imported bytes,
and `segments`. Public seed records retain only `transcript_provenance` and short
finding excerpts. The public catalog has no complete transcript or description.

Each finding has:

| Field | Meaning |
|---|---|
| `id` | Stable within its video |
| `kind` | ingredient, batch_size, stage, technique, explanation, troubleshooting, tasting, equipment, yeast, temperature, gravity, aging, abv |
| `mode` | creator_advice, creator_statement, batch_result, ai_interpretation, ai_calculation |
| `summary` | Attributed note; not permission to generalize a single batch |
| `stage` | e.g. primary, step_feed, secondary, conditioning, backsweetening, tasting; unspecified when uncertain |
| `topics` | Curated lexical tags |
| `evidence[]` | Supporting source(s), exact passage excerpt, source fingerprint, real start time or null; inclusive segment range for speech |
| `measurement` | Optional original text, role, value/unit if unambiguous, optional normalized calculation and preserved inputs |
| `calculation` | AI arithmetic only: formula, input finding IDs/values, result, units, limitations |
| `flags` | Uncertain ASR, ambiguous units, missing visuals, unsupported causal claims, source disagreement |
| `review_status` / `reviewed_by` | pending, transcript_checked, or source_checked; who checked it |

`creator_statement` is used for dated experience or explanations that are neither
a brewing instruction nor a result from the featured batch. `source_checked`
can refer to a description; `transcript_checked` does not mean anyone listened to
or visually verified the video. Pilot findings were curated by Codex and manually
compared to retrieved source text, not reviewed by the creator or a human brewer.

Measurement roles keep `original_gravity`, `intermediate_gravity`,
`fermentation_final_gravity`, `post_backsweetening_gravity`,
`post_backsweetening_target`, and `post_addition_gravity` distinct. Ambiguous
numbers retain their original string without a normalized numerical value.
Do not relabel a sweetened reading as fermentation FG just because the speaker
casually calls it “final gravity.” Recipe totals and staged additions are separate
facts and must not be double-counted.

The included calculation validator supports only `(og - fermentation_fg) * 131.25`
and links both unflagged source findings. It rejects post-sweetening input roles,
changed input values, and wrong results. This is an approximate pre-dilution ABV
estimate. It is not a calculator for step feeds, fruit extraction, or dilution.
A demonstrated pound-to-gram conversion retains its original value and factor;
other unit conversions require an explicit implementation/review, not silent guesses.

The lexical assistant does not resolve conflicts or elevate preferences to rules.
Catalog `comparisons` retain both sources, whether the difference is a possible
transcription conflict or a chronological change. The avocado follow-up comparison
lists specific finding IDs. If reprocessing removes those IDs or leaves them
pending, the comparison refuses to reuse stale text.
