# Changelog

## Beta Releases

### Beta 0.11.2 — Read-only MCP OAuth Bridge (Local Candidate)

### Added

- A Supabase OAuth-protected MCP endpoint exposes only the deterministic daily operations summary to an explicitly authorized connector.
- The consent page requires owner sign-in and explicit approval; the bridge performs no writes, model calls, or service-role access.

### Verification Required

- Enable Supabase OAuth Server, publish the `/oauth/consent` route, deploy only `daily-ops-summary` and `mcp` from the isolated branch, and complete authenticated connector QA.

### Ask My Data — OpenAI Provider Migration (Local Candidate)

### Changed

- Ask My Data now uses a server-only `OPENAI_API_KEY` with OpenAI Chat Completions streaming instead of the retired Lovable AI gateway.
- Deterministic answers still avoid a model call. Luna is the normal model path; Terra is reserved for explicit cross-period comparisons and complex strategic synthesis.
- Four-week comparisons now receive a server-calculated latest-vs-best rolling period block from full history, using only completed calendar-consecutive weeks.

### Verification Required

- Configure `OPENAI_API_KEY` only in the active Supabase Edge Function secrets, deploy `ask-my-data`, then run the authenticated Ask My Data challenge set. This source change is not proof that production is configured.

### Beta 0.11.0 — Ride Lifecycle: En route, Pickup & Finish (Local Candidate)

### Added

- Movement now captures three intentional foreground moments: **En route** when a ride is accepted, **Pickup** when the passenger enters, and **Finish ride** at the destination.
- The approach to pickup is retained as operational work context without claiming that the acceptance zone earned the ride's money.

### Data Integrity

- For new rides, only a successfully confirmed pickup zone can receive eligible zone earnings. The dropoff remains destination context; an unconfirmed pickup leaves the ride as coverage only.
- Existing ride records remain untouched and retain their original start zone as pickup context. Reported earnings, Uber/manual miles, snapshots, and allocations are unchanged.

### Beta 0.10.8 — Historical Snapshot Safety (Local Candidate)

### Fixed

- Data Health no longer suggests assigning a cross-day historical snapshot or an impossible decimal-scale artifact to a shift.

### Added

- Historical Snapshot Cleanup can explicitly exclude those events from hourly metrics in one audited action. It never changes reported totals, rides, miles, zones, or original snapshots.

### Beta 0.10.7 — Live Ride Evidence Boundary (Local Candidate)

### Fixed

- Rides can no longer be reconstructed from Entry or History for a prior shift or date. Movement remains evidence captured while the app is open.
- The live Movement card can cancel an active ride or undo its latest completed-but-unlinked ride. This never changes earnings, mileage, ride totals, snapshots, or shift data.

### Data Integrity

- Legacy reconstructed historical ride rows are excluded from Zone Intelligence, preventing them from affecting zone coverage or pickup earnings.
- A confirmed allocation remains valid when it belongs to a real foreground-captured ride. The allocation review no longer creates retrospective rides.

### Beta 0.10.6 — Historical Manual Ride Allocation (Local Candidate)

### Added

- Weekly ride allocation review now supports historical daily app totals that have no Quick Actions snapshot.
- The owner can assign known amounts to recorded rides and leave the balance explicitly unassigned until it is known.

### Data Integrity

- Manual allocations are revisioned separately from snapshots and never rewrite the weekly entry, reported total, or historical hourly record.
- A manual allocation contributes to pickup-zone earnings only when the selected ride already has a foreground-captured pickup zone.

### Beta 0.10.5 — Closed-Week Allocation Access (Local Candidate)

### Fixed

- Opening a closed week from Entry no longer redirects to History before the ride allocation review can load.
- The historical-week editor now provides an explicit **Review ride earnings** action that opens the same week in Entry.

### Beta 0.10.4 — Weekly Ride Allocation Review (Local Candidate)

### Fixed

- Entry no longer hides the allocation review when a positive observed update has not yet been assigned to any ride.
- The same review is available when opening a closed historical week, not only while the current week is active.

### Added

- Every positive observed app update for the selected week can be split across recorded rides, or left explicitly unassigned until the owner knows the correct amount.
- The review explains the boundary clearly: Streex verifies the observed total and that portions add up exactly; the owner confirms the provider amount per ride.

### Data Integrity

- Reviewing allocations never rewrites the original observed snapshot, reported daily total, or historical hourly record. It changes only the current ride-level interpretation.

### Beta 0.10.3 — Zone Map & Confirmed Labels (Local Candidate)

### Added

- Zone Intelligence replaces the private-cell board with an interactive approximate map. Cells remain deliberately coarse and selectable.
- Selecting an unlabeled cell can request one broad place suggestion, which the owner confirms or edits before it is stored as a personal label.

### Privacy

- Map tiles and the optional label suggestion receive only the existing coarse-cell viewport or centre; Streex never sends raw GPS, routes, addresses, or background history.
- The owner-defined label table stores only the private zone key and chosen broad name, not provider payloads or geographic coordinates.

### Beta 0.10.2 — Ride Allocation Integrity & Quick Actions Stability (Local Candidate)

### Fixed

- A dashboard request to update totals is now consumed once, so a later ride or week refresh cannot reopen Quick Actions or replace an in-progress numeric draft.
- Quick Actions keeps the normal `Since last update in this shift` choice compact and defaulted for live work; advanced timing choices are available only when intentionally changed.
- The mobile sheet uses the dynamic viewport and safe-area padding so the numeric form remains reachable above the iOS keyboard.

### Added

- A confirmed single ride can receive a known portion of a new accumulated-total delta. Any remainder is kept separately as an interval or unassigned amount instead of being falsely assigned to that ride.
- Entry includes a Ride allocation ledger where an owner can split, move, or review current allocation portions without rewriting the observed snapshot.

### Data Integrity

- The allocation ledger is owner-scoped and revision-based. It preserves the immutable daily snapshot and reported total while replacing only the current interpretive allocation set.
- Zone earnings use confirmed ledger amounts when present; they never substitute a whole snapshot for a partial ride amount.

### Beta 0.10.1 — Zone Intelligence & Evidence (Local Candidate)

### Added

- Deep Insights now includes a Zone Intelligence workspace with private approximate zone cells, coverage evidence, pickup-zone earnings, and aggregated destination context.
- Zone results reuse the selected period, app, and weekday filters and keep the selected mode and cell in the URL.
- Explicit late tips can add to the original captured pickup zone's lifetime evidence while remaining financial income on their observed day.

### Data Integrity

- Only a single linked ride with a captured pickup zone and positive reconciled snapshot delta can contribute base pickup earnings.
- Batch links, missing pickup captures, unlinked rides, and historical manual rides remain visible as coverage or exclusions; their money is never allocated across zones.
- No raw coordinates, addresses, routes, map tiles, navigation, or background tracking are introduced.

### Beta 0.10.0 — Movement Capture & Post-Shift Correction (Local Candidate)

### Added

- Movement now reports whether its start/end zone was saved, unavailable, or denied; completing a ride is no longer presented as proof that GPS succeeded.
- Entry can explicitly correct a finished shift's accumulated app total, app rides, and mileage, with a preview of the change and an explanation required for reductions.
- A known ride can be entered after a shift with its amount, provider miles, and exact worked time. It remains manual context and never claims a retroactive GPS zone.
- A late tip can be recorded on the day it is observed and associated with its original recorded ride once the supporting migration is applied.
- Batch ride links no longer offer a single exact-time attribution, preventing an invalid timestamp from blocking a multi-ride update.

### Data Integrity

- The pickup zone is the canonical zone for future ride-income analysis. A dropoff remains destination context and never receives a duplicate income allocation.
- Earnings snapshots remain append-only. Late tips do not rewrite the original ride day.
- The owner-scoped payment-link migration is applied to the active backend.

### Beta 0.9.13 — Deep Insights Operations Snapshot Comparison (Local Candidate)

### Added

- Deep Insights → Compare now has an Operations Snapshot lens that presents the same duration, efficiency, mileage, rides, shift structure, and active-day metrics used by the Dashboard snapshot.
- Drivers can compare two to four selected day, week, month, year, or custom periods without replacing the existing Performance lens.
- The new Operations Leaderboard ranks completed historical days, weeks, or months by a chosen operational measure such as earnings per hour, earnings per mile, earnings per ride, miles per hour, active-day output, or reported earnings.

### Data Integrity

- Snapshot comparisons use the Dashboard's work-block semantics: earnings from a day without recorded work time do not inflate operational `$ / hour`.
- Building periods remain visible in direct comparisons, but are excluded from full-period leaderboard ranks.
- Operations comparisons are intentionally all-app only because Streex cannot reliably assign shared hours, mileage, rides, or efficiency to an individual platform.

### Beta 0.9.12 — Multi-Shift Ride Accumulation Integrity (Local Candidate)

### Fixed

- Quick Actions now treats rides like earnings and mileage: enter the accumulated app total for today, and only the difference is assigned to the active shift.
- Starting a second shift no longer turns a daily Uber total such as `10 → 11` into `10 + 11 = 21` rides.
- Downward corrections reduce the most recent known app rides first without creating negative values.

### Data Integrity

- Existing rides with no app assignment are not guessed or rewritten. Quick Actions asks the driver to leave rides blank for that save rather than duplicate an uncertain app total.
- No historical week, ride, mileage, earnings, snapshot, attribution, or Supabase row is automatically rewritten.

### Beta 0.9.11 — Deep Insights Productivity (Local Candidate)

### Added

- Operational Explorer can save and reapply recurring period, app, weekday, and operating-window views in the current browser for the signed-in account.
- Operational Explorer can export its filtered summary, hourly profile, weekday profile, filters, and evidence coverage to CSV.

### Data Integrity

- Saved views are local browser convenience only: they never alter financial data, weeks, snapshots, attributions, or Supabase.
- CSV exports retain the evidence source and timestamp-observed coverage so estimates remain distinguishable from confirmed observations.

### Beta 0.9.10 — Route Bundle Performance (Local Candidate)

### Performance

- Route-only Radix primitives and Lucide icons are no longer forced into the common authenticated bundle; a workspace downloads the UI code it actually uses.
- Compare now uses a lightweight SVG cumulative preview and loads the detailed Recharts view only after its “Cumulative trend” sheet opens.
- Cumulative trend remains available at the start of a week when historical comparison data exists, with clear copy until the first current-week entry creates a pace projection.
- Excel import and image export remain on-demand actions; neither dependency is part of normal Dashboard or Quick Actions loading.

### Preserved Behavior

- Comparison values, projections, detailed interactive charts, History import, and JPG export retain their existing behavior.
- No earnings, snapshots, weeks, authentication, backend, or stored data changed.

### Beta 0.9.9 — Operations Snapshot Integrity & Performance (Local Candidate)

### Fixed

- The Operations Snapshot weekly `$ / hour`, `$ / mile`, and `$ / ride` headline now uses the authoritative final operational total and actual worked duration, matching the rest of the app after a corrected accumulated Quick Update.
- Exact-time earnings attribution now uses the reconciled net amount rather than an unreconciled raw snapshot delta.

### Performance

- Snapshot reconciliation and hourly attribution now run once per intelligence calculation instead of being rebuilt for each snapshot and then built a second time for the hourly map.
- This removes unnecessary growing-history work from Quick Actions saves and route changes without altering earnings, shifts, or the append-only snapshot ledger.

### Beta 0.9.8 — Snapshot Correction Reconciliation (Local Candidate)

### Fixed

- A temporary lower accumulated app total followed by a correction can no longer inflate shift earnings, `$ / hour`, or hourly analytics.
- Snapshot consumers now reconcile the net change within an app/day before treating any observation as new operational earnings.

### Data Integrity

- Original append-only snapshots, daily app totals, week JSON, and historical source data remain unchanged for audit.
- Completed one-shift days reconcile their derived earnings against the authoritative final operational day total.
- Data Health shows recovered corrections as an informational count and flags only corrections that remain unrecovered for timing review.

### Beta 0.9.7 — Historical Data Import (Local Candidate)

### Added

- History now offers a structured Excel template and a preview-first import flow for older earnings, daily hours, miles, rides, shifts, pauses, and bonuses.
- The importer accepts the normalized Daily Earnings workbook plus CSV input, validates dates/numbers/turning points, and summarizes new and changed weeks before saving.
- Historical day-level `worked_hours` and `daily_rides` are preserved when exact shift timing is unavailable; real shift boundaries and pauses remain available for precise operational metrics.

### Data Integrity

- Existing non-empty values are preserved by default; conflicts stop confirmation instead of silently overwriting History.
- Source-total gaps are kept explicitly as `Unattributed` with a warning; unsupported values are never invented.
- Historical imports suppress earnings-snapshot creation so old records do not appear to have been observed at import time.

Status: local implementation pending owner QA, commit, and publication. Public version remains Beta 0.9.6.

### Beta 0.9.6 — Earnings Attribution Integrity

### Added

- Added an owner-scoped earnings-attribution layer that separates when an accumulated-total change was observed from when it was operationally earned.
- Quick Update now supports automatic worked-interval attribution, selected-shift distribution, exact ride time, and safe review-later handling.
- Data Health includes a retroactive Earnings Attribution queue with suggested single-shift repair, detailed date/time assignment, and intentional hourly exclusion.
- Quick Add is now Quick Actions: its first screen combines the current shift state, reliable Start/Pause/Resume/End controls, and the two primary earnings updates.
- The header replaces separate undersized Pause and End buttons with one compact Working/Paused/Start control that opens Quick Actions.

### Data Integrity

- Post-shift tips, different-day adjustments, and historical edits no longer become fictional work hours merely because of their save timestamp.
- Unassigned earnings remain in reported totals but stay outside hourly rankings until resolved.
- Shift Intelligence, Deep Insights, Operational Explorer, and Driver Playbook consume the same canonical attribution rules.
- Original earnings snapshots, accumulated app totals, stored week JSON, and all-time money are never rewritten or duplicated.
- Shift actions and earnings saves use single-flight guards, immediate progress labels, disabled repeat actions, and explicit success feedback so rapid taps cannot create duplicate writes.
- Active-shift interval attribution now reaches Operations Snapshot immediately after Quick Update instead of waiting for End Shift; open work blocks are capped at the saved update time and pauses remain excluded.
- Same-weekday performance now separates total output from weighted hourly efficiency, so a short high-rate day is recognized without changing its lower earnings total.
- Exact-time attribution must fall inside a worked block of the selected completed shift and can no longer land during a pause.
- Live Operations Snapshot refreshes active duration each minute, identifies the latest earnings update, and calculates average shift length from completed shifts only.

### Backend / Migration

- Added `20260802181319_earnings_attribution_integrity_096.sql` with explicit Data API grants, owner-only RLS, snapshot ownership checks, and indexes for pending review and attributed day/shift lookups.
- Added `20260802181403_harden_earnings_attribution_privileges_096.sql` to remove anonymous access and authenticated delete/truncate privileges explicitly.

### Beta 0.9.5 — Release Certification & Performance

### Changed

- Authenticated application pages now load by route instead of shipping every workspace in the initial JavaScript payload.
- The image-export engine now loads only when an export, copy, or share action is requested.
- Public metadata now uses the STREEX domain, description, and icon instead of inherited Lovable preview assets and attribution.

### Quality

- The automatic GitHub quality gate now includes a read-only browser smoke of the public authentication and recovery boundary.
- Manual release certification now covers protected routes on desktop and mobile plus a read-only, two-identity RLS isolation check.
- Compatible production security updates were applied, including React Router 7.18.2, Vite 5.4.21, and PostCSS 8.5.25; the remaining React Router audit advisory applies only to unstable RSC APIs that this client-only SPA does not use.
- Project status, roadmap, QA runbook, and new-chat handoff now identify Beta 0.9.4 as published and verified through more than one week of real owner use.
- No earnings, shifts, rides, mileage, snapshots, stored weeks, migrations, or production records changed.

### Beta 0.9.4 — Operational Explorer & Driver Playbook

### Added

- Deep Insights now supports custom date ranges, multi-select weekdays, operational time windows, weighted efficiency metrics, hourly profiles, and best-window rankings.
- Metrics explicitly identify observed, estimated, mixed, or insufficient evidence. Rewards remain excluded from operational efficiency.
- Successful Quick Updates capture private append-only cumulative observations for app earnings, app rides, and shared day mileage; historical rows are not rewritten.
- Driver Playbook exports three anonymous 9:16 JPG cards with operating profile, best times, and actionable data-backed signals.

### Changed

- Live Work Mode was withdrawn from public routing and navigation after beta evaluation. Its unreferenced source file remains archived for possible future research.

### Backend / Migration

- Added `20260717173026_operational_snapshots_094.sql` and its append-only hardening migration `20260717175710_operational_snapshots_append_only_094.sql`, with owner-only RLS, idempotent event keys, and indexes for user/day/shift analysis.

### Beta 0.9.3 — Live Work Mode Beta

Status: withdrawn after owner testing; source archived and excluded from the published bundle.

### Added

- Added a separate `/live-work` workspace from the account menu, explicitly labeled Beta.
- Added real ready, working, paused, and ended shift states using the existing shift persistence model.
- Grouped Start, Pause/Resume, End Shift, Quick Update, today's operational totals, and sync status into one focused surface.

### Data Integrity

- Earnings remain accumulated totals by app, rides remain app-specific, and mileage remains the shared accumulated total for the day.
- Quick Update continues using the canonical mileage, ride-attribution, snapshot, conflict-save, and Octopus reward paths.
- Dashboard, Entry, Full Focus, Compare, History, Career, Deep Insights, Ask My Data, and the existing navigation were not replaced or removed.

### Beta 0.9.2 — Personal Data Safety & Recovery

### Added

- Every successful week save now captures the prior week as a private restore point before writing the next version.
- Saves compare the version originally loaded with the current remote version; a stale device cannot silently overwrite a newer week.
- History now exposes restore points and restores them safely while preserving the current version first.
- The app shows saving, saved, conflict, and retry states so interrupted work is visible instead of silent.

### Data Integrity

- Restore points use user-owned RLS policies and security-invoker functions; no service-role key is exposed to the browser.
- Existing weeks, earnings, mileage, rides, shifts, snapshots, and historical metrics were not rewritten.

### Backend / Migration

- Added and applied `20260711013903_add_week_revisions_and_conflict_save.sql` to the active owner-controlled Supabase project.
- The migration is additive: it adds private `week_revisions` and owner-scoped save, restore, and listing RPCs without replaying historical migrations or rewriting data.

### Beta 0.9.1 — Reliability & Release Safety

### Changed

- Added repeatable `typecheck`, `validate`, and Playwright E2E commands for local release verification.
- GitHub Actions now runs typecheck, lint, unit tests, and a production build for every push or pull request targeting `main`.
- Added a separately triggered, credentials-protected QA route smoke for the isolated QA account.
- Updated the authenticated E2E assertion to match the current production sign-in surface.
- Patched audited production dependencies; the production dependency audit now reports zero known vulnerabilities.

### Quality

- TypeScript and ESLint now pass cleanly across the repository.
- No earnings, shifts, mileage, rides, snapshots, Supabase schema, or production records changed.

### Beta 0.9.0 — Deep Insights Intelligence Layer

### Added

- Deep Insights now includes Shift Intelligence with average duration, rides/hour, miles/hour, and explicit shift-earnings coverage.
- Resolved shifts are grouped into short, standard, and long duration patterns for deterministic efficiency comparison.
- Streex requires at least two resolved shifts in a duration group before naming a strongest pattern.

### Data Integrity

- Unresolved shift earnings remain outside earnings rankings and duration-pattern efficiency.
- Rides/hour and miles/hour use only completed shifts that actually contain the corresponding data.
- This analytics-only release does not alter stored earnings, shifts, rides, mileage, Supabase schema, or production records.

### Beta 0.8.9 — Data Health Foundation

### Added

- Admin Ops now includes an internal Data Health panel for currently loaded week and snapshot data.
- Data Health summarizes canonical contracts for week shape, earnings, mileage, rides, shift boundaries, and earnings snapshots.
- A reusable Data Health summary layer and tests were added for future QA certification and Deep Insights safety work.

### Data Integrity

- Week hydration and save paths now emit privacy-safe semantic warnings when stored data contradicts canonical rules.
- This release does not alter earnings, mileage, rides, shifts, auth, Supabase schema, or stored production records.

### Beta 0.8.8 — Data Integrity Repair

### Fixed

- Repaired historical shift-mile components whose sum exceeded the authoritative accumulated day mileage, without changing any daily mileage total.
- Synchronized historical work blocks with their edited shift boundaries while preserving valid pause intervals.
- Removed redundant earnings snapshot transitions that could overstate timing observation counts.
- Snapshot writes now carry a revision-scoped idempotency key, preventing concurrent or retried saves from creating duplicate observations while allowing legitimate later corrections.

### Data Integrity

- Every repaired week and deleted snapshot was backed up in a private, non-API database schema before modification.
- Post-repair verification found zero remaining mileage, work-block, or duplicate-snapshot anomalies.
- Canonical earnings, accumulated daily mileage, rides, bonuses, goals, and user settings were not changed.

### Beta 0.8.7 — Mileage Accumulation Integrity

### Fixed

- Quick Update now consistently treats mileage as the accumulated day total across multiple shifts and app updates.
- The active shift receives only the difference since the previous accumulated total instead of another copy of the full day mileage.
- Day and week mileage now use the explicit daily total as the authoritative value.
- Previously affected patterns such as `50 → 115.9` are interpreted as `50 + 65.9` for shift-level analytics.

### Data Integrity

- Downward corrections adjust recent shift mileage without creating negative values.
- Earnings, rides, hours, Supabase schema, auth, and backend behavior remain unchanged.
- Existing weekly JSON remains compatible; no SQL migration is required.

### Beta 0.8.6 — Shift Time Edit Synchronization

### Fixed

- Editing a shift start or end time now synchronizes the work-block boundaries used to calculate active hours.
- Existing shifts whose internal block ends after a corrected shift end now recalculate automatically from the edited boundary.
- Corrected duration flows through earnings/hour, rides/hour, miles/hour, Daily Report, Career, and Deep Insights.

### Data Integrity

- Internal pause and resume blocks remain intact.
- Ending a shift while paused does not convert the paused interval into active work.
- No earnings, rides, mileage, Supabase schema, auth, or backend behavior changed.

### Beta 0.8.5 — App-Specific Ride Attribution

### Fixed

- Quick Update now treats rides as the selected app's accumulated count instead of overwriting the shared shift total.
- Uber, Lyft, and other attributed app counts combine automatically into the total rides used by shift and career analytics.
- Octopus progress now receives only known Uber ride deltas; Lyft and unattributed historical rides never receive Uber credit.

### Data Integrity

- Mileage remains one shared accumulated day input; multi-shift delta allocation is completed in Beta 0.8.7.
- Historical total-only ride counts remain preserved without inventing app ownership or retroactive rewards.
- Editing the total ride count manually resets app attribution because a new per-app split cannot be inferred safely.
- Ride attribution remains inside the existing weekly entries JSON; no SQL migration or backend deployment is required.

### Beta 0.8.4 — Weekly Comparison Projection

### Added

- Upcoming days remain visible with their previous-week or record-week reference values while current earnings stay marked as pending.
- Cumulative charts continue the historical reference through Sunday and add a clearly dashed pace projection.
- Expanded charts mark the current comparison point and show the amount remaining plus the daily average needed to match the reference.

### Data Integrity

- Daily and cumulative differences are calculated only for tracked days; upcoming days are never treated as zero or presented as losses.
- Projection is explicitly estimated from the current tracked-day average and does not alter stored data or actual performance metrics.

### Beta 0.8.3 — Weekly Comparison Clarity

### Changed

- Compare now separates previous-week and record-week analysis into focused mobile-friendly sections.
- Each tracked day shows both its daily difference and running cumulative gap without treating future days as zero.
- Each comparison includes a compact cumulative trend that opens into a detailed interactive chart.
- The app comparison table and horizontal scrolling were removed while the four summary indicators remain unchanged.

### Scope

- No earnings, bonus, record, Supabase, auth, Dashboard, Full Focus, Entry, or backend calculation changed.

### Beta 0.8.2 — Career Drill-Down Expansion

### Added

- Career Monthly Progression now opens a shared Progress/History detail with same-point comparison, provisional rank, top months, and record chase context.
- Best Day and Best Week now open a shared records detail with top-five historical results and record margins.
- Top Earning App and Best Weekday now expose compact, data-supported breakdowns.
- Career Earnings/Hour now explains measured hours, represented operational earnings, completed shifts, and exclusions.

### Changed

- `Most Used App` is now correctly labeled `Top Earning App` because the metric ranks attributed earnings, not app usage.
- The shared metric sheet supports a requested initial tab and internal scrolling on short mobile viewports.

### Scope

- Full Focus cards, details, calculations, layout, and behavior remain unchanged.
- No Supabase schema, backend, earnings, shift, bonus, XP, achievement, or navigation behavior changed.

### Beta 0.8.1 — Deep Insights Micro-Visualization Pass

### Changed

- Selected Deep Insights KPI cards now include compact sparklines, weekly distribution bars, recent activity marks, and an operational contribution rail.
- App contribution and performance rows now carry restrained in-cell visual context while preserving exact values and labels.
- Top-day and top-week rankings now include percentile context within the current filtered view.

### Data Integrity

- Every micro-visualization reuses the already filtered Deep Insights datasets and disappears when the required data is unavailable.
- No earnings, bonus, shift, ride, mileage, ranking, auth, Supabase, Full Focus, or backend calculation changed.

### Beta 0.8.0 — Full Focus Utility Intelligence

### Added

- Full Focus now has one shared Utility Slot for combined Conditions and Octopus reward progress.
- Octopus can track a correctable point balance, add or remove eligible Uber rides in batches, and show progress toward each 250-point / $25 reward.
- This Week Operations now includes average earnings per active day compared with the historical active-day baseline.

### Changed

- Weather and traffic remain one visual experience, while traffic refreshes every five minutes and weather every 30 minutes.
- Utility content rotates only after meaningful refresh or Quick Update events, with protected visibility time and manual selection.
- Uber Quick Update ride deltas affect Octopus at 1.5 points per eligible ride; Lyft never credits the reward balance.

### Data Integrity

- Octopus progress is stored as user utility state and does not change earnings, total rides, records, XP, achievements, or efficiency calculations.
- Users can synchronize the exact external point balance whenever Octopus missed a ride or the local estimate drifted.
- Production requires the new additive user-settings migration and redeployment of the `driver-utility` Edge Function.

### Beta 0.7.1 — Deep Insights Visual Refinement

### Fixed

- The global app header now stays visibly above Deep Insights fixed background layers instead of leaving its controls hidden beneath the analytics backdrop.

### Changed

- Overview and Compare now share one `Explore your data` control surface with mode-specific filters and actions.
- Comparison blocks remain side by side on desktop and preserve a safe stacked layout on mobile.
- Each block now shows clear start/end context and carries a consistent accent through the chart and metric matrix.
- Generated labels follow edited periods, while optional custom names remain available.
- Classic Light and dark premium themes now share the same comparison hierarchy, contrast, and spacing.
- The tested comparison engine and existing `/compare` operational guide remain unchanged.

### Production Behavior

- No comparison calculations, Supabase schema, auth, Dashboard, Full Focus, Entry, or backend behavior changed.

### Beta 0.7.0 — Advanced Comparison Builder

### Added

- Deep Insights now includes a separate Compare workspace for comparing two to four days, weeks, months, years, or custom periods.
- Comparison blocks drive shared summary cards, a metric table, a selectable bar chart, and concise data-supported signals.
- Comparison state is URL-backed after interaction so configured views survive refreshes and can be revisited.

### Data Integrity

- Earnings totals include bonuses according to the existing money-story rules.
- Earnings/hour, earnings/mile, and earnings/ride use operational earnings only and appear only when their required data exists.
- App-only comparisons hide hours, miles, rides, and efficiency because those resources cannot be attributed reliably to one platform.
- Weekly goal progress appears only for a tracked `Week` selection, including the current week to date.

### Production Behavior

- The existing `/compare` page remains unchanged as the operational same-point weekly guide.
- No Supabase schema, auth, Dashboard, Full Focus, Entry, existing Compare, or backend behavior changed.

### Beta 0.6.4 — Full Focus Goal Hierarchy

### Changed

- Full Focus no longer repeats mixed money and hours information inside a separate Goal mini-card.
- Weekly earnings and hours progress bars now open the existing combined Goal Progress drill-down.
- Day vs Avg and Historical Rank share the first metric row, while Conditions receives a clearer full-width utility position.

### Roadmap

- Focus Utility Slot, Flight Reservation Tracker, and Airport Pulse research are preserved without adding empty dashboard placeholders.

### Production Behavior

- Goal calculations, weather, traffic, Standard Dashboard, Supabase, auth, and backend behavior were not changed.

### Beta 0.6.3 — Daily Notes

### Added

- Each tracked day can now hold one short optional context note from mobile day detail or desktop Entry.
- Days with notes show a compact note indicator.
- Daily Report includes the note when it exists, including in the report image export.

### Data Integrity

- Notes are contextual metadata only and do not affect earnings, rankings, records, averages, goals, XP, achievements, or performance calculations.
- Notes reuse the existing day JSON structure; no Supabase migration or backend architecture change was required.

### Beta 0.6.2 — Quick Add Decimal Input Fix

### Fixed

- Quick Add earnings now accepts decimal cents without removing the decimal point while the user is typing.
- Locale decimal commas are normalized safely for mobile keyboards.

### Production Behavior

- Accumulated-total behavior, snapshots, earnings calculations, Entry, Supabase, auth, and backend behavior were not changed.

### Beta 0.6.1 — Deep Insights Refinement + Light Mode

### Changed

- Deep Insights now adapts to Classic Light with a bright editorial analytics treatment instead of forcing the dark cockpit view.
- The existing dark Deep Insights cockpit remains intact for dark, Signature, RPG, Night, and Velocity themes.
- Charts, tooltips, panels, KPI cards, filters, empty states, tables, and insight blocks now share one theme-aware visual layer.

### Production Behavior

- No analytics calculations, Supabase schema, auth, Dashboard, Full Focus, Career, Entry, Ask My Data, exports, XP, achievements, or backend behavior changed.

### Beta 0.6.0 — Deep Insights Desktop V1

### Added

- New `/deep-insights` section added as a desktop-first analytics cockpit without replacing Dashboard or Full Focus.
- Progress menu now includes Deep Insights alongside Journey, History, Compare, Achievements, Letters, and Monthly Recap.
- Deep Insights includes global time, app/platform, and weekday filters that update KPIs, charts, tables, and supported insight copy together.
- Initial V1 modules include KPI cards, earnings trends, weekly comparison, weekday earnings, app contribution, hours worked, earnings/hour, earnings/mile, best days, low days, best weeks, best shifts, and app performance breakdown.

### Data Integrity

- Charts and rankings reuse existing earnings, bonus, shift, mileage, ride, and snapshot data.
- Operational efficiency only appears when valid shift duration or mileage exists.
- App-specific hourly claims stay hidden because Streex does not store app-specific hours yet.
- Unsupported filters such as vehicle, market, GPS, and historical weather context are intentionally left out of V1.

### Production Behavior

- No Supabase schema, auth, Dashboard, Full Focus, Career, Entry, Ask My Data, exports, XP, achievements, or backend behavior changed.

### Beta 0.5.4 — Full Focus Cleanup + Quick Update Input Polish

### Fixed

- Quick Update money, miles, and rides fields now avoid the iOS zero-value input underline glitch while keeping the cursor-at-end behavior.

### Changed

- Full Focus no longer repeats the compact Utility block because weather and traffic now live in the Conditions card and drill-down.
- Full Focus weekly operations no longer shows the redundant active-shift explanation under the snapshot.

### Production Behavior

- Standard Dashboard utility, earnings calculations, shifts, snapshots, Supabase, auth, routing, and backend behavior were not changed.

### Beta 0.5.3 — Mobile Numeric Input Cursor Fix

### Fixed

- Numeric money, miles, rides, shift earnings, bonus, and goal fields now place the cursor at the end when focused for faster mobile edits.
- Text, auth, search, and normal typing fields are unaffected.

### Production Behavior

- No calculation, Supabase, auth, routing, dashboard, export, XP, achievement, or backend behavior changed.

### Beta 0.5.2 — Visual Consistency Polish

### Changed

- Stat cards received subtle visual polish for clearer hierarchy and cleaner metric readability.
- Monospace numeric values now use tabular numerics for better alignment across earnings, hours, miles, and percentage displays.
- Card hover polish is opt-in and theme-aware.

### Production Behavior

- No auth, Supabase, routing, earnings, shift, bonus, snapshot, Ask My Data, export, XP, achievement, admin, or backend behavior changed.

### Beta 0.5.1 — Daily Report Export Match

### Fixed

- Daily Report download and share now capture the same visible report card instead of a separate export-only template.
- Exported report images preserve the in-app report colors, typography, spacing, KPI cards, insight blocks, and theme treatment more closely.
- The CSS font import order was corrected to remove the Vite CSS import warning.

### Production Behavior

- Close Day, Keep Going, Share Report, dashboard data, auth, Supabase, Ask My Data, and backend architecture were not changed.

### Beta 0.5.0 — Bonus Category

### Added

- Streex now supports tracking surprise bonuses separately from regular ride and delivery earnings.
- Entry now keeps Bonus quiet and separate from the normal earnings flow.

### Changed

- Bonuses count toward daily, weekly, monthly, lifetime, records, app totals, XP, achievements, and the overall money story.
- Bonuses are excluded from `$/hr`, `$/shift`, shift efficiency, and operational timing metrics so hourly stats stay honest.
- Existing Octopus earnings are treated as bonus income without changing historical day totals.

### Beta 0.4.9 — Historical Rank Drill-Down Expansion

### Added

- Full Focus Historical Rank drill-down now includes `Day` and `Week` views inside the same lightweight detail sheet.
- Day view preserves same-weekday ranking context with nearby positions.
- Week view shows the current week rank among tracked weeks, best week context, and nearby weekly positions.

### Production Behavior

- The main Full Focus dashboard cards, ranking calculations, Supabase data, auth, exports, Ask My Data, and backend architecture were not changed.

### Beta 0.4.8 — iOS Header Safe-Area Fix

### Fixed

- The authenticated app shell now reserves the iOS top safe area so the global header no longer sits under the Dynamic Island or status bar.
- The safe-area background continues to use the active Streex theme background instead of a hardcoded color.

### Production Behavior

- Dashboard order, calculations, auth behavior, Supabase data, exports, Ask My Data, and backend architecture were not changed.

### Beta 0.4.7 — Account Security Settings

### Added

- Settings now includes an Account Security section for changing password while signed in.
- Password updates use the current Supabase session, so logged-in users do not need a recovery email just to choose a stronger password.
- New password fields support iOS-generated strong passwords through `new-password` autocomplete hints.

### Production Behavior

- Auth routing, login behavior, Supabase schema, dashboard data, exports, Ask My Data, and backend architecture were not changed.

### Beta 0.4.6 — Shift Earnings Recovery

### Added

- Shift blocks now support optional manual earnings so historical multi-shift days can recover accurate per-shift efficiency.
- Entry shift rows can calculate `$/hr` from manual shift earnings or from same-shift earnings snapshots when available.
- Mobile and desktop shift editors now expose an optional Earnings field alongside miles and rides.

### Changed

- Multi-shift days no longer have to show `—/hr` when Streex can safely assign earnings to a specific shift.
- Single-shift day fallback remains unchanged and still uses operational day earnings for efficiency.

### Production Behavior

- Daily app totals remain the official earnings source. Shift earnings are used for shift-level efficiency only.
- No Supabase schema migration was added. Optional shift earnings are stored inside the existing week shift data model.
- Auth, routing, Ask My Data, exports, XP, achievements, and backend architecture were not changed.

### Beta 0.4.5 — Shift Pause + Work Blocks Foundation

### Added

- Shifts can now be paused and resumed without creating a separate shift for the same workday.
- New shifts store internal work blocks, so breaks are represented as time between blocks instead of paid work time.
- Global header, Quick Add, Entry, and mobile day detail now expose Pause / Resume while preserving End Shift.

### Changed

- Shift hours and estimated timing analytics now sum active work blocks and exclude pause time when block data exists.
- Existing historical shifts without work blocks continue to behave as single-block shifts.

### Production Behavior

- No Supabase schema migration was added. Work blocks are stored inside the existing shift data model used by weeks.
- Auth, earnings values, Ask My Data, exports, XP, achievements, routes, and backend architecture were not changed.

### Beta 0.4.4 — Drill-Down Context Refinement

### Changed

- Full Focus `Goal` drill-down now explains both weekly earnings progress and weekly hours progress together.
- Historical Rank drill-down now shows nearby same-weekday positions around the current rank, including the three closest better and lower positions when available.
- Rank context now shows how much separates today from nearby same-weekday entries without changing the underlying ranking calculation.

### Production Behavior

- No dashboard calculations, Standard Dashboard behavior, Supabase data, auth, routing, Ask My Data, or backend architecture changed.

### Beta 0.4.3 — Full Focus Metric Drill-Down Layer

### Added

- Full Focus mini-cards now open a lightweight bottom-sheet explanation layer when tapped.
- `Day vs Avg`, `Goal`, `Rank`, and `Conditions` now explain what they mean, what they compare against, and why they matter.
- The drill-down layer is reusable so future Full Focus metrics can opt in without redesigning the dashboard.

### Production Behavior

- No Standard Dashboard behavior, earnings calculations, Ask My Data logic, auth, routing, Supabase data, or backend architecture changed.

### Beta 0.4.2 — iOS Safe-Area Theme Background Fix

### Fixed

- iOS Safari and installed PWA safe-area backgrounds now inherit the active Streex theme background instead of exposing a white strip.
- The document root, body, and app root now share a theme-aware app background token.
- Live `theme-color` metadata now updates from the active theme background when users switch themes.

### Changed

- PWA viewport metadata now uses `viewport-fit=cover` so Streex can render behind iOS safe areas.
- Manifest launch colors now use the dark Streex brand background as a safer default before the live theme takes over.

### Production Behavior

- No auth logic, Supabase behavior, routing, dashboard calculations, earnings data, or backend architecture changed.

### Beta 0.4.1 — Velocity: Motorsport-Inspired Performance Theme

### Added

- New `Velocity` theme in Settings → Theme: yellow-first, high-contrast performance experience inspired by Formula 1 and Porsche Motorsport.
- Black + yellow performance cards with leading-edge accent rails and a subtle racing pinstripe ambience.
- Bold telemetry-style metrics, race-control primary buttons, and amplified streak/momentum highlights.
- Achievements and records glow brighter under Velocity for a stronger celebration layer.

### Accessibility

- Reduced-motion users receive a fully static Velocity treatment without streak or hover animations.

### Production Behavior

- Visual layer only. Auth, earnings entry, shifts, achievements, XP, exports, Ask My Data, admin, and backend behavior are unchanged.

### Beta 0.4.0 — Signature: Flagship STREEX Theme

### Added

- New `Signature` theme: the official flagship STREEX visual identity, available in Settings → Theme.
- Premium dark surfaces with layered depth, glass-like cards, refined hairline borders, and a subtle yellow accent system.
- Cinematic header and bottom navigation with quiet brand glow and mission-control polish.
- Gentle breathing horizon glow that visually aligns with the animated splash and login streak language.

### Accessibility

- Reduced-motion users receive the Signature look without the breathing horizon or pulse animations.

### Production Behavior

- Visual layer only. Auth, earnings entry, shifts, achievements, XP, exports, Ask My Data, admin, and backend architecture are unchanged.

### Beta 0.3.4 — Premium Auth + Splash Visual Refresh

### Changed

- Splash loading screens now use a premium dark Streex treatment with the official logo, yellow motion streaks, and subtle brand glow.
- Login, sign up, and password reset screens now share the same dark cinematic Streex visual language.
- Auth inputs, buttons, links, and changelog copy were restyled for the new dark brand surface.

### Accessibility

- Reduced-motion users receive a static premium splash and auth background without moving streak animations.

### Production Behavior

- No auth logic, Supabase session behavior, routing, protected routes, dashboard logic, earnings data, or backend architecture changed.

### Beta 0.3.3 — Daily Report Export Polish

### Fixed

- End Day `Within Reach` no longer says `First` for a daily milestone that may already be completed.
- Daily Report image export no longer uses the thin simplified layout that lost the visible report formatting.

### Changed

- Report image export now follows the visible close-day report structure more closely, including summary, operational metrics, shift intelligence, narrative insights, and within-reach context when available.

### Production Behavior

- No earnings calculations, shift persistence, snapshots, Ask My Data, auth, or Supabase architecture behavior changed.

### Beta 0.3.2 — Full Focus Rank + Conditions Polish

### Changed

- Replaced the redundant Full Focus `Shift / Active` mini-card with same-weekday historical ranking.
- Replaced the Full Focus `Momentum` mini-card with compact live `Conditions` context from weather and traffic.
- Shared the Dashboard utility controller with Daily Command Center so the mini-card and utility section stay in sync without duplicate provider calls.

### Production Behavior

- Dashboard ordering, Standard Dashboard layout, Quick Add, earnings calculations, snapshots, Ask My Data, auth, and Supabase architecture behavior were not changed.

### Beta 0.3.1 — Quick Earnings Update

### Added

- Added a focused Quick Add flow that opens with large Uber/Lyft update choices instead of immediately showing every app.
- Added optional quick fields for current miles and ride count when updating the active work session.
- Added a `More Apps` path that keeps the full existing entry form available for all apps and manual controls.

### Changed

- Quick updates now treat the entered app amount as the current accumulated total for today, not an amount to add.
- The full `Mark as logged`, shift block list, and `Save Today` controls now stay inside the full entry mode so quick updates remain compact.
- Earnings snapshot writes now guard against duplicate same-transition inserts caused by rapid repeated saves.
- Shift Intelligence timing now deduplicates identical snapshot transitions so existing duplicate rows do not inflate observed timing.

### Production Behavior

- No stored earnings are converted, duplicated, or reinterpreted.
- Existing earning snapshot logic continues to record the real difference between the previous and new app total.
- Ride count remains optional and is only saved when the user enters it for an active shift.
- Existing duplicate snapshot rows are not deleted; they are ignored in timing calculations when they represent the same transition.

### Beta 0.3.0 — Work Hours, Ride Count + Daily Report Intelligence

### Added

- Added Ride Count foundation to shift blocks so rides can be captured alongside start time, end time, and miles.
- Added weekly hours goal support as a separate optional commitment target from the existing weekly earnings goal.
- Added goal-outcome classification for Money Victory, Discipline Victory, Complete Victory, Elite Week, and Building Week.
- Added richer Work Hours Intelligence metrics for hours, rides, earnings per ride, rides per hour, minutes per ride, and related operational efficiency.
- Added Daily Report 2.0 to the End Day flow with daily summary, performance context, weekly impact, shift intelligence, narrative insights, and export/share actions.
- Added a dedicated branded daily report image layout for download/share rather than capturing app controls.

### Changed

- Entry now separates Money and Hours goals and shows rides in the weekly Shift + Mileage summary.
- Shift Intelligence snapshots now include ride-count context when the user has entered rides.
- Dashboard Full Focus shows optional weekly hours goal progress when configured.
- Ask My Data context now includes tracked shift hours, rides, miles, and efficiency summaries for supported hours/rides questions.

### Backend / Migration

- Added a small additive migration for `weekly_hours_goal` on `weeks` and `default_weekly_hours_goal` on `user_settings`.
- Ride Count is stored inside existing shift blocks in `weeks.entries`; no separate shifts table was created.

### Known Limitations

- Ride Count is manual-first and only appears where the user enters it.
- Streex still does not receive individual ride timestamps, so real best earning hour remains unsupported.
- Daily Report XP feed remains hidden until XP events are reliably associated with the closed day.
- Report sharing depends on browser Web Share support; unsupported browsers fall back to download.

### Beta 0.2.3 — Operations Scope Clarity

### Changed

- Career Shift Intelligence now labels its snapshot as Lifetime Operations Snapshot so historical scope is clear.
- Dashboard now surfaces This Week Operations Snapshot for current-week hours, efficiency, miles, work blocks, active shifts, and average shift context.
- Weekly operations reuse the existing Shift Intelligence calculation path with current-week data only.
- Current-week earnings snapshots are filtered to the active week so Dashboard timing context does not mix career history.

### Production Behavior

- No database schema, stored earning amounts, auth, XP, achievements, Ask My Data backend logic, exports, or Supabase project architecture behavior changed.

### Beta 0.2.2 — Reward Income Classification

### Changed

- Octopus is now treated as reward income for operational performance calculations.
- Reward income still counts in real day totals, week totals, records, Best Day, exports, and general earnings history.
- Shift efficiency, earnings per hour, earnings per mile, hourly timing, and app-by-hour patterns now exclude reward income so work performance is not distorted.
- Existing Octopus history is automatically interpreted as reward income by app name, with no historical data migration or manual recoding required.

### Production Behavior

- No database schema, stored earning amounts, auth, XP, achievements, Ask My Data backend logic, exports, or Supabase project architecture behavior changed.

### Beta 0.2.1 — Late Earnings Adjustment Handling

### Fixed

- Late tips and historical earning edits now keep improving real day, week, record, efficiency, and Ask My Data totals.
- Historical earning adjustments are excluded from observed timing patterns when the update is saved after the original work day.
- Observed Update Hour now uses same-day earning updates only, preventing old tips from making the edit time look like a strong earning hour.

### Production Behavior

- No database schema, earnings storage, exports, auth, XP, achievements, Ask My Data logic, or Supabase project architecture behavior changed.

### Beta 0.2.0 — Earnings Snapshots + Honest Pattern Intelligence

### Added

- Added Earnings Snapshots V1 to record lightweight earning-update deltas when app earnings change.
- Added an `earnings_snapshots` migration with user-scoped RLS policies for future Lovable/Supabase deployment.
- Added snapshot-aware Shift Intelligence so timing patterns can use saved earning updates when enough update history exists.

### Changed

- Replaced Strong Hour language with more honest timing labels such as Observed Update Hour and Estimated Window.
- Hourly Heatmap now explains whether it is based on saved earnings updates or estimated from completed shift duration.
- Morning vs Night copy now distinguishes earning-update observations from shift-duration estimates.

### Known Limitations

- Earnings Snapshots are update-based, not ride-level timestamps.
- Until the migration is deployed to the live Lovable-connected backend, normal week saving continues but snapshot capture is skipped gracefully.
- Estimated timing remains directional only because Streex does not yet receive individual ride timestamps.

### Production Behavior

- No existing earning values, exports, Ask My Data logic, auth, XP, achievements, or Supabase project architecture behavior changed.

### Beta 0.1.2 — Shift Blocks Mobile Layout Fix

### Fixed

- Fixed mobile Shift Blocks editing layout so Start and End time fields no longer overlap or spill outside the card.
- Rebalanced Miles editing with the delete action so the miles field stays readable and proportional on narrow screens.
- Applied the same responsive safeguard to expanded weekly shift rows.

### Production Behavior

- No shift calculations, persistence, earnings data, auth, Ask My Data, XP, exports, backend schema, or Supabase architecture behavior changed.

### Beta 0.1.1 — Ask My Data Mobile Composer Fix

### Fixed

- Stabilized the Ask My Data mobile composer so it stays compact and contained when the iOS/Safari keyboard opens.
- Isolated the conversation scroll region and added safe-area-aware composer spacing to reduce visual overflow on mobile.
- Prevented the input area from expanding excessively while still allowing short multi-line prompts.

### Added

- Added browser-native voice input for Ask My Data when supported by the device/browser.
- Added graceful unsupported-state messaging when voice input is unavailable.
- Added Copy Conversation for copying the current Ask My Data chat as readable plain text.

### Production Behavior

- No Ask My Data analytics logic, auth, navigation, earnings data, backend schema, XP, exports, or Supabase architecture behavior changed.

### Beta 0.1.0 — Baseline

### Changed

- Reset Streex public versioning for beta using `0.x` semantic versions.
- Preserved the previous `V5.x` release history as the Alpha Archive instead of deleting it.
- Updated app version comparison so stale Alpha `V5.x` settings do not incorrectly block the Beta app as a newer update.
- Established the working rule that future prompts, bug fixes, polish sessions, and roadmap additions should be classified before assigning a version number.

### Current Beta Baseline Includes

- Full Focus operational dashboard.
- Shift + Mileage tracking foundation.
- Ask My Data intent routing and challenge-set QA foundation.
- Admin Ops, feedback inbox, app version control, and re-engagement email foundation.
- Daily Command Center with OpenWeather and TomTom.
- Branded iOS, Android, and browser PWA icons.

### Production Behavior

- No dashboard, auth, earnings, shifts, analytics, XP, exports, navigation, Supabase schema, or backend architecture behavior changed.

## Alpha Archive

The entries below are preserved as internal Alpha development history. They remain valuable for product memory, QA context, and changelog continuity, but public beta versioning now starts at `0.1.0`.

## V5.7.9 — Branded PWA App Icons

### Fixed

- Added a production manifest with branded Streex application icons for installed Android PWAs.
- Added explicit Apple touch icons for iPhone and iPad Home Screen installation.
- Added branded PNG favicon references for supported browser tab sizes.
- Replaced generic icon fallback behavior with stable public icon URLs.

### Production Behavior

- No dashboard, auth, earnings, shift, analytics, XP, exports, navigation, or backend behavior changed.
- Users with an existing Home Screen installation may need to remove and add Streex again because iOS and Android cache installed app icons aggressively.

## V5.7.8 — App Resume Persistence Audit

### Fixed

- Supabase auth restoration now relies on the initial auth session event instead of racing it against a separate session lookup.
- Auth state is cached in memory so React remounts and quick app resumes do not briefly fall back to login or replay the splash screen.
- Runtime access and version checks retain their last validated state during background refreshes instead of blocking the full app again.
- Update notices now appear only when the configured deployed version is newer than the client, preventing stale version settings from blocking a newer build.
- Week, settings, and active-shift state retain the last hydrated in-memory snapshot while the backend refreshes.
- Dashboard, Settings, Journey, Achievements, and the persistent app header now reuse the root authenticated user instead of creating competing auth subscriptions.

### Diagnostics

- Added development-safe lifecycle logging for app mount, splash reasons, auth restoration, visibility/page events, runtime checks, version checks, hydration, and intentional update reloads.
- Production logging remains quiet unless `streex_debug_lifecycle` is explicitly set to `1` in local storage.

### Production Behavior

- No database schema, navigation, dashboard design, earnings calculations, XP, achievements, exports, or Supabase backend architecture changes were made.
- A true cold launch, intentional refresh, or iOS process termination may still show the splash while the session is restored.

## V5.7.7 — Ask My Data Intent Router

### Fixed

- Added Ask My Data intent routing before answer selection.
- Prevented hour, streak, and month questions from falling through to best-day rankings.
- Added deterministic support for strongest month, highest earning streak, current goal pace, today ranking, closest record, and combined weekend trend.
- Added clearer capability-aware responses for unsupported hourly, location, ride-type, and rival/version questions.
- Added data-backed Insight / Evidence / Opportunity responses for insight and coaching prompts.

### QA

- Added `docs/ASK_MY_DATA_CHALLENGE_SET.md` for repeatable Ask My Data manual certification.

### Production Behavior

- No database schema changes were added for V5.7.7.
- No auth, dashboard, earnings storage, XP, achievements, exports, or roadmap systems were changed.

## V5.7.6 — Master Consolidation Polish

### Fixed

- Removed the generic standalone motivation banner between Utility and record context.
- Stabilized Ask My Data mobile layout with a scrollable message region and fixed input area.
- Fixed Ask My Data consecutive day-off reasoning to compare combined weekday-pair averages.
- Added a dedicated active shift card in Entry.
- Renamed historical shifts to `This Week's Shifts (N)`.
- Converted historical shift blocks into compact expandable rows.
- Balanced mobile shift edit fields so Start, End, Miles, and Delete no longer overlap.

### Production Behavior

- No database schema changes were added for V5.7.6.
- No XP, achievements, rival systems, auth, exports, dashboard calculations, or roadmap systems were changed.

## V5.7.5 — Admin Re-Engagement Email

### Added

- Manual User Re-Engagement email panel in Admin Ops.
- Test email flow before broadcasting to users.
- Audience options: test, specific user, inactive users, and all active users.
- Editable campaign subject, message, and app link.
- `APP_PUBLIC_URL` support for default app link, with admin override before send.
- Server-side `admin-email` Edge Function for sending through Resend.
- Marketing unsubscribe support through tokenized unsubscribe links.
- Email campaign and recipient audit tables.

### Production Behavior

- `RESEND_API_KEY` stays server-side and is never exposed in frontend code.
- Broadcasts require explicit confirmation.
- Blocked, delete-pending, and opted-out users are excluded from non-test audiences.
- No SMS, automated campaigns, dashboard, earnings, XP, Ask My Data, or exports changes were made.

### Files Created

- `supabase/functions/admin-email/index.ts`
- `supabase/migrations/20260602124500_reengagement_email_campaigns.sql`

## V5.7.4 — Admin Ops UX Hotfix

### Fixed

- Required update notices no longer block admin users from reaching Admin Ops.
- Required update notices now explain what is happening and include a Sign Out option.
- Admin login now has a distinct internal Admin Ops presentation and does not offer public sign-up.
- Avatar menu feedback entry simplified to Feedback.
- Feedback modal copy simplified.
- Feedback type selector now opens above the modal layer.

### Production Behavior

- No dashboard, earnings, XP, Ask My Data, exports, or Supabase schema changes were made.
- This version intentionally matches the tested `5.7.4` update target so a required-update lock clears after deployment.

## V5.7.2 — Admin Ops + Feedback Inbox + App Version Control

### Added

- Protected `/admin` route for internal Streex operations.
- Server-side admin access validation through the `admin-ops` Edge Function.
- `admin_users` foundation with initial owner admin seeded for `juangaudino@gmail.com`.
- User management overview with total users, recent users, inactive users, blocked users, usage stats, and account actions.
- Block/unblock support through account access controls.
- Restricted-account screen for blocked users.
- App-level Force Sign Out All Users using a global `forced_logout_after` timestamp.
- App version control with optional or required update notices.
- Suggestions / Feedback entry in the Avatar menu.
- Admin Feedback Inbox with status/type filtering and review workflow.

### Production Behavior

- No public admin registration was added.
- Admin actions are validated server-side and do not rely only on hidden UI.
- No service role key is exposed in frontend code.
- Delete user is intentionally implemented as `delete_pending` soft restriction, not destructive hard deletion.
- No dashboard, earnings, XP, Ask My Data, exports, themes, or Supabase project architecture changes were made.

### Files Created

- `src/pages/AdminPage.tsx`
- `src/components/AppUpdateNotice.tsx`
- `src/components/FeedbackDialog.tsx`
- `src/hooks/useAppRuntime.ts`
- `src/lib/adminOps.ts`
- `supabase/functions/admin-ops/index.ts`
- `supabase/migrations/20260602090000_admin_ops_feedback_version.sql`

## V5.7.1 — Navigation Cleanup + AI Visibility Layer

### Changed

- Ask AI is now promoted to the primary bottom navigation for stronger Ask My Data visibility.
- Compare moved from the bottom navigation into the Progress menu.
- History moved from the Avatar menu into the Progress menu.
- Progress menu now groups Journey, Monthly Recap, Letters, Achievements, History, and Compare.
- Avatar menu simplified to Settings, What's New, and Sign Out.

### Production Behavior

- No routes were removed or renamed.
- No dashboard logic, auth, earnings, XP, analytics, Supabase, or backend behavior changed.

## V5.7 — Full Focus Dashboard

### Added

- Full Focus Dashboard Experience as an operational dashboard mode, separate from themes.
- Settings → Dashboard Experience with Standard and Full Focus options.
- Persistent local Dashboard Experience preference that survives refresh and app reopen.
- Compact dashboard quick toggle for switching between Standard and Full Focus.
- Full Focus operational hierarchy with current earnings, same-day average comparison, goal progress, shift state, momentum, and Quick Add prioritized.
- Header and navigation quieting when Full Focus is active to reclaim vertical space.
- Dashboard mode toggle moved into the top app header near Progress/Profile controls, with the active mode clearly visible.
- Full Focus now uses a compact driver-console layout with Quick Add immediately after the cockpit summary.
- Daily Command Center renders as a compact utility strip in Full Focus so weather and traffic support the work session without dominating the top.
- Start Shift / End Shift is now available from the persistent top app header and stays synced with the real active shift.
- Full Focus toggle is now globally accessible from the persistent top app header instead of only appearing on Dashboard.
- Full Focus header copy now avoids repeating the same momentum wording shown in operational cards.
- Daily Start Hub added as a session/day welcome overlay when today has no shift blocks yet.
- Optional local profile fields added for first name and phone number, editable from Settings.
- Daily Start Hub can start a real persisted shift, dismiss to Dashboard, open Entry weekly setup, or open profile settings.

### Production Behavior

- No database schema changes were made.
- Full Focus is local preference only and does not alter stored earnings, weeks, exports, Ask My Data, XP, auth, weather, traffic, or Supabase architecture.
- Standard Dashboard remains the full exploration, identity, progression, and reflection experience.
- Full Focus reduces the prominence of reflection systems without deleting them.
- Shift Blocks now use the correct local target date instead of falling back to Monday when today's date lookup fails.
- Quick Add shift controls now persist to the same shift block model used by Entry.
- Entry shift blocks now support editing start time, end time, miles, and delete with confirmation.
- Week update failures now log useful context and avoid optimistic success messaging when the save request fails.
- Daily Start Hub and profile fields are additive local UI features and do not change database schema or block app usage.

### Files Created

- `src/lib/dashboardExperience.ts`
- `src/lib/dashboardExperience.test.ts`
- `src/hooks/useDashboardExperience.ts`

### Files Modified

- `src/pages/DashboardPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/AppShell.tsx`
- `src/lib/changelog.ts`
- `CHANGELOG.md`
- `PROJECT_CONTEXT.md`

## V5.6 — Shift + Hours & Pattern Intelligence

### Added

- Shift Intelligence Layer with manual Start Shift and End Shift controls in Entry.
- Shift duration tracking stored inside existing week/day entry data.
- Mileage Foundation with manual shift miles, daily miles, weekly miles, and mileage history through saved weeks.
- Efficiency Snapshot for earnings per hour, earnings per mile, and miles per hour.
- Pattern Intelligence on Career with strongest hours, productivity windows, morning vs night tendencies, and gentle recovery-window framing.
- Advanced Mode heatmap for hour-level work patterns and best apps by hour when enough shift data exists.
- Simple / Advanced Performance Mode setting stored locally.

### Production Behavior

- No database schema changes were made.
- No GPS, background location, telematics, or automated mileage tracking was added.
- Shift and mileage data are additive fields inside the existing `weeks.entries` JSON payload.
- Active shifts now persist immediately when started or ended, so refresh/reopen keeps the session active until End Shift.
- Start Shift now no-ops if a shift is already active in the week, preventing duplicate active sessions.
- Simple Mode now stays glanceable while Advanced Mode shows a distinct Operations Snapshot with shift duration, efficiency, mileage, work blocks, and deeper unlock states.
- Existing earnings, auth, Ask My Data, exports, XP persistence, dashboard systems, and Supabase architecture were not changed.
- Pattern intelligence is historical and manual-entry based; it does not predict demand.

### Known Limitations

- App-by-hour and hourly heatmap signals are derived from logged shift windows and daily/app totals, so they are directional rather than per-trip telemetry.
- Advanced hour patterns stay gated until enough completed shifts exist.
- Mileage is manual-first in V5.6; Movement Intelligence remains future roadmap.

### Files Created

- `src/lib/shiftIntelligence.ts`
- `src/lib/shiftIntelligence.test.ts`
- `src/lib/performanceMode.ts`
- `src/hooks/usePerformanceMode.ts`
- `src/components/ShiftIntelligencePanel.tsx`

### Files Modified

- `src/lib/types.ts`
- `src/pages/WeeklyEntryPage.tsx`
- `src/components/MobileDayDetail.tsx`
- `src/components/MobileWeekOverview.tsx`
- `src/pages/CareerPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/lib/changelog.ts`
- `CHANGELOG.md`

## V5.5 — Dashboard Utility Expansion

### Polish / QA

- Daily Command Center presentation tightened by removing location helper copy and reducing vertical noise.
- Weather and Traffic panels now use a compact responsive side-by-side layout when space allows.
- Live utility data refreshes automatically about every 30 minutes after location is enabled.
- Dashboard header spacing and logo footprint compressed while preserving navigation.
- Historical Day Ranking now stays on the active unfinished work day instead of jumping ahead because of date context.
- Ask My Data now defaults unspecified timeframe questions to full history instead of the recent 16-week window.
- Ask My Data can answer weekday lists and best/worst day rankings from tracked day totals without falsely claiming the data is unavailable.
- Historical weeks can now be edited from History without converting them to the active open week.
- Weather forecast preview was reduced to the next two snapshots for a tighter command-center footprint.
- Weather card now has subtle condition-aware tinting for rain, heat, and cold while preserving the active theme.

### Added

- Dashboard Utility Layer as a compact `Daily Command Center`.
- Live Weather Strip powered through a Supabase Edge Function and OpenWeather.
- Live Traffic Insights powered through a Supabase Edge Function and TomTom Traffic Flow.
- Utility widget layer with clear live, unavailable, denied-location, and provider-not-configured states.
- Milestone share card expansion for 100 Days Tracked and major XP level-up moments.
- International Utility Layer with centralized display-only currency and regional date formatting.
- Currency selector in Settings for USD, EUR, GBP, CAD, MXN, COP, and ARS.

### Files Created

- `src/components/DailyCommandCenter.tsx`
- `src/hooks/useDriverUtility.ts`
- `src/lib/currency.ts`
- `src/lib/currency.test.ts`
- `src/lib/driverUtility.ts`
- `src/lib/shareCards.test.ts`
- `supabase/functions/driver-utility/index.ts`

### Files Modified

- `src/pages/DashboardPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/lib/store.ts`
- `src/lib/shareCards.ts`
- `src/lib/changelog.ts`
- `supabase/functions/ask-my-data/index.ts`
- `CHANGELOG.md`

### Production Behavior

- No database schema changes were made.
- No earning values are converted or rewritten.
- Currency is display-only and persisted through the existing `user_settings.currency_symbol` field as a currency code.
- JSON and CSV exports continue to preserve raw numeric earnings.
- Weather and traffic API keys are not exposed to the frontend.
- Location is opt-in and local-only; coordinates are used for the live utility request and cached in the browser.

### Known Limitations

- Live weather requires `OPENWEATHER_API_KEY` to be configured as a Supabase Edge Function secret.
- Live traffic requires `TOMTOM_API_KEY` to be configured as a Supabase Edge Function secret.
- Traffic V5.5 uses TomTom flow around the current browser location; incident detail cards can be added later.
- Currency formatting does not perform FX conversion by design.

### Testing Notes

- Currency formatting should keep raw values unchanged while changing display format.
- Dashboard should load even when utility providers are not configured or unavailable.
- Location denial should not block dashboard usage.
- Share cards should only appear from real tracked history and derived XP events.
- Ask My Data direct best-week answers now handle currency codes as well as legacy symbols.

## V5.4.2 — Pulse Mode + Career Titles

### Added

- Pulse Mode as an optional momentum-reactive visual layer.
- Dashboard pulse states for calm, steady, streak, strong, and record-chase moments.
- Career Title Generator inside Driver Identity.
- Career titles derived from level, archetype, weekly goal progress, active days, and record proximity.
- Pulse Mode toggle in Settings.

### Files Modified

- `src/contexts/ThemeContext.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/components/DriverIdentityCard.tsx`
- `src/lib/driverIdentity.ts`
- `src/index.css`
- `src/lib/changelog.ts`
- `CHANGELOG.md`

### Production Behavior

- No backend, auth, earnings persistence, Ask My Data, exports, Supabase migrations, or XP event writing changed.
- Pulse Mode is local-only in V5.4.2 and can be disabled instantly.

## V5.4.1 — Night Drive Theme

### Added

- Night Drive theme as a fourth visual mode beside Light, Dark, and RPG.
- Cockpit-inspired surfaces with streetlight amber, dashboard teal, and asphalt depth.
- Subtle road-lane atmosphere in the app shell.
- Settings theme selector updated to include Night mode.

### Files Modified

- `src/contexts/ThemeContext.tsx`
- `src/pages/SettingsPage.tsx`
- `src/index.css`
- `src/lib/changelog.ts`
- `CHANGELOG.md`

### Production Behavior

- No backend, auth, earnings, XP, Ask My Data, export, dashboard logic, or Supabase behavior changed.

## V5.4 — XP + Identity System

### Added

- Dual XP System with separate Consistency XP and Performance XP.
- Driver Levels: Rookie, Road Runner, Steady Grinder, Street Pro, Top Earner, Elite Driver, Streex Legend.
- Automatic Driver Archetypes derived from tracked behavior.
- Historical Day Ranking for same-weekday context.
- Rival System based on the user's own historical benchmarks.
- Ideal Week Comparison based on best historical weekday totals.
- Day Off System V1 with neutral, non-punitive copy.
- Adaptive Comparisons with Calendar Pace and Worked-Day Pace.
- Dashboard Driver Identity card.

### Database Changes

- Added `xp_events` as an idempotent XP ledger.
- Added `UNIQUE (user_id, event_key)` to prevent duplicate XP awards.
- Added RLS policies so authenticated users can only view/insert their own XP events.

### Files Added

- `src/lib/driverIdentity.ts`
- `src/hooks/useDriverIdentity.ts`
- `src/components/DriverIdentityCard.tsx`
- `supabase/migrations/20260529120000_add_xp_events.sql`
- `src/lib/driverIdentity.test.ts`

### Files Modified

- `src/pages/DashboardPage.tsx`
- `src/lib/changelog.ts`
- `CHANGELOG.md`

### Known Limitations

- Day Off V1 is neutral and non-punitive, but there is no explicit `dayType` field yet to distinguish intentional rest from untracked time.
- Early Bird and Night Owl archetypes are not active yet because the current data model does not store reliable work times.
- XP events are derived from tracked week/day history and persisted through the client with idempotent event keys.

### Testing Notes

- XP event generation should not duplicate event keys.
- Level thresholds should advance cumulatively and never subtract XP.
- Archetypes should stay locked until enough worked-day history exists.
- Historical day ranking should compare against the same weekday.
- Day Off language should remain neutral.
- Dashboard, exports, Ask My Data, achievements, and existing records should remain unchanged outside the new identity card.
