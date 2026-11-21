# Clip quality evaluation

This dataset evaluates **finding the right moments and trimming them well**.
It includes five fingerprinted local videos (tennis, F1, football, interview,
and comedy). Media stays in the existing repository-root files; only paths,
SHA-256 fingerprints, durations, labels, and a small baseline are tracked here.

## First: review reference cuts

```sh
npm run eval:review
```

Open http://127.0.0.1:3002. Pick a video, seek to a moment, and mark:

- **Start / end:** the actual cut you would want to watch, including necessary setup
  and reaction. Do not simply accept the model's entire 60-second review window.
- **Peak:** a must-include instant inside the event (start inclusive, end exclusive).
- **Reviewer + reviewed:** confirms you inspected this reference against the source.

Save multiple moments per video. Optional negative intervals identify sections
that should not be clipped. Mark complete coverage only after labeling every
clip-worthy moment in that video. Partial annotations are supported: unmatched
predictions in unknown regions remain unscored, not false positives.

`references.json` begins with one **draft** imported from the Wimbledon model
suggestion. It is **not ground truth** and does not contribute to scores until
reviewed. No human-quality result is claimed for the initial dataset. Use the
prediction buttons to inspect outputs, but review the rest of the source as well
to avoid missing false negatives or anchoring every reference to model output.

The editor saves atomically with revision checking; conflicting edits return an
error rather than overwrite newer labels. It binds only to loopback and serves
only manifest-listed media. Saving references makes no model calls.

## Run the model

```sh
# New, real Gemini calls on the small development video:
npm run eval:run -- --video wimbledon

# Full five-video set (~91 minutes of source footage):
npm run eval:run -- --all

# Reserve held-out videos for final checks, not prompt tuning:
npm run eval:run -- --split test

# Experiment with a copy of evals/config.json:
npm run eval:run -- --video wimbledon --config /path/to/config.json --output .data/evals/experiment-1
```

Video IDs: `wimbledon`, `f1-monza`, `hot-ones`, `football`, `big-bang`.
The default selection is Wimbledon; running the entire set is explicit. These
commands send video/audio to Gemini with the server key and incur real API usage.
References never enter the model prompt. Probe cadence, post-roll, cooldown,
questions, and approval thresholds are configurable. Safety is not a question or
gate. The runner verifies source hashes before inference, calls the same
`clip-video.ts` / Decisions judge as local file clipping, and evaluates **all
approved candidates**, not just the six exported preview files.

Each run gets its own ignored `.data/evals/<timestamp>/` directory with:

- `run.json`: predicted source intervals, configuration, source fingerprints,
  token usage, completed video IDs, and failures.
- `<video-id>/results.json`: probe scores, candidate scores, and actual API exchanges
  with media bytes omitted.
- `references.snapshot.json` and `score.json`: exact labels and metrics used for
  this run. Source changes and incompatible fingerprints fail explicitly.

Runs do not export every video cut, keeping evaluations fast and compact. Use the
reference editor's prediction buttons to seek the original media. Existing run
outputs are not overwritten. Failed videos are reported separately and excluded
from quality metrics; a partial run is not a full-dataset result.

## Re-score and compare without API calls

```sh
# Initially reports needs-reference-labels and null quality metrics:
npm run eval:score

# Score a saved run after adding/revising references:
npm run eval:score -- --run .data/evals/<run>/run.json

# Use the same current references to compare runs over the same videos:
npm run eval:compare -- --before evals/baselines/wimbledon-initial.json --after .data/evals/<run>/run.json

# Inspect predictions from a particular run in the reference editor:
npm run eval:review -- .data/evals/<run>/run.json
```

`--references /path/to/references.json` freezes a particular annotation version
for scoring/comparison. Scores include the reference content and SHA-256 hash.
The initial baseline uses the existing real Wimbledon run, reclassified after
safety was removed. Its original model inference included the former safety
question; it is explicitly identified as such in its provenance.

## Metrics

| Metric | Definition |
| --- | --- |
| Event recall | Fraction of reviewed reference moments whose peak appears in a matched prediction. |
| Precision on reviewed regions | Matched predictions / (matches + known false positives). Not full-video precision under partial annotation. |
| Trim overlap | Mean temporal intersection-over-union of matched predictions and desired reference cuts. |
| Boundary error | Mean absolute start/end error in seconds across matched clips. Lower is better. |
| Extra footage | Mean seconds outside the desired reference interval. Lower is better. |
| Length ratio | Predicted duration / reference duration. Makes overly broad 60s cuts visible. |
| Well-trimmed recall | Fraction of reviewed moments found with IoU ≥0.5 and both boundaries within 5s. |

Matching is one-to-one and maximum cardinality, preferring larger overlap while
searching alternatives. It is not a globally maximum-IoU assignment. A single
long clip cannot count as several detected events. Extra predictions covering an
already matched event count as duplicates. Other unmatched predictions count as
false positives only in fully annotated videos or when at least 50% of the
prediction overlaps an explicitly reviewed negative interval. Everything else
is reported as unscored. No reviewed references means **null quality metrics**,
not a passing score. Empty outputs on labeled positives mean zero recall.

Eight scorer/config tests cover exact cuts, excessively long cuts, misses,
duplicates, ambiguous matching, partial coverage, invalid references, source
drift, and removal of the safety gate. Run with `npm test`.
