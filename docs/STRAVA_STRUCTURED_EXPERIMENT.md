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