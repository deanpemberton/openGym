# Experimental structured Strava strength uploads

This fork adds **opt-in** structured strength uploading through Strava's JSON file format, while retaining openGym's existing Strava OAuth, refresh, encryption, outbound delivery queue and historical manual-upload behaviour.

Enable only on a test instance, after confirming that openGym's **Strava → Include strength training** toggle is on:

```env
STRAVA_STRUCTURED_STRENGTH=1
TZ=Pacific/Auckland
```

Without the flag, all existing Strava behaviour remains unchanged. The strength uploader uses `POST /api/v3/uploads` with `data_type=json`, then polls the upload ID. An accepted upload ID survives queue restarts. Uncertain initial POST results fail closed rather than risking duplicate activities.

**Cautions:** The initial exercise mapping is deliberately limited to the known routines in this deployment. Unknown exercises are omitted from structured sets but retained in the existing human-readable activity description. Unilateral sets without explicit sides are split only for recognized single-arm/core exercises with even aggregate repetitions. openGym's raw dumbbell weight is preserved unchanged: per-hand versus combined conventions are user dependent. Review exercise weight in Strava before relying on volume totals.

**Images:** Strava creates its own native muscle map from structured exercise sets. The existing public Strava API does not support uploading the PNG share card as an attached activity photo; that is not implemented in this initial feature branch.

## Tests

Follow upstream `api/test/strava.test.js` and `api/test/integrations.test.js`: `node:test`, `assert/strict`, fake Strava HTTP responses, the real integrations hub/outbox, isolated temp state, no live credentials.

Run from `api/`:

```sh
node --test test/strava-strength.test.js test/strava-structured-integration.test.js test/strava.test.js test/integrations.test.js
npm test
```

GitHub PR CI runs the standard `.github/workflows/test.yml` API suite on Node 26.

**Safety:** This is experimental; do not enable on the production instance until a controlled private test workout has been inspected for duplicate prevention, exercise mapping, units and time zone.
## Strava's complete documented exercise vocabulary (20 November 2026)

The integration now includes 572 distinct documented Strava `exercise_type` values
across 31 groups in `api/integrations/providers/strava-exercises.js`, drawn from
https://developers.strava.com/docs/uploads/ (including the latest published additions).
It accepts exact identifier names and case/punctuation-normalized readable equivalents.
A plain generic name like `plank` can map to `PLANK_GENERIC`; specific exercises take
precedence. OpenGym-specific equipment words (e.g. `lever` → `machine`) and a reviewed
alias table cover common nomenclature differences. Existing exercise ID overrides remain.
Unknown or ambiguous movements are intentionally left out of native sets and retained
in the activity's human-readable description, rather than mislabeled.

**Coverage is not the same as the number of exercises in openGym.** The openGym
catalogue contains 5,632 exercise entries, many of which have no equivalent in
Strava's 572 supported movement IDs. Built-in titles that match exactly or
through safe variants are auto-mapped, including variations labelled `v. 2`.
A custom exercise matching one of the supported Strava names can also map without
requiring a hard-coded openGym exercise ID.

The comprehensive API tests assert that all 572 identifiers resolve and are
unique, read all 5,632 openGym catalogue entries, confirm the expected training
routine mappings, and verify that unsupported names and equipment substitutions
remain unmapped. Tests mock Strava and never upload a real activity.

**Self-hosted deployment note:** This change adds a third required provider
module, `strava-exercises.js`. The Flatnet API-only overlay image must copy
all three files together. Importing the new mapper into the old two-file
overlay will fail API startup. Leave the prior known-good API image available
for rollback.
