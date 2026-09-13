# Streex New Chat Handoff

Last audited: 2026-09-06

This is the operational handoff for a new Codex, Claude, ChatGPT, or Lovable conversation. It describes the current repository state and the product decisions that must survive chat resets. Read it before proposing or implementing work.

Also read:

- `AGENTS.md`
- `docs/PROJECT_CONTEXT.md`
- `docs/STREEX_AI_WORKFLOW.md`
- `docs/PRODUCT_STATUS.md`
- `docs/ROADMAP.md`
- `docs/QA_RUNBOOK.md`
- `CHANGELOG.md`

## 1. Current Snapshot

- Product: Streex Gig Earnings App.
- Current public release: `Beta 0.9.6 - Earnings Attribution Integrity`.
- Current local source candidate: `Beta 0.9.13 - Deep Insights Operations Snapshot Comparison (pending owner QA)`.
- Production: `https://gig.getstreex.com`.
- Repository: `https://github.com/juangaudino/streex-gig`.
- Default branch: `main`.
- The owner confirmed 0.9.4 through extended real work and published 0.9.5 after its local release work. Always verify the live HEAD after a later publication.
- Frontend hosting: Vercel.
- DNS and domain: Cloudflare, `getstreex.com`.
- Active backend: owner-controlled Supabase project `ywbrovislvqkfzsyqpiv`.
- Active Supabase URL: `https://ywbrovislvqkfzsyqpiv.supabase.co`.
- Legacy backend: Lovable-managed Supabase project `mnwymfyvvdhekzvipjmp`.
- Never deploy active work to the legacy project unless the owner explicitly requests legacy inspection.

The 0.9.7 historical-import implementation is currently local on `main` and pending owner QA; do not assume it has been committed, pushed, or published until the owner confirms those steps.

## 2. Architecture

### Frontend

- React 18 + TypeScript.
- Vite 5.
- React Router 6.
- Tailwind CSS + shadcn/ui + Radix primitives.
- Recharts for analytics visualization.
- TanStack Query is installed; most core app persistence is handled through custom hooks.
- Lucide icons.
- `html2canvas` for Daily Report image capture.
- Vitest + Testing Library for tests.

### Production Flow

```text
Browser / installed PWA
-> gig.getstreex.com
-> Vercel static Vite deployment
-> owner-controlled Supabase Auth, Postgres, RLS, and Edge Functions
```

Cloudflare manages the domain/DNS and email routing. Cloudflare email routing is not an SMTP sender and does not replace Resend or another outbound email provider.

### Persistence Model

The primary earnings model is intentionally JSON-oriented:

- `weeks` is a user-scoped Supabase table.
- Each week stores an `entries` JSON array.
- Each day contains app earnings, bonuses, shifts/work blocks, mileage, rides through shifts, note metadata, logged state, and closed-day state.
- `user_settings` stores weekly goals, active apps, currency symbol, and Octopus balance.
- `earnings_snapshots` stores observed app-total transitions and timestamps.
- `earnings_attributions` stores the owner-scoped analytical timing decision for a positive snapshot without rewriting that snapshot or the reported total.
- XP, achievements, feedback, admin, runtime config, email campaigns, and access controls use dedicated tables.

Canonical TypeScript models live in `src/lib/types.ts`.

Important data rules:

- Money totals include ordinary earnings and bonuses/rewards.
- Operational efficiency excludes bonuses/rewards.
- Never calculate `$ / hour`, `$ / mile`, `$ / ride`, or shift efficiency without the required valid denominator and attributable operational earnings.
- Stored numeric data is not rewritten for display formatting.
- Daily notes are metadata only and never affect analytics.
- Octopus points are utility state only and never change earnings, rides, records, XP, achievements, or efficiency.
- Quick Add accepts accumulated app totals, not an amount-to-add workflow.

### Supabase Tables Represented in Generated Types

- `account_access_controls`
- `admin_users`
- `ai_usage_logs`
- `app_runtime_config`
- `earnings_snapshots`
- `earnings_attributions`
- `operational_snapshots`
- `email_campaign_recipients`
- `email_campaigns`
- `email_preferences`
- `feedback_items`
- `user_achievements`
- `user_settings`
- `user_onboarding`
- `week_revisions`
- `admin_audit_events` (server-only; support actions only)
- `weeks`
- `xp_events`

Generated client types: `src/integrations/supabase/types.ts`.

### Edge Functions

- `driver-utility`: OpenWeather + TomTom traffic, authenticated and server-side.
- `admin-ops`: protected admin operations and account controls.
- `admin-email`: re-engagement campaign foundation through Resend when configured.
- `ask-my-data`: analytics context, intent routing, and OpenAI streaming response path; it remains unverified until its Supabase secret, deployment, and authenticated QA are complete.
- `daily-ops-summary`: source-only deterministic GET endpoint for one authenticated calendar day; contract and deployment gate are documented in [`docs/DAILY_OPS_SUMMARY.md`](DAILY_OPS_SUMMARY.md). It is not deployed until the isolated branch is reviewed and authenticated QA is complete.

Required secrets vary by function and belong only in Supabase secrets:

- `OPENWEATHER_API_KEY`
- `TOMTOM_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `REPLY_TO_EMAIL`
- `APP_PUBLIC_URL`
- `OPENAI_API_KEY` only for Ask My Data; it belongs exclusively in Supabase Edge Function secrets
- Supabase-provided URL, anon/publishable key, and service role where required

Never put service-role or provider secrets in Vite variables or frontend source.

## 3. Routes and Navigation

Authenticated routes:

- `/` - Dashboard, Standard or Full Focus.
- `/entry` - Weekly Entry and shift editing.
- `/career` - Career intelligence and drill-downs.
- `/assistant` - Ask My Data UI.
- `/journey` - career journey feed.
- `/recap` - monthly recap.
- `/letters` - weekly letters.
- `/achievements` - achievements.
- `/history` - historical weeks.
- `/compare` - existing operational same-point weekly comparison guide.
- `/deep-insights` - desktop-first analytics cockpit and advanced comparison workspace.
- `/settings` - profile, themes, dashboard experience, security, data export, and preferences.
- `/admin` - protected admin operations.
- `/reset-password` - unauthenticated password recovery completion.
- `/live-work` - withdrawn after beta evaluation; unreferenced source is archived and no public route exists.

Navigation rules:

- Primary navigation: Dashboard, Entry, Career, Ask AI.
- Mobile bottom navigation also includes Progress as the fifth item.
- Desktop keeps Progress in the top navigation.
- Progress menu contains Journey, Monthly Recap, Letters, Achievements, History, Compare, and Deep Insights.
- Profile menu contains Settings, What's New, Feedback, and Sign Out.
- Do not add more permanent header controls without explicit UX review.

## 4. Finished Product Systems

### Authentication and Lifecycle

- Supabase email/password auth.
- Session persistence and defensive restore flow.
- Premium dark splash/auth visual system.
- Reduced-motion support for auth motion.
- Password reset and Change Password in Settings.
- Account restriction handling.
- Optional/required app update notices.
- iOS/PWA resume and safe-area handling.

### Dashboard

- Standard Dashboard and Full Focus modes.
- Current week earnings, goals, pace, records, identity, utility, and operations context.
- Full Focus is intentionally compact and operational.
- Full Focus Day vs Average, Goal bars, Historical Rank, and Conditions have contextual drill-downs.
- Historical Rank supports Day and Week tabs with nearby positions.
- Full Focus Utility Slot rotates deterministically between combined Conditions and Octopus reward progress.
- Weather and traffic remain one combined Conditions surface.

### Entry and Earnings

- Multi-app daily earnings entry.
- Custom app keys can exist in day app records; default apps are Uber, Lyft, Spark Driver, DoorDash, Amazon Flex, Instacart, and Shipt.
- Quick Add/Quick Update for primary apps using accumulated totals.
- Quick Update rides are accumulated per selected app, while miles remain one shared accumulated day total across shifts.
- App ride counts combine into the shift total; historical total-only rides remain unattributed and never receive invented Octopus credit.
- Decimal cents and locale decimal comma handling.
- Optional miles and rides during quick updates.
- Bonus entry by app/date.
- Octopus interpreted as reward/bonus income.
- Daily notes.
- Historical week/day editing.

### Shifts and Work Hours

- Start, Pause, Resume, End Shift.
- Work-block architecture under one shift session.
- Active work duration excludes pauses.
- Miles, ride count, and manual shift earnings recovery.
- Shift attribution uses manual earnings, snapshots, or safe single-shift-day fallback.
- Current-week and lifetime operations snapshots.
- Hours, earnings/hour, earnings/mile, miles/hour, rides, rides/hour where supported.

### Earnings Snapshots

- App earnings transition rows with previous amount, new amount, delta, timestamp, day, week, and optional shift ID.
- Duplicate client writes are guarded in `useWeekStore`.
- Snapshots provide observed update timing, not exact ride-level timestamps.

### Goals and Daily Report

- Weekly earnings goal and weekly hours goal.
- Outcome language distinguishes money, discipline, complete, and elite wins without shaming.
- End Day Daily Report with money, operational metrics, comparisons, weekly impact, records/milestones, narrative, notes, and export/share.
- Export captures the visible report DOM to keep design parity.

### Career, Progression, and History

- Achievements with rarity tiers.
- XP events and Driver Identity.
- Career titles and archetypes.
- Records, rivals, ideal-week comparison, milestones.
- Journey feed, Weekly Letters, Monthly Recaps, History, and operational Compare.
- Career drill-down expansion for monthly progression, best day/week, top earning app, best weekday, and career hourly efficiency.
- Full Focus was explicitly not changed by the Career drill-down release.

### Deep Insights

- Desktop-first `/deep-insights` analytics cockpit.
- Dark control-room and Classic Light treatments.
- Time, app, and weekday filtering.
- KPI strip, trend charts, weekly comparisons, weekday analysis, app contribution, hours, efficiency, rankings, and tables.
- Advanced Comparison workspace for 2-4 day/week/month/year/custom blocks.
- Existing `/compare` remains a separate operational guide.
- URL-backed comparison state.
- Selected micro-visualizations, percentile context, contribution rails, and activity marks.
- Operational Explorer custom dates, multi-weekday and time-window filtering, weighted operational rates, evidence labels, hourly profiles, and best-window rankings.
- Anonymous three-card Driver Playbook JPG export.

### Admin and Feedback

- Server-validated admin access.
- User totals, recent/inactive/blocked users, usage context, block/unblock, and soft delete-pending.
- Feedback inbox with type/status management.
- App version/update controls.
- Force logout architecture through runtime configuration.
- Re-engagement email campaign foundation.

### PWA, Branding, and Export

- Manifest, PWA icons, Apple touch icons, and branded favicons.
- Theme-aware `theme-color` and iOS safe area.
- Current STREEX logo variants for light/dark/splash contexts.
- JSON/CSV data export.
- Share cards and Daily Report image share/download.

## 5. Themes and Design Conventions

Implemented theme modes:

- Classic with System, Light, and Dark variants.
- Signature.
- Velocity.
- RPG.
- Night Drive (`night-drive` in code, often called Night in UI conversation).
- Optional Pulse Mode.
- Deep Insights has its own theme-aware dark cockpit / light editorial treatment.

Design rules:

- Mobile-first for live work; desktop-first only for Deep Insights and heavier admin/operations surfaces.
- Calm, premium, driver-centric, high signal-to-noise.
- No redesign unless explicitly approved.
- Full Focus is an operational interface, not a marketing page.
- Do not add cards simply because space exists; every card must earn its place.
- Use drill-downs for depth instead of permanent explanatory text.
- Do not place cards inside cards.
- Use Lucide icons, familiar controls, restrained radius, stable dimensions, safe-area support, and readable touch targets.
- Avoid one-note palettes, decorative gradient blobs, oversized internal headings, and cyberpunk overload.
- Strong visual changes must be discussed before implementation. The owner explicitly dislikes surprise redesigns or visual compromises described as merely "less elegant."
- Weather and traffic stay together in the Conditions utility.
- Full Focus should not be modified as a side effect of Career or Deep Insights work.
- No-shame language: days off and imperfect weeks are valid context, not failure.

## 6. Current Pending Work

### Highest Priority Operations

- Beta 0.10.0 Movement Capture & Zone Context has both migrations applied to the active backend and its implementation pushed to `main`. Authenticated iPhone QA confirmed foreground pickup/dropoff capture, single-ride exact-time linking, and that batch linking suppresses exact-time assignment. Its architecture is in `docs/MOVEMENT_CAPTURE_TECHNICAL_DESIGN.md`: Full Focus-first start/finish contextual capture, Entry as the same shared secondary control, Quick Actions as the only shift/accumulated-total hub, coarse private zones, no raw coordinate or route storage, and manual/Uber mileage remains authoritative. Continue normal real-work QA before publication status.
- Beta 0.10.1 Zone Intelligence & Evidence is implemented on `main` and reuses the applied Movement tables. It adds a third Deep Insights workspace, `Zone Intelligence`, with coverage-first reporting, private approximate zone cells, pickup-only eligible earnings, destination-flow context, and late-tip attribution. It must never infer zones, split batch money, expose raw location, or create a live navigation surface. Authenticated owner QA with genuine captured evidence remains required. Read `docs/ZONE_INTELLIGENCE_TECHNICAL_DESIGN.md` before changing its contract.
- Beta 0.9.6 is the current public Earnings Attribution Integrity baseline and is under real-work owner testing. Active-project migrations `20260802181319_earnings_attribution_integrity_096.sql` and `20260802181403_harden_earnings_attribution_privileges_096.sql` are applied and verified; they create owner-only attribution decisions without rewriting weekly JSON or original snapshots.
- The current local 0.9.6 QA refinement adds live active-shift attribution, worked-block exact-time validation, and separate same-weekday output/efficiency interpretation. Require the normal Quality Gate before publishing it.
- Configure the GitHub Actions `qa` environment with two isolated QA identities and the active public Supabase URL/publishable key, then run protected routes on desktop/mobile and the bidirectional read-only RLS check. Do not use the owner's personal account.
- The Supabase security advisor reports leaked-password protection disabled. Treat enabling it as a separate Auth settings decision, not as a schema defect or a reason to re-run migrations.

- Custom Supabase Auth SMTP and Cloudflare Turnstile are configured and owner-tested; keep delivery and CAPTCHA behavior under routine monitoring.
- Continue monitoring login/session persistence after the infrastructure migration.
- Validate Daily Report image export on an installed iOS PWA during a future export-affecting release.
- Stabilize bugs before starting another major system.

### Planned Product Work

- Latest public release: `Beta 0.9.6 - Earnings Attribution Integrity`.
- Current local source candidate: `Beta 0.9.13 - Deep Insights Operations Snapshot Comparison (pending owner QA)`; it includes the earlier local 0.9.7 through 0.9.12 candidate work.
- Current real-work verification priority: `Beta 0.10.0 - Movement Capture & Zone Context` and `Beta 0.10.1 - Zone Intelligence & Evidence` (implemented on `main`, active-backend migrations applied, initial authenticated iPhone Movement QA complete). Preserve manual mileage and accumulated-total semantics; location remains foreground-only and never becomes a route tracker. Zone Intelligence uses those records only retrospectively and must retain its coverage-first contract.
- The pending-candidate release gate includes a small-sample import, reload, cross-surface totals check, no-new-snapshots check, gradual backfill review, and owner QA of local saved views, accumulated multi-shift ride totals, and the new Operations Snapshot comparison lens. It is now secondary to the approved 0.10.0 design/implementation sequence.
- Do not normalize the weekly JSON model merely for scale; first solve silent write conflicts, recovery, and visible sync state for the owner's personal workflow.
- The version number can move if a patch or urgent fix ships first.

### Ask My Data

- OpenAI provider migration is implemented locally but is not live until `OPENAI_API_KEY` is configured in the active Supabase project and authenticated QA passes.
- The current code keeps deterministic analytics helpers and server-side auth/RLS. It uses Luna by default and reserves Terra for explicit cross-period comparisons or complex strategic synthesis.
- Do not assume the secret or Edge Function deployment exists merely because this source is present.

### Data and Analytics

- The local 0.9.7 History importer now accepts the structured Excel template (Daily Earnings, Optional Shifts, Pauses, Bonuses) plus normalized CSV, previews warnings/conflicts, preserves existing values, and suppresses historical snapshot creation. Import the multi-year archive only in small reversible batches after owner QA.
- Import must validate dates, apps, numeric values, conflicts, and existing days; never bulk-write production without dry-run/preview.
- Continue improving shift-level earnings attribution from snapshots.
- Historical weather, traffic, market, vehicle, GPS, and ride-level time analysis are blocked until reliable source data is stored.
- Search/browse daily notes across long history remains deferred.

### Utility and Driver Context

- Research aviation data providers before Flight Reservation Tracker or Airport Pulse.
- Traffic Intelligence candidates: delay awareness, incidents, and human-readable severity without navigation/routing.
- Market/geographic intelligence, smart mileage, and vehicle/maintenance systems remain strategic future work.

### Admin and Email

- Keep Resend sender domain and reply-to verified if re-engagement campaigns are used.
- Cloudflare routing receives email but is not the outbound campaign/auth sender.
- Hard user deletion remains intentionally absent; current action is delete-pending/blocked behavior.

### Long-Term Roadmap

- Operations Center / desktop headquarters.
- Deep Career expansion, consistency/stability analytics, ecosystem risk, collectible achievements, and legacy systems.
- Internationalization and unit preferences are deferred; miles/Fahrenheit remain current assumptions.
- AI conversation archive/export and memory continuity.
- Native SwiftUI app only after the web/PWA product stabilizes.

Read `docs/ROADMAP.md` for the complete preserved roadmap and guardrails.

## 7. Known Bugs, Risks, and Honest Limitations

- Ask My Data is provider-blocked/unverified after leaving Lovable infrastructure; its UI existing does not mean the AI path works.
- Custom SMTP removes reliance on the default auth-email quota, but delivery still depends on correct provider/domain configuration and should be monitored.
- Provider secrets and Edge Function deployments can drift between local repo, Vercel, and Supabase. Verify, never assume.
- Historical shift data is incomplete. Efficiency coverage is much smaller than earnings history, so broad career `$ / hour` values need explicit coverage context.
- Earnings snapshots observe manual update moments. They are not ride timestamps and cannot prove exact best earning hour.
- Multi-shift-day earnings can be unresolved without snapshots or manual shift earnings; honest UI should show no efficiency rather than invent allocation.
- Current model does not reliably store market/location, vehicle, route, historical weather, historical traffic, or per-app hours/miles.
- iOS Safari/PWA process kills still create true cold launches; only short resumes can be made continuous.
- PWA icon changes may be cached by iOS/Android and can require removing/reinstalling the home-screen app.
- Beta 0.9.5 splits routes and defers image-export code. Keep monitoring generated chunk size instead of treating the JSON persistence model as the source of frontend bundle weight.
- Beta 0.9.6 separates observed timestamps from earned-time attribution. Reported money stays in its original day/week record; operational hourly analytics use only resolved attribution and exclude pending late earnings.
- Beta 0.9.6 also replaces separate small header shift buttons with one compact Quick Actions trigger. Large shift controls live inside the sheet, and single-flight locking prevents rapid repeated taps from issuing duplicate saves.
- React Router 7.18.2 has one current npm advisory explicitly limited to unstable RSC APIs. Streex is a client-only Vite SPA and uses neither RSC nor server actions; this is a documented non-applicable exception until a compatible patched package is published.
- Local `.env` may be stale. Vercel Production variables are the deployment source of truth.
- The repository contains old local/remote branches. Do not merge or delete branches blindly; compare against `main` first.

## 8. Important Files

### Start Here

- `AGENTS.md` - permanent Codex rules.
- `docs/NEW_CHAT_HANDOFF.md` - this handoff.
- `docs/PROJECT_CONTEXT.md` - architecture and infrastructure.
- `docs/PRODUCT_STATUS.md` - living product status.
- `docs/ROADMAP.md` - living roadmap.
- `docs/STREEX_AI_WORKFLOW.md` - tool/AI roles.
- `CHANGELOG.md` and `src/lib/changelog.ts` - release history and current version.

### App Shell and Routes

- `src/App.tsx`
- `src/pages/AppShell.tsx`
- `src/contexts/ThemeContext.tsx`
- `src/index.css`
- `index.html`
- `public/manifest.json`

### Data and Persistence

- `src/lib/types.ts`
- `src/lib/store.ts`
- `src/hooks/useWeekStore.ts`
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `supabase/config.toml`
- `supabase/migrations/`
- `supabase/functions/`

### Earnings and Operations

- `src/pages/WeeklyEntryPage.tsx`
- `src/components/QuickEntryWidget.tsx`
- `src/lib/earningsSnapshots.ts`
- `src/lib/rewardIncome.ts`
- `src/lib/shiftIntelligence.ts`
- `src/lib/weeklyOperations.ts`
- `src/components/ShiftIntelligencePanel.tsx`
- `src/components/EndDayDialog.tsx`

### Dashboard and Utility

- `src/pages/DashboardPage.tsx`
- `src/components/FocusUtilitySlot.tsx`
- `src/components/DailyCommandCenter.tsx`
- `src/components/MetricDrillDownSheet.tsx`
- `src/lib/dashboardExperience.ts`
- `src/lib/driverUtility.ts`
- `src/lib/octopusRewards.ts`

### Career and Analytics

- `src/pages/CareerPage.tsx`
- `src/lib/career.ts`
- `src/lib/careerDrillDowns.ts`
- `src/lib/careerDrillDownDetails.ts`
- `src/pages/DeepInsightsPage.tsx`
- `src/components/AdvancedComparisonBuilder.tsx`
- `src/lib/deepInsights.ts`
- `src/lib/comparisonBuilder.ts`

### Auth, Runtime, and Admin

- `src/hooks/useAuth.ts`
- `src/hooks/useAppRuntime.ts`
- `src/hooks/useAppLifecycle.ts`
- `src/pages/AuthPage.tsx`
- `src/pages/ResetPasswordPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/lib/adminOps.ts`
- `src/lib/appVersion.ts`

### Ask My Data

- `src/pages/AssistantPage.tsx`
- `supabase/functions/ask-my-data/index.ts`
- `supabase/functions/ask-my-data/index.test.ts`
- `docs/ASK_MY_DATA_CHALLENGE_SET.md`

## 9. Development and Deployment Workflow

### Local Commands

```bash
npm install
npm run dev
npm test
npm run build
npm run lint
```

There is no dedicated `typecheck` script. Production build and Vitest are the normal validation baseline. Use narrow tests first, then the full suite and build for meaningful changes.

### Environment Variables

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID` may exist in Vercel even though `.env.example` currently lists only the first two.

Production variables live in Vercel. Do not print their values in chat or docs.

### Deployments

- Pushes to `main` trigger Vercel Production deployment.
- Branch pushes can create Vercel Preview deployments when configured.
- Supabase migrations and Edge Functions do not deploy merely because frontend code was pushed.
- For backend work, explicitly apply/deploy to `ywbrovislvqkfzsyqpiv` and report that requirement.

### Git and Multi-AI Workflow

- GitHub is the source of truth for code.
- Codex should inspect current branch/status before editing.
- Work directly on `main` only when the owner explicitly requests it or the current workflow already establishes it.
- For Lovable visual work, prefer a dedicated branch, let Lovable publish there, inspect the Vercel Preview, then have Codex review the diff before merging.
- Do not let Lovable deploy backend changes to the legacy Supabase project.
- Do not revert unrelated user/Lovable/Claude changes.
- Meaningful changes update both changelogs and relevant roadmap/status docs.
- The owner often asks for a challenge before execution. If a request is exploratory, visually strong, data-sensitive, or says to challenge it, discuss concerns before editing.
- Once the owner approves, implement end-to-end without stopping at a proposal.

### Versioning

- Current public baseline: `0.9.6`.
- Current local candidate: `0.9.7 Historical Data Import (pending owner QA)`.
- Patch: focused fix/refinement/polish.
- Minor: meaningful new surface/system.
- `1.0.0`: first stable public release only.
- Alpha `V3.x`-`V5.x` history remains archived.
- Before meaningful implementation, classify/propose the version if the user did not already approve one.

## 10. Product Owner Collaboration Rules

- The owner is comfortable challenging prompts and expects Codex to challenge weak logic before execution.
- Do not silently reinterpret product direction.
- Protect calculations and historical data above visual convenience.
- Strong visual changes require prior agreement; narrow bug fixes can proceed when clearly approved.
- Do not overbuild. Build the smallest complete version that fits the established architecture.
- Preserve routes and stable production behavior.
- When a migration or function deployment is required, explain exactly what the owner must do in Supabase.
- When network restrictions prevent Codex from pushing, create the commit if requested and give the exact `git push origin main` command.
- The owner may use Lovable credits for visual review. Lovable is an optional frontend collaborator, not the production infrastructure owner.
- Claude and ChatGPT may advise on UX/product direction, but repository state and tests decide implementation truth.

## 11. First Actions in the Next Chat

1. Confirm the repository root and current branch.
2. Run `git status --short --branch` and inspect the latest commit.
3. Read this file, `AGENTS.md`, `docs/PRODUCT_STATUS.md`, and `docs/ROADMAP.md`.
4. Do not assume Ask My Data, Edge Function secrets, or migrations are deployed merely because source exists.
5. If the local 0.9.7 importer is still pending, verify its preview, conflict gate, no-snapshot save path, and cross-surface totals before publication.
6. Otherwise ask what the owner wants to tackle next, or plan the explicitly named roadmap item.

The local source also contains `0.9.11 - Deep Insights Productivity`, `0.9.12 - Multi-Shift Ride Accumulation Integrity`, and `0.9.13 - Deep Insights Operations Snapshot Comparison`; saved views are browser-local, CSV retains evidence context, daily app-ride totals now assign only their delta to the active shift, and Operations Snapshot comparisons use canonical work-block efficiency. The next product step remains owner QA/publication gates and historical-import review before another feature. Bug stabilization or infrastructure work may still take priority and should renumber the roadmap honestly.
