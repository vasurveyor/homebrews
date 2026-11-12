"""Fetch public YouTube captions for pilot videos.

Requires: pip install youtube-transcript-api==1.2.3
Full transcripts are written under knowledge/private/ (gitignored).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from youtube_transcript_api import YouTubeTranscriptApi

ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE = ROOT / "knowledge"


def load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_ids", nargs="*")
    args = parser.parse_args()
    pilot = load(KNOWLEDGE / "pilot-videos.json", [])
    ids = args.video_ids or [item["video_id"] for item in pilot]
    manifest_path = KNOWLEDGE / "import-manifest.json"
    manifest = load(manifest_path, {"schema_version": 1, "extraction_version": "0.1.0", "videos": {}})
    api = YouTubeTranscriptApi()
    failures = 0

    for video_id in ids:
        old = manifest["videos"].get(video_id, {})
        try:
            transcript = api.fetch(video_id, languages=["en"])
            segments = [
                {"start_seconds": item.start, "duration_seconds": item.duration, "text": item.text}
                for item in transcript
            ]
            save(KNOWLEDGE / "private" / "transcripts" / f"{video_id}.json", {
                "video_id": video_id,
                "source": "youtube_transcript_api",
                "language": transcript.language_code,
                "is_generated": transcript.is_generated,
                "segments": segments,
            })
            old["transcript"] = {
                "status": "available",
                "source": "youtube_auto_captions" if transcript.is_generated else "youtube_creator_captions",
                "access_method": "youtube-transcript-api 1.2.3",
                "language": transcript.language_code,
                "is_auto_generated": transcript.is_generated,
                "timestamps": True,
                "failure": None,
            }
            print(f"{video_id}: available ({len(segments)} segments)")
        except Exception as error:  # library exposes several source-specific exceptions
            failures += 1
            old["transcript"] = {
                "status": "failed", "source": None, "access_method": "youtube-transcript-api 1.2.3",
                "timestamps": False, "failure": f"{type(error).__name__}: {error}",
            }
            print(f"{video_id}: failed ({type(error).__name__})")
        old.update({
            "video_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "retrieval_date": datetime.now(timezone.utc).isoformat(),
            "attempts": int(old.get("attempts", 0)) + 1,
            "review_status": old.get("review_status", "not_reviewed"),
            "extraction_version": manifest["extraction_version"],
        })
        manifest["videos"][video_id] = old
    save(manifest_path, manifest)
    return 2 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

