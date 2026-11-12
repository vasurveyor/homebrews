# CSB Recipe Box

The existing public recipe site is at <https://vasurveyor.github.io/homebrews/>.

A separate, local **source-backed brewing knowledge pilot** lives in
[knowledge/](knowledge/README.md). It includes a browser interface, command-line
questions, a ten-video catalog, evidence-linked notes, manual transcript import,
retry/reprocessing tools, and Markdown exports. Nothing in the pilot deploys or
changes the recipe page or its updater.

```sh
python -m knowledge serve
# Open http://127.0.0.1:8765
```

Python 3.10+; no packages, account, model, or API key required for the included
reviewed notes. See the [pilot report](knowledge/PILOT_REPORT.md) for source
access, verification, limitations, and what remains unfinished.
