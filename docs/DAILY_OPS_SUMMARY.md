# Daily Ops Summary

`daily-ops-summary` is a deterministic, read-only Supabase Edge Function for
the authenticated owner's aggregate operations on one calendar date. It does
not call OpenAI, write rows, or use `service_role`.

## Contract

**Request**

```http
GET https://ywbrovislvqkfzsyqpiv.supabase.co/functions/v1/daily-ops-summary?date=2026-09-12
Authorization: Bearer <valid Supabase access token>
apikey: <publishable key>
```

The date is required and must be a real `YYYY-MM-DD` calendar date. Missing,
malformed, or impossible dates return `400`. Missing or invalid JWTs return
`401`. Other methods return `405`; `OPTIONS` is supported for CORS.

**Successful response**

```json
{
  "date": "2026-09-12",
  "earnings": 0,
  "operationalEarnings": 0,
  "hours": 0,
  "rides": 0,
  "miles": 0,
  "earningsPerHour": null,
  "earningsPerRide": null,
  "ridesPerHour": null,
  "completedShifts": 0,
  "hasActiveShift": false,
  "apps": {
    "uber": 0,
    "lyft": 0
  },
  "topZones": []
}
```

`apps` contains normalized lower-case app names that exist in the day record.
`topZones` contains `{ zone, rides, earnings }` only when the ride has a
captured pickup zone with an existing owner-confirmed human label and a
positive current earnings allocation. No zone key, coordinate, route,
address, ride ID, user ID, email, token, or raw provider payload is returned.

## Calculation rules

- `earnings` is the canonical day total from `weeks.entries`, including
  recorded bonuses/reward income.
- `operationalEarnings` follows Ask My Data's rule and excludes the Octopus
  reward app from operational efficiency metrics.
- `hours`, `rides`, and `miles` follow the canonical nested shift rules used by
  Ask My Data: valid completed shift durations, summed shift ride counts, and
  summed shift miles with day-mileage fallback.
- Efficiency fields divide `operationalEarnings` by those canonical hours or
  rides; they are `null` when the denominator is zero.
- Pickup earnings use current `earnings_snapshot_allocations`,
  `manual_ride_allocations`, later `ride_payments`, and single-ride batches,
  with the same effective snapshot-delta correction handling as Ask My Data.
  Earnings belong to captured pickup zones; acceptance and dropoff context are
  never treated as earnings locations.

## Security and deployment

The function creates a Supabase client with the caller's `Authorization` header
and the Supabase publishable/anon key. Every query is owner-filtered and still
subject to the existing `authenticated` RLS policies. It never creates a SQL
object or changes schema. Deploy with JWT verification enabled (the CLI default):

```bash
supabase functions deploy daily-ops-summary \
  --project-ref ywbrovislvqkfzsyqpiv \
  --use-api
```

Do not pass `--no-verify-jwt`. The function is source-only until that command is
run against the active project and authenticated QA is completed.
