# Streex App Status Master

Last updated: 2026-10-17

This is the living master status file for Streex Gig Earnings. Claude, ChatGPT, Codex, and Lovable should read this file before giving product, UX, architecture, or implementation advice.

Use this with:

- `README.md`
- `AGENTS.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/STREEX_AI_WORKFLOW.md`
- `docs/ROADMAP.md`
- `CHANGELOG.md`
- `src/lib/changelog.ts`

Do not place secrets, private keys, service-role keys, passwords, or production credentials in this file.

## Current Release

Current public app version:

```text
Beta 0.9.6 - Earnings Attribution Integrity
```

Current local source candidate:

```text
Beta 0.11.2 - Operational Day & Overnight Shift Integrity
```

Next approved product sequence:

```text
Beta 0.11.0 - Ride Lifecycle: En route, Pickup & Finish (local candidate; active-backend migration required)
Beta 0.10.0 - Movement Capture & Zone Context (implemented on main; active-backend migrations applied; real-work QA continuing)
Beta 0.10.1 - Zone Intelligence & Evidence (implemented on main; authenticated owner QA required)
Beta 0.10.2 - Ride Allocation Integrity & Quick Actions Stability (implemented on main; active-backend migration applied)
Beta 0.10.3 - Zone Map & Confirmed Labels (implemented on main; active-backend migration applied)
Beta 0.10.4 - Weekly Ride Allocation Review (local candidate; no new migration required)
Beta 0.10.5 - Closed-Week Allocation Access (local candidate; no new migration required)
Beta 0.10.8 - Historical Snapshot Safety (local candidate; no new migration required)
```

Source of truth:

- `src/lib/changelog.ts`
- `CHANGELOG.md`

## Current Infrastructure

Streex Gig Earnings now runs outside Lovable production infrastructure for the live app.

Production web app:

```text
https://gig.getstreex.com
```

Domain and DNS:

```text
getstreex.com
Cloudflare DNS active
Cloudflare email routing active
```

Frontend hosting:

```text
Vercel
```

Current Supabase backend:

```text
Project URL: https://ywbrovislvqkfzsyqpiv.supabase.co
Project ref: ywbrovislvqkfzsyqpiv
```

Legacy Lovable-managed Supabase project:

```text
mnwymfyvvdhekzvipjmp
```

The legacy Lovable Supabase project should be treated as historical/legacy context unless the user explicitly says otherwise. Do not deploy new migrations or Edge Functions there by default.

### 0.9.2 Data Safety Backend

The active Supabase project has the additive migration
`20260711013903_add_week_revisions_and_conflict_save.sql` applied. It provides
owner-scoped week restore points and optimistic-concurrency RPCs for week saves
and restores. Historical migration metadata was reconciled only after the live
schema was verified; no historical migration SQL was re-executed and no user
data was rewritten.

The 0.9.2 frontend was published by the owner after the baseline audit.

### Pre-0.9.3 Account Readiness Foundation

The active Supabase project now has the additive migration
`20260715033547_account_readiness_onboarding.sql` applied and the active
`admin-ops` Edge Function deployed with its account-support actions. The
migration adds owner-scoped onboarding state and server-only admin audit events;
it does not alter weeks, earnings, shifts, mileage, rides, snapshots, or
historical metrics.

The frontend is published with clear email-confirmation state, safe password
recovery, Turnstile support, a guided-start checklist, legal routes, and limited
admin account support controls. The owner configured and exercised custom SMTP
confirmation/recovery delivery and Cloudflare Turnstile after publication.

The Supabase security advisor's leaked-password-protection warning remains a
separate Auth policy decision, not a schema defect.

### 0.9.3 Live Work Mode Source — Withdrawn

The local source adds `/live-work` as an explicitly separate Beta workspace
available from the person/account menu before Settings. It uses the existing
week, shift, Quick Update, mileage, ride-attribution, sync, and Octopus paths;
it does not replace Dashboard, Entry, Full Focus, or any analytical surface.
Owner testing found that the separate workspace did not add enough value. The route and account-menu access are removed; the unreferenced page source remains archived and is excluded from the published bundle.

### 0.9.4 Operational Explorer & Driver Playbook

Published and owner-verified through more than one week of real work. Deep
Insights includes custom and multi-day filtering, local operational time
windows, weighted operating rates, evidence labels, hourly profiles,
best-window rankings, and an anonymous three-card JPG Driver Playbook. Quick
Update records additive owner-only operational observations for better future
timing precision. No historical week or snapshot was rewritten.

### 0.9.5 Release Certification & Performance

Published source baseline. It splits authenticated workspaces into
route-loaded bundles, defers image-export code until an export is requested,
removes inherited Lovable social metadata, adds a public browser smoke to normal
CI, and upgrades the manual release gate to desktop/mobile protected-route and
bidirectional read-only RLS checks. It changes no stored data or calculations.

### 0.9.6 Earnings Attribution Integrity

Published and under real-work owner testing. It separates observation time from earned time
for positive Quick Update deltas, adds explicit current-interval, completed-shift,
exact-time, and review-later choices, and keeps unresolved late earnings out of
hourly efficiency. An owner-only Data Health queue resolves ambiguous current or
historical observations without altering reported totals or deleting the original
append-only snapshot. One canonical attribution layer feeds Shift Intelligence,
Operational Explorer, Deep Insights, Entry, History, Career, Daily Report, and
Driver Playbook. The additive active-backend migration and production RLS
verification are complete: `20260802181319_earnings_attribution_integrity_096.sql`
creates the owner-scoped table and `20260802181403_harden_earnings_attribution_privileges_096.sql`
explicitly removes anonymous access and authenticated delete/truncate privileges.
The initial frontend is published. The current local QA refinement lets active-shift
intervals update Operations Snapshot before End Shift, validates exact time against
worked blocks and pauses, and separates same-weekday output from weighted hourly
efficiency without changing any reported total or stored snapshot.

The same candidate also hardens the live shift interaction: the header now uses
one compact state trigger, while Quick Actions presents large Start, Pause,
Resume, and End controls beside the two primary earnings updates. A synchronous
single-flight guard prevents double taps before React can redraw the saving state.

### 0.9.7 Historical Data Import (Local Candidate)

Implemented locally on `main`; not yet committed or published. History now includes
a downloadable Excel template and a preview-first import flow for Daily Earnings,
Optional Shifts, Pauses, and Bonuses, with CSV compatibility for the normalized daily
format. Validation catches malformed dates/numbers, duplicate or overlapping timing,
conflicting metadata, mismatched ride/hour detail, and source totals below known detail.
Existing non-empty values are preserved by default and conflicts block confirmation.
Historical day-level `worked_hours` and `daily_rides` are retained when exact shift
timing is unavailable; real shift boundaries and pauses create precise work blocks.
The save path explicitly suppresses earnings snapshots for imported history, so an old
record cannot appear to have been observed at import time. Owner QA should import a
small historical sample, reload it, verify totals and metrics, then gradually backfill
older weeks before publication.

### 0.9.8 Snapshot Correction Reconciliation (Local Candidate)

Temporary reductions in a Quick Update accumulated total, followed by a correction, are preserved in the append-only snapshot ledger but no longer become extra earnings in shift rates or hourly intelligence. The analytical layer nets the recovery against the earlier reduction before Shift Intelligence, Deep Insights, Operational Explorer, Driver Playbook, and Data Health consume it. The authoritative day total remains the control for completed single-shift days. No row, source amount, week JSON, or historical snapshot is rewritten; Data Health separately counts reconciled corrections and only warns when a correction remains unrecovered.

### 0.9.9 Operations Snapshot Integrity & Performance (Local Candidate)

The weekly Operations Snapshot headline now derives its operational `$ / hour`, `$ / mile`, and `$ / ride` directly from the authoritative final operational total and actual worked duration. Snapshot observations remain the evidence for timing and hourly rankings, but cannot lower or inflate the weekly headline after a temporary accumulated-total correction. Reconciliation and hourly attribution are shared across a single intelligence pass rather than rebuilt per snapshot, removing the growing-history performance cost from Quick Actions and navigation. Original snapshots, stored week JSON, and reported earnings are unchanged.

### 0.9.10 Route Bundle Performance (Local Candidate)

Route-only UI primitives and icons no longer inflate the shared authenticated entry bundle. Compare renders its small cumulative preview without the charting library and loads its detailed interactive chart only after the user opens it. Cumulative reference trends remain visible before the first current-week day is logged. Historical Excel import and image export remain on-demand actions. No app data, analytics logic, backend, or persisted values change.

### 0.9.11 Deep Insights Productivity (Local Candidate)

Operational Explorer now saves recurring filter combinations locally per signed-in account and browser, covering the selected period, app, weekdays, and operating window. Its CSV export includes the active filters, evidence source, timestamp-observed coverage, summary metrics, hourly profile, and weekday profile. These are convenience and analysis outputs only: no week, financial value, snapshot, attribution, or Supabase row is changed.

### 0.9.12 Multi-Shift Ride Accumulation Integrity (Local Candidate)

Quick Actions now accepts rides as each app's accumulated total for the day, matching the established earnings and mileage workflow. It calculates only the difference and assigns that delta to the active shift, so a second shift cannot duplicate rides already recorded in the first. Corrections reduce recent known app rides first. Existing rides without app ownership are preserved and block a risky app-total update rather than being guessed or rewritten. No historical record, earnings, mileage, snapshot, attribution, or Supabase row is automatically changed.

### 0.9.13 Deep Insights Operations Snapshot Comparison (Local Candidate)

Deep Insights → Compare now has an Operations Snapshot lens alongside the existing Performance lens. It compares the same duration, earnings-per-hour, mileage, rides, efficiency, shift-structure, and active-day metrics used by the Dashboard snapshot across two to four selected periods. A historical Operations Leaderboard can rank completed days, weeks, or months by a selected operational measure. The lens is intentionally all-app only, excludes building periods from full-period ranks, and calculates hourly efficiency with the Dashboard's canonical work-block rules so earnings without recorded work time do not distort the result. No persisted data, snapshots, or historical records are changed.

## Backend Rules

Streex still uses one active production backend.

Current rule:

```text
Vercel app at gig.getstreex.com
-> owner-controlled Supabase project ywbrovislvqkfzsyqpiv
-> all active Streex data and persistence
```

Do not create or assume another Supabase project.

Before applying migrations, deploying Edge Functions, or changing auth settings:

1. Confirm the target project is `ywbrovislvqkfzsyqpiv`.
2. Confirm the change is intended for the active production backend.
3. Never expose service-role keys or secrets in frontend code or documentation.

## Deployment Notes

Vercel environment variables required:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

Vercel build:

```text
npm run build
```

Output directory:

```text
dist
```

Supabase Auth must allow:

```text
https://gig.getstreex.com
https://gig.getstreex.com/**
Vercel preview URLs as needed
localhost:8080 for local testing when needed
```

## Current Product Direction

Streex is moving from an earnings tracker toward a professional performance intelligence system and driver companion.

Current emphasis:

- operational clarity
- mobile-first speed
- driver identity
- calm utility
- honest metrics
- trustworthy personal analytics
- no-shame progress language

## Current Core Systems

### Dashboard + Full Focus

Dashboard has two experiences:

- Standard Dashboard: fuller dashboard, progression, identity, records, and utility context.
- Full Focus: operational dashboard, built for live work sessions and quick understanding.

Full Focus currently includes:

- Today total
- Day vs average
- Historical rank
- shared Utility Slot for Conditions and Octopus reward progress
- weekly earnings and hours progress
- Quick Add
- End Day
- current-week operations snapshot
- metric drill-down sheets for explanation

Recent Full Focus utility behavior:

- Conditions keeps weather and traffic together as one visual module.
- Traffic refreshes more frequently than weather, but both remain one combined card.
- Octopus reward progress can rotate into the same Utility Slot after eligible Uber ride updates.
- Octopus points are correctable utility state and do not alter earnings, rides, records, XP, achievements, or efficiency.
- On mobile, Progress lives in the bottom navigation to preserve header space; on desktop, Progress remains in the top navigation.

### Entry + Quick Add

Entry supports:

- normal app earnings
- Quick Add focused updates for primary apps
- optional miles and rides
- manual ride count
- shift blocks
- start/end shift
- pause/resume shift
- manual shift earnings recovery
- bonus income entry

Quick Add is designed around accumulated totals, not incremental add-only values. The user enters the current total visible in the driver app, and Streex computes changes/snapshots safely.

Quick Update tracking rules:

- Earnings are accumulated totals for the selected app.
- Rides are accumulated totals for the selected app and combine into the shift total.
- Miles are one shared accumulated day total across all apps.
- Across multiple shifts, mileage remains one accumulated day total; Streex assigns only the change to the active shift.
- Historical total-only rides remain unattributed unless the user establishes a new app breakdown.
- Only known Uber ride deltas affect Octopus progress.

### Shift Intelligence

Shift Intelligence includes:

- shift start/end
- active shift state
- pause/resume via work blocks
- total active work time
- miles
- rides
- earnings/hour
- earnings/mile
- earnings/ride when ride count exists
- current-week and lifetime operations snapshots

Important metric rule:

Do not calculate fake efficiency. If duration, rides, miles, or safely attributable earnings are missing, hide the metric or show an honest fallback.

### Earnings Snapshots

Earnings Snapshots V1 records earnings update deltas when the user saves updated app totals.

Use snapshots for:

- observed earnings update timing
- more honest timing analysis when data exists
- reconstructing some shift-level earnings when a same-shift snapshot exists

Do not claim exact ride-level hourly performance unless future ride timestamps or provider integrations exist.

### Bonus Income

Bonus income represents surprise platform payouts or extra one-time payouts.

Bonus rules:

- Counts toward daily, weekly, monthly, lifetime totals.
- Counts toward records, Journey, Career totals, XP, Achievements, and app breakdown.
- Excluded from $/hour, $/shift, shift efficiency, timing metrics, and operational performance.
- Octopus is treated as bonus/reward income automatically by app name.
- Existing Octopus entries remain stored as-is but are interpreted by calculation rules.

Rule of thumb:

```text
Real money story includes bonus.
Operational efficiency excludes bonus.
```

### Daily Report / End Day

End Day has evolved into a richer Daily Report:

- today earned
- app count
- hours
- per-hour when valid
- miles
- rides
- per-ride when valid
- vs average
- week pace
- week total
- week share
- shift intelligence
- narrative insight
- milestone context
- image download/share

Current export behavior:

The exported Daily Report image captures the visible report card instead of a separate export-only template. This keeps the downloaded/shared card aligned with the in-app design.

### Deep Insights

Deep Insights is the desktop-first analytics cockpit. Beta 0.7.0 added an Advanced Comparison workspace without replacing the existing operational Compare page.

Current behavior:

- Dark and premium themes keep the dark Streex control-room treatment.
- Classic Light uses a bright editorial analytics treatment.
- Charts, tooltips, KPI cards, filters, panels, empty states, insight blocks, and tables are theme-aware.
- No Deep Insights calculation, data, auth, Supabase, or backend behavior changed in `Beta 0.6.1`.

Current state:

- dedicated route: `/deep-insights`
- available from the Progress menu
- not part of bottom navigation
- dark control-room layout for power-user analysis
- time, app/platform, and weekday filters
- KPI strip
- earnings trend
- weekly earnings comparison
- weekday earnings chart
- app contribution mix
- hours worked chart where shift data exists
- earnings/hour trend where valid shift duration exists
- earnings/mile trend where mileage exists
- best days
- lowest earning days
- best weeks
- best shifts where shift-level earnings can be resolved
- app performance breakdown
- data-supported insight copy
- `Overview | Compare` workspace switch inside Deep Insights
- two to four day, week, month, year, or custom comparison blocks
- shared app/platform filter, metric table, comparison chart, and narrative signals
- URL-backed comparison state after interaction

Important metric rules:

- Earnings totals follow the normal money story, including bonuses where they already count.
- Operational efficiency uses only data that can be supported by shift time, mileage, snapshots, or manual shift earnings.
- App-specific hourly claims are hidden because Streex does not store app-specific hours.
- Vehicle, market/location, weather-history, and GPS filters are intentionally out of V1 until those dimensions are stored reliably.
- Comparison totals include bonuses, while efficiency continues using operational earnings only.
- App-filtered comparisons hide resource and efficiency metrics that cannot be attributed honestly to one platform.
- The existing `/compare` route remains the unchanged same-point weekly operational guide.

Latest Deep Insights work:

- `Beta 0.8.1`: selected KPI sparklines, weekly distributions, activity marks, contribution context, and ranking/percentile indicators.
- `Beta 0.9.0`: Shift Intelligence with honest coverage, average duration, rides/hour, miles/hour, and duration-pattern efficiency.

### Ask My Data

Ask My Data is an Alpha analytics experiment. Its OpenAI provider migration is implemented locally, but it remains unverified until the production Edge Function has `OPENAI_API_KEY` and passes authenticated QA.

Current state:

- The route, UI, challenge set, intent routing, tests, usage logging, and `ask-my-data` Edge Function source remain in the repository.
- The Edge Function uses a server-only `OPENAI_API_KEY` and OpenAI Chat Completions streaming. Deterministic answers continue without an AI provider call.
- Luna is the default model; Terra is reserved for explicit cross-period comparisons or complex strategic synthesis. This routing is logged with the usage record.
- Defaults to full historical scope when the user does not specify a timeframe.
- Has intent routing and challenge-set documentation.
- Supports deterministic answers for many earnings, weekday, week, shift, rides, and pattern questions when data exists.
- Should not substitute unsupported questions with vaguely similar answers.

Important limitation:

Ask My Data should be treated as Alpha and deployment/QA-blocked until the secret and production verification are complete. Do not represent it as production-ready merely because the UI and Edge Function source exist. Do not overclaim exact hourly, location, trip-type, ride-allocation, zone, or health insights unless the underlying data exists in its supplied context.

### Admin Ops

Admin Ops foundation exists:

- protected admin route
- admin role validation via backend
- user management foundation
- block/unblock
- feedback inbox
- app version/update controls
- re-engagement email foundation

Custom SMTP is configured and owner-tested for confirmation and recovery.
Re-engagement campaigns remain a separately controlled admin capability.

### Themes

Current major visual themes include:

- Classic Light
- Classic Dark
- RPG
- Night
- Signature
- Velocity

Recent visual layers:

- premium dark auth/login/splash
- iOS safe-area theme background handling
- Full Focus drill-down layer
- Daily Report export polish

## Current Versioning Policy

Streex is in public beta versioning.

- Use `0.x.y` during beta.
- Use patch versions for bug fixes and polish.
- Use minor versions for meaningful feature releases.
- Reserve `1.0.0` for the first stable public release.
- Preserve older `V3.x` through `V5.x` labels as Alpha Archive history.

Before implementing a new prompt, Codex should:

1. classify the request
2. propose a version number when the change is meaningful
3. ask for user approval if versioning is ambiguous

## Roadmap

The living roadmap is stored in:

```text
docs/ROADMAP.md
```

Current planned sequence:

- `Beta 0.8.0`: Full Focus Utility Intelligence - completed
- `Beta 0.8.1`: Deep Insights Micro-Visualization Pass - completed
- `Beta 0.8.2`: Career Drill-Down Expansion - completed
- `Beta 0.8.3`: Weekly Comparison Clarity - completed
- `Beta 0.8.4`: Weekly Comparison Projection - completed
- `Beta 0.8.5`: App-Specific Ride Attribution - completed
- `Beta 0.8.6`: Shift Time Edit Synchronization - completed
- `Beta 0.8.7`: Mileage Accumulation Integrity - completed
- `Beta 0.8.8`: Data Integrity Repair - completed
- `Beta 0.8.9`: Data Health Foundation - completed
- `Beta 0.9.0`: Deep Insights Intelligence Layer - completed
- `Beta 0.9.1`: Reliability & Release Safety - completed
- `Beta 0.9.2`: Personal Data Safety & Recovery - completed
- `Beta 0.9.3`: Live Work Mode - withdrawn and source archived
- `Beta 0.9.4`: Operational Explorer & Driver Playbook - published and owner-verified
- `Beta 0.9.5`: Release Certification & Performance - published
- `Beta 0.9.6`: Earnings Attribution Integrity - published and in real-work stabilization
- `Beta 0.9.7`: Historical Data Import - implemented locally; pending owner QA and publication
- `Beta 0.9.8`: Snapshot Correction Reconciliation - local candidate, pending owner QA
- `Beta 0.9.9`: Operations Snapshot Integrity & Performance - local candidate, pending owner QA
- `Beta 0.9.10`: Route Bundle Performance - local candidate, pending owner QA
- `Beta 0.9.11`: Deep Insights Productivity - local candidate, pending owner QA
- `Beta 0.9.12`: Multi-Shift Ride Accumulation Integrity - local candidate, pending owner QA
- `Beta 0.9.13`: Deep Insights Operations Snapshot Comparison - local candidate, pending owner QA

These numbers are planning labels, not immovable promises. If a bugfix, production patch, or smaller feature ships first, renumber the planned items while preserving the roadmap intent.

## Recent Beta Highlights

- `0.9.0`: Deep Insights added Shift Intelligence with explicit coverage and minimum-sample guardrails for duration-pattern rankings.
- `0.8.9`: Admin Ops gained an internal Data Health panel and reusable data-contract summary layer for week, shift, mileage, ride, and snapshot integrity.
- `0.8.8`: Historical mileage and work-block inconsistencies were repaired with private backups; redundant snapshots were removed and revision-scoped idempotency now prevents recurrence.
- `0.8.7`: Mileage now remains an accumulated day total across shifts, with only each update delta attributed to the active shift.
- `0.8.6`: Shift time edits now synchronize operational work-block boundaries while preserving real pause intervals.
- `0.8.5`: Quick Update separated ride counts by app, preserved shared accumulated mileage, and limited Octopus changes to known Uber ride deltas.
- `0.8.4`: Compare restored upcoming reference days, added a clearly labeled pace projection, and exposed remaining and per-day planning targets without creating future losses.
- `0.8.3`: Compare separated previous-week and record-week progress, added daily and cumulative gaps, and introduced expandable cumulative trend charts without counting future days.
- `0.8.2`: Career added contextual monthly, record, app, weekday, and hourly-efficiency drill-downs while preserving Full Focus unchanged.
- `0.8.1`: Deep Insights added selected KPI sparklines, compact distributions, operational contribution context, and filter-aware ranking visuals.
- `0.8.0`: Full Focus Utility Intelligence added the shared Conditions/Octopus Utility Slot, Octopus point tracking, event-driven utility rotation, and the weekly active-day average metric.
- `0.7.1`: Deep Insights header fix plus a unified, theme-aware Overview and Advanced Comparison exploration system.
- `0.7.0`: Advanced Comparison Builder added configurable multi-period analysis inside Deep Insights while preserving the existing Compare guide.
- `0.6.4`: Full Focus goal hierarchy removed redundant goal card and promoted Conditions into the full-width utility position.
- `0.6.3`: Daily Notes added one short contextual note per day without affecting statistics.
- `0.6.2`: Quick Add decimal input fix restored cents entry on mobile.
- `0.6.1`: Deep Insights Refinement + Light Mode added theme-aware chart, panel, table, tooltip, and filter styling.
- `0.6.0`: Deep Insights Desktop V1 added as a new desktop-first analytics cockpit.
- `0.5.1`: Daily Report export now matches the visible report card; CSS import warning fixed.
- `0.5.0`: Bonus Category added; bonuses count toward earnings story but not operational efficiency.
- `0.4.9`: Historical Rank drill-down added Day and Week views.
- `0.4.8`: iOS header safe-area fix.
- `0.4.7`: Account Security / Change Password in Settings.
- `0.4.6`: Shift Earnings Recovery.
- `0.4.5`: Shift Pause + Work Blocks foundation.
- `0.4.4`: Full Focus drill-down refinement.
- `0.4.3`: Full Focus metric drill-down layer.
- `0.4.2`: iOS/PWA safe-area theme background fix.
- `0.4.1`: Velocity theme.
- `0.4.0`: Signature theme.
- `0.3.4`: Premium auth and splash visual refresh.
- `0.3.0`: Work Hours Intelligence, Ride Count, weekly hours goals, and Daily Report 2.0 foundation.

See `CHANGELOG.md` for full details.

## Known Operational Notes

- Local `.env` files may be stale or machine-specific. Vercel Production variables are the deployment source of truth.
- `supabase/config.toml` should point to the active Supabase project ref for future function deployments.
- Ask My Data and utility Edge Functions depend on Supabase function secrets. Do not assume secrets are present in a new environment.
- OpenWeather and TomTom are backend/Edge Function concerns; do not place provider keys in frontend code.
- Custom SMTP and Turnstile are active; keep confirmation/recovery delivery under routine release monitoring.
- React Router 7.18.2 leaves one npm advisory whose maintainer scope is unstable RSC APIs; Streex is a client-only Vite SPA and does not use RSC/server actions. Retest and remove the documented exception when a compatible patched package exists.
- The web app should continue to stabilize before starting a professional native SwiftUI iOS app.

## Current Follow-Up Backlog

High priority:

- Beta 0.11.0 separates acceptance, pickup, and dropoff for foreground-captured rides. Acceptance records the paid approach context, while only a confirmed pickup can receive zone earnings. Existing rides retain their original pickup semantics; no historical financial or location evidence is rewritten. Apply `20260910064047_ride_pickup_lifecycle_0110.sql` to the active backend and complete real iPhone QA before publication.
- Continue real-work QA for Beta 0.10.0 Movement Capture & Zone Context. Both active-backend migrations are applied; Full Focus is its primary surface, Entry reuses its shared control, and Quick Actions remains the sole hub for shifts and accumulated totals. It is foreground-only, captures privacy-minimized start/end zones, keeps Uber/manual mileage authoritative, and does not persist raw coordinates or routes. See `docs/MOVEMENT_CAPTURE_TECHNICAL_DESIGN.md`.
- Beta 0.10.1 Zone Intelligence & Evidence is implemented on `main` and requires authenticated owner QA with genuine captured evidence. It adds a coverage-first Deep Insights workspace using private coarse cells and pickup-only eligible income; see `docs/ZONE_INTELLIGENCE_TECHNICAL_DESIGN.md`.
- Beta 0.10.2 is implemented on `main` and its active-backend migration `20260906212214_ride_snapshot_allocations_0102.sql` is applied. It consumes a Quick Actions request only once, uses a keyboard-safe mobile sheet, keeps live interval attribution as the compact default, and adds an owner-scoped editable allocation ledger. An observed snapshot and reported total remain immutable; an explicit known ride portion and any residual are stored separately.
- Beta 0.10.3 is implemented on `main` and its active-backend migration `20260906213306_user_zone_labels_0103.sql` is applied. It replaces the conceptual private-cell board with an interactive approximate base map and owner-confirmed broad labels. Map tiles and optional suggestions use only the existing coarse cell, never raw GPS or routes.
- Beta 0.10.4 is the unpublished Weekly Ride Allocation Review candidate. Entry will show every positive observed update for the week, even before it has a ride-level allocation, and permits a deliberate closed-week review without changing financial history.
- Beta 0.10.5 is the unpublished access correction: a closed week intentionally opened in Entry stays there, and History offers a direct route into that week’s ride-earnings review.
- Beta 0.10.7 supersedes retrospective ride creation. Rides are now live foreground evidence only: historical Entry never creates them, and legacy reconstructed rows are excluded from Zone Intelligence. The applied `manual_ride_allocations` ledger remains available only to distribute a reported total across real foreground-captured rides from that day; it never creates a ride.
- Beta 0.10.8 prevents unsafe historical snapshot attribution. Data Health now keeps cross-day and decimal-scale artifacts out of shift suggestions, and offers an owner-confirmed bulk exclusion that preserves every reported total and source snapshot.
- Complete owner QA and publish Beta 0.9.7 only after import safety, totals preservation, no-snapshot behavior, and cross-surface analytics agree.
- Configure two isolated QA identities in the GitHub `qa` environment for bidirectional RLS certification.
- Keep monitoring login/session and SMTP confirmation/recovery delivery.
- Validate Daily Report export on an installed iOS PWA during a future export-affecting release.

Medium priority:

- Configure the isolated OpenAI project secret, deploy Ask My Data, and complete its authenticated challenge-set QA before treating it as available.
- Stabilize the 0.9.6 attribution review workflow with real late-tip observations.
- Run the 0.9.7 preview-first historical CSV/Excel import with a small known sample, then backfill multi-year data in reversible weekly batches.
- Review 0.9.11 saved Operational Explorer views and CSV output alongside historical-import readiness; both preserve evidence labels and source data.
- Research aviation providers for Flight Reservation Tracker and Airport Pulse before building the next Utility Slot module.
- Keep `docs/ASK_MY_DATA_CHALLENGE_SET.md` updated after Ask My Data fixes.

Do not implement these automatically. Treat them as product backlog.

## How Claude / ChatGPT Should Use This

When asked about Streex:

1. Read this file first.
2. Then read `README.md`, `docs/PROJECT_CONTEXT.md`, and `CHANGELOG.md`.
3. Use repo files as the current source of truth.
4. If chat history disagrees with repo docs, ask the user which source is newer.
5. Do not assume Lovable is still production infrastructure unless the user explicitly says so.

## Update This Document When

- a roadmap version ships
- the current release changes
- infrastructure changes
- Supabase project target changes
- a major system is added or removed
- a known limitation is resolved
- product direction materially changes
