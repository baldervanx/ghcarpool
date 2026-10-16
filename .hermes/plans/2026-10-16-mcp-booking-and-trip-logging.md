# MCP interface for booking cars and logging trips

**Status:** Proposed implementation plan; no MCP functionality implemented.
**Date:** 2026-10-16
**Goal:** Allow an authenticated user's agent to find suitable cars, create
bookings and register odometer readings without bypassing the application's
rules, warnings or confirmations.

The document is in English, consistent with the documentation direction in
`TODO.md`. User-facing replies should initially support Swedish. Names and
examples below are illustrative, not assertions about production data.

**Confirmed requirements (2026-10-16):** Destination distances already mean
round-trip kilometres. The normal preference is a return trip without charging
en route, but longer trips requiring charging must remain bookable: prefer a
long-range car and disclose the charging requirement. The current `Car.range`
has no established operational meaning and may be replaced; existing code
references still need to be updated as part of that replacement.
Cars normally charge at home approximately 00:00-06:00. The planning model may
therefore assume a full battery after an eligible overnight home-charging
window, and no charging during the day unless explicitly reported or planned
for a charging-dependent trip. This is a disclosed planning assumption, not
telemetry or a requirement for a fresh manual observation every morning.

## 1. Recommended approach and scope

Build a thin MCP adapter inside the existing Express backend. Both REST and
MCP must call the same application services. Do not expose database CRUD tools,
ask the agent to reproduce frontend calculations, or implement a second set of
booking rules in the MCP handlers.

```text
Web UI -> REST adapter -----+
                           +-> application services -> PostgreSQL
Agent  -> MCP adapter -----+       |
                                   +-> policy, warnings, estimates, receipts
                                   +-> existing SSE notifications after commit
```

Start with a small task-oriented interface:

- Read context, resolve cars/destinations, find available and suitable cars.
- Preview and create a single-day booking.
- Preview and register a trip using a full odometer reading or its final digits.
- Retrieve the authoritative outcome of a write after a timeout.

Keep changing/cancelling bookings, trip corrections, recurring/multi-day
creation, booking swaps, administration and charging control out of the first
MCP release. Reject unsupported requests explicitly and link to the web UI.
Existing multi-day and recurring bookings must still be understood when
calculating availability, warnings, range and logging an existing booking.
An optional chat on the home page is a later client, not a prerequisite.

**Release boundary:** Read-only availability can ship first. Do not enable
range-qualified booking or trip-writing tools until shared backend validation,
freshness checks, idempotency and the corresponding web changes are complete.

## 2. Findings in the current application

These findings come from the current worktree, not just `AGENTS.md`, which does
not describe every current model or route.

| Surface | Existing behavior | Required change |
|---|---|---|
| `packages/backend/prisma/schema.prisma`: `Car` | Already has `range Int @default(0)`, `name`, `order` and `hasLog`. The owner confirms range is not operationally used yet, although frontend/API references exist. | Replace `range` with explicitly defined range fields and update all references. No legacy range semantics need to be preserved. Add winter and observed-energy data. |
| `Destination`, `Booking` | Destination has optional `distance`; booking stores its own distance. Destination distances are confirmed round-trip km. | Use destination distance directly as the total trip distance; never double it. Document the reference departure base and preserve provenance/snapshots. |
| `routes/bookings.ts` | Transactions, car locks, overlap checks, past-date policy, logged-booking protection and recurrence metadata checks already exist. | Extract services; complete input and actor-policy checks and add distance/range evaluation. Preserve locking. |
| `routes/bookings.ts` | A non-CUID destination string may create a temporary destination during save. The response is a date/car container. | Resolve ambiguous names before writes; previews must never create destinations. Return the precise affected booking and receipt from new services. |
| `routes/trips.ts` | Creation locks the car, rejects non-increasing odometers, checks `hasLog` and atomically logs linked bookings. Multi-day logging marks the series; ordinary recurring logging marks one occurrence. | Reuse these guarantees. Add server-side derivation, warnings, confirmations and consistent correction/deletion handling. |
| `routes/trips.ts`: list | Defaults to a 30-day window; frontend selects the latest matching trip from loaded state. | Add an authoritative per-car logging context with no arbitrary recent-history cutoff. |
| `frontend/src/pages/register-trip.tsx` | Expands final odometer digits, calculates distance/cost, requires selected users' comments and handles logging-for-others and distance confirmations. | Move authoritative rules to backend; frontend only captures input and renders service results. |
| `frontend/src/lib/booking-log.ts`, `components/booking-warnings.tsx` | Predecessor/own-missed-booking warnings are frontend logic, using loaded booking history. | Implement backend queries and one warning policy shared by both clients. |
| `frontend/src/pages/book-trip.tsx` | Some field rules and distance requirements are client-only. Series writes use multiple requests; swaps are sequential operations. | Centralize single-booking validation now. Require atomic backend commands before exposing these compound operations through MCP. |
| `components/destination-selector.tsx` | Copies the already round-trip destination distance into the booking. | Preserve this behavior and label the unit/meaning explicitly in web and MCP contracts. |
| `routes/admin.ts`, `routes/car-info.ts`, serializers and frontend store/admin pages | Admin car/destination/settings editing exists, but car info has no energy observations. | Wire new fields through schema, validation, serializers, API clients, types and admin UI; add an observation workflow. |
| `src/app.ts`, `middleware/auth.ts`, OIDC libraries | Browser access uses Passport/PostgreSQL sessions; OIDC signs users into this session. No MCP resource-server authorization exists. | Add separate MCP token authentication mapped to local users; keep browser login intact. |
| `lib/booking-events.ts`, `lib/sse.ts` | Post-write, in-process SSE notifications. | Preserve notifications for MCP writes too; do not mistake SSE for a durable receipt/outbox. |

Deletion currently has an explicit booking creator/admin restriction, while
booking updates have no equivalent creator restriction in the route. The UI
allows editing another person's booking with confirmation. Logging another
person's booking is also intentional. Specify these as explicit domain policies
instead of accidentally changing them to owner-only access during extraction.
MCP scopes constrain operations further; they must never expand local authority.

## 3. Application services and web/API convergence

Suggested modules under `packages/backend/src/`:

```text
domain/             typed commands, results, issue codes, runtime schemas
services/
  booking-context.ts       identity resolution, availability, booking queries
  booking-service.ts       preview/create; later update/cancel/series/swap
  trip-service.ts          logging context, odometer preview, create/corrections
  warning-service.ts       predecessor, own missed logs, confirmation rules
  range-service.ts         distance and chronological energy projection
  operation-service.ts     previews, idempotency, receipts, audit records
mcp/                tool definitions, protocol mapping, authorization adapter
```

Use one runtime schema source for REST command validation and MCP JSON Schemas
where practical. Add a shared workspace contract package only if needed by both
clients; do not make React import backend/Prisma runtime code.

The services receive an explicit `ActorContext` with local user ID, client ID,
transport and granted permissions. Never accept an actor/admin flag from tool
arguments. Booking participants and the user performing a write are distinct.
Default new booking participants to the authenticated user when omitted, return
that assumption, and never silently reuse another conversation's participants.
For linked trip logging, derive participants from the booking and disclose them.

Before exposing writes:

1. Extract existing transactions without behavior changes and add parity tests.
2. Enforce finite, safe integer odometers/distances; non-empty, unique, existing
   users; valid calendar dates; integer booking minutes; `0 <= start < end <= 1440`;
   bounded comments and command sizes. Define which commands require distance.
3. Derive trip distance and price server-side. Use the configured price and an
   explicit currency/rounding rule; never trust agent-supplied `cost`. Snapshot
   the applied rate on a trip so later settings changes do not rewrite history.
4. Move comment requirements and warning/acknowledgement rules into services.
   Required comments remain required even if a car has no range model.
5. Make REST writes enforce the same rules. Roll out new REST contracts and web
   UI together, keeping old response shapes through adapters where necessary.
   Do not leave a legacy endpoint that bypasses new safety rules.
6. Route relevant trip update/delete paths, including admin paths, and range
   observation/configuration changes through shared locking/versioning rules.
   Corrections must preserve valid odometer history and booking/trip links;
   deletion must not leave `Booking.logged` referring to a missing trip.

Keep warnings separate from permissions. Confirmation never grants permission
to delete another user's booking or to override a hard validation failure.
Any intentional tightening of current behavior needs an explicit release note.

## 4. MCP transport, compatibility and authorization

### Transport and protocol

Use the official TypeScript SDK and **Streamable HTTP**, mounted at `/mcp`
before browser-session-protected routers and the SPA fallback. Keep the existing
two-service deployment; no separate public MCP process is needed initially.
Do not reuse `/api/v1/bookings/stream` as an MCP transport.

The published latest specification checked on 2026-10-16 is **2026-07-28**.
It differs materially from 2025-11-25: per-request capabilities/metadata replace
the initialization-based model, protocol sessions and the old GET stream are
removed, and additional input uses multi-round-trip results.

Implementation begins with a compatibility spike against the chosen clients
and a pinned, released SDK. Record an explicit matrix of supported protocol
revisions, transport behavior, authorization and elicitation support. Prefer the
current revision when SDK/client support is verified. If target clients only
support 2025-11-25, document that supported baseline and its SDK-provided
compatibility path; do not mix wire formats or claim untested latest support.
Do not hand-build a compatibility layer.

Prefer short JSON responses; stream only when needed. Bind actor identity on
every authenticated request, never via a shared SDK object or protocol session.
Set timeouts, request limits and bounded/paginated searches. Limit exposure to
the configured host and validate supplied `Origin` headers against an explicit
allowlist; missing Origin in a native client does not replace token validation.
TLS and proxy streaming configuration remain infra-owned.

### Authorization

For remote MCP, use an OAuth 2.1-compatible authorization server and make the
app a protected resource server:

- Publish RFC 9728 protected-resource metadata and appropriate
  `WWW-Authenticate` challenges. Use discovery, authorization code + PKCE and
  explicit resource/audience binding.
- Validate issuer, audience, expiry and granted scopes using the provider's
  supported JWT validation or introspection mechanism. Reject ID tokens as API
  access tokens, wrong-resource tokens and token passthrough.
- Map validated issuer + subject to an existing local identity. Retain local
  admin policy; never infer it from provider groups or a supplied email.
- Suggested scopes: `carpool:read`, `carpool:bookings:write`,
  `carpool:trips:write`; later add narrowly scoped administration only if needed.
- Check Authelia's actual resource-token/scopes/client-registration support in
  the deployed version. Existing OIDC browser login is not proof it supports
  this use case. Use pre-registered clients if supported; do not build a custom
  authorization server merely to add MCP.
- Keep browser sessions and MCP bearer authentication independent. Scope
  cookie/session middleware to browser routes as needed; a bearer MCP call must
  not accidentally require a login cookie or create a browser session.
- Document revocation, token expiry/refresh and deactivated-user behavior.
  Browser logout alone does not revoke an agent's access token.

Start read-only or restrict access to a private pilot until authorization works.
A local stdio adapter is optional later; it must still use per-user credentials
and domain services, never privileged direct database access or copied cookies.
No shared administrator token and no passwords collected through tool input.

## 5. Task-oriented tools

Use descriptive names, strict `inputSchema`, typed `outputSchema` and examples
in descriptions. Dates, distances, odometer units and state-changing behavior
must be obvious without reading this plan.

| Tool | Main input | Main output / behavior |
|---|---|---|
| `get_booking_context` | Optional locale | Authenticated user, server time, IANA timezone, local date, units, supported operations and relevant policy. Never secrets. |
| `find_available_cars` | Date, optional interval, destination ID/query or explicit total distance, optional car query, charging preference | All relevant cars, free intervals, time availability, trip suitability, range projection, charging requirement, issues and deterministic recommendation. Default: prefer no charging, not prohibit charging. No writes. |
| `get_my_bookings` | Bounded date interval, optional car | IDs and summaries for the user's bookings, including log status and relevant warnings. |
| `preview_booking` | Date/interval, selected car or selection criteria, destination/distance, optional participants/comment and charging preference | Resolved command, selected car, round-trip distance, charging requirement, assumptions, price estimate if applicable, issues and expiring preview ID. No booking or temporary destination created. |
| `commit_booking` | Preview ID, idempotency key, required acknowledgement IDs | Revalidates and atomically creates exactly the previewed booking; returns persisted outcome. Cannot silently select a different car. |
| `get_trip_logging_context` | Car ID/query, optional booking ID | Latest authoritative odometer and trip, baseline version, eligible bookings, participants, comment requirements and warnings. |
| `preview_trip_log` | Car/booking reference, exactly one of full odometer or final-digit string, optional participants/comment | Expanded reading, distance, cost, affected bookings and issues; requests missing or ambiguous information without writing. |
| `commit_trip_log` | Preview ID, idempotency key, required acknowledgement IDs | Atomically creates the trip and marks the exact linked booking(s) logged; returns persisted outcome. |
| `get_operation_result` | Operation ID or actor/client-scoped idempotency key | Authoritative committed/rejected/pending outcome for recovery after lost responses; no mutation. |

Car and destination queries match ID, normalized name and explicit aliases.
`Vita` can already match `Car.name`; do not assume the model has `shortName`.
Add normalized aliases with uniqueness rules if multiple familiar names are
needed. Exact unique matches can resolve automatically; fuzzy matches are
suggestions, never silent choices. Ambiguity returns a short list with stable
IDs and distinguishing names. Unknown destinations need an explicit name,
origin and distance clarification, not an invented map distance.

The agent resolves natural language; tools take structured, absolute values.
Provide a context tool so "tomorrow" is anchored to server local time, not the
agent machine's timezone. Initial default is configurable `Europe/Stockholm`.
Echo resolved dates/times and timezone in previews and receipts. Align existing
past-booking checks with this timezone instead of relying on process-local
time. Handle DST gaps/ambiguities explicitly; do not silently shift times.

For "Which cars are free today?", no interval is missing: return free intervals
for the rest of today, distinguish fully/partially free cars and disclose that
interpretation. Support an explicit whole-day mode. A missing destination does
not prevent answering time availability, but means trip suitability is unknown.

Tool annotations are hints, not security controls: mark queries/previews
`readOnlyHint: true`; mutations false. Set destructive/idempotency/open-world
hints to match actual semantics. In particular, a commit is only idempotent
with the same durable key and payload. Update annotations if external map
services are introduced. Do not expose raw SQL, generic arbitrary HTTP tools
or a single opaque natural-language `execute` tool.

Resources/prompts may later provide policy/help text, but correctness must not
depend on a client reading them. No sampling or agent-side calculation is
required to enforce business rules.

## 6. Results, warnings and clarification

Define a transport-independent result contract, mapped into MCP
`structuredContent` and a concise matching text response. Suggested fields:

```text
schemaVersion, status, requestId, evaluatedAt, timezone
data, assumptions[], issues[], clarification?
preview?: { id, expiresAt, summary, requiredAcknowledgementIds[] }
operation?: { id, outcome, committedAt, resourceIds, appUrl }
```

`status` is a discriminated union: `ready`, `needs_input`,
`needs_confirmation`, `rejected`, `committed` (plus `pending` for an operation
lookup if genuinely needed). Define a JSON Schema for each branch.

Every issue has a stable `code`, severity, affected field/resource, message key,
parameters, localized fallback message and a clear next action.
Classify separately:

- **Blockers:** overlap, unknown required distance/energy that prevents evaluating
  the departure, insufficient range when the user explicitly requires no
  charging, invalid reading, missing required comment, unknown legacy series type.
- **Confirmation-required warnings:** logging for others, substantial distance
  deviation, unusually long trip, charging required for the round trip, editing
  another person's booking if enabled. Charging acknowledgement permits the
  supported long-trip workflow; it is not a generic range-validation override.
- **Advisories:** own missed logs, uncertain but usable estimates, predecessor
  not logged, pending synchronization if that feature is later implemented.

Keep existing predecessor behavior: inspect the immediate preceding ended
booking, even across dates; never skip an own/logged predecessor to warn about
an older one. An own predecessor gives no predecessor warning, while own missed
logs remain a separate reminder. Do not introduce a 14/30-day cutoff into
authoritative checks. A predecessor warning is advisory today, not a new
unannounced prohibition; if it makes odometer allocation unreliable, return a
separate explicit blocker explaining what information must be corrected.

Preserve the current distance confirmation policy initially: compare with the
booking using a tolerance of `max(bookedDistance / 5, 2 km)` and its current
strict boundary comparisons; without a connected booking, warn above 500 km.
Document intentional boundary changes separately rather than silently changing
them during extraction. Return all applicable issues together, even when the
old UI's conditional ordering showed only one at a time.

Clarifications contain field names, an explanation, permissible options with
stable IDs and a reply schema. Distinguish absent fields from explicit zero,
false or an empty string. Ask only for data actually required for this operation.
For example, ask for destination distance, not a full address, if manually
specified total distance is sufficient.

Use elicitation when the client/revision supports it. On 2026-07-28 use its
`input_required` / MRTR flow; on a supported older revision use the SDK's
corresponding capability-gated flow. Always provide a normal structured
`needs_input` / `needs_confirmation` fallback so a client without elicitation
can ask the user and retry. Cancellation/decline/expiry writes nothing.
Never request credentials through elicitation forms.

Malformed schemas/unknown methods are protocol errors. Expected business
failures are actionable tool results; map rejected execution to MCP `isError`
as appropriate for the supported revision. Ordinary clarification is not an
internal error. Unexpected failures get a safe message and correlation ID,
with server-side diagnostics, not raw Prisma errors or stack traces.

## 7. Preview, consent, concurrency and durable receipts

All initial MCP writes use **preview -> commit**. A preview is not a reservation.
Store an expiring immutable command, actor/client binding, relevant versions,
calculation-policy version and the exact issues requiring acknowledgement.
A server-side stored preview is preferable to exposing a large signed payload.

The host presents the selected car, absolute time, distance, participants and
warnings before committing, subject to its explicit user-consent/delegation
policy. An unambiguous instruction may authorize an ordinary booking within
that policy; the server must still return the exact outcome. Missing facts or
confirmation-required warnings always need real user input. The agent must
not manufacture acknowledgements. A protocol flag cannot prove human consent:
if stronger assurance is required, use an authenticated app confirmation page
and a server-issued approval bound to the preview.

Inside one short database transaction:

1. Claim a unique `(actorId, clientId, idempotencyKey)` operation and compare the
   canonical command hash. Same key/different command is a conflict; same
   key/same command returns the original durable result.
2. Lock affected cars in deterministic order, then recurrences using existing
   ordering. All relevant writers, including web/admin, must use this discipline.
3. Re-read permissions, current bookings, odometer, range observations,
   configuration and warnings. Verify preview version/expiry and
   acknowledgement bindings. If meaning or required warnings changed, return
   a stale-preview result requiring another preview. Never accept stale consent.
4. Recheck overlap, chronology and range; write domain changes, operation receipt
   and audit record atomically. Consume the preview, with duplicate use resolving
   to the same operation rather than another booking.
5. Publish existing SSE events after commit. A notification failure must not
   turn a committed write into a report that implies nothing was saved.

Use explicit version counters for relevant aggregates/configuration, updated by
all write paths; timestamps alone are not a complete concurrency protocol.
No database locks while waiting for users, maps, identity providers or an LLM.
Bound idempotency retention and keep a consumed-preview reference long enough
to prevent delayed duplicate execution. Preserve receipts across restarts.
Connection loss/cancellation after commit does not undo the write; recover by
operation/key, never retry with a new key merely because the response was lost.

A successful receipt reports persisted IDs and values: car ID/name, date,
start/end/timezone, destination and total distance, participants, or old/new
odometer, trip distance, price/currency and every booking marked logged.
For a charging-dependent booking, include its persisted charging requirement
and acknowledged conditions in the receipt, not only in the preview.
Include a safe same-origin app link and remaining warnings. Do not return only
`ok: true` or treat successful preview as successful booking.

If the separate Firebase beta-sync plan is implemented, distinguish local commit
from remote replication. Include sync state/warnings from that shared service;
do not promise synchronized success or add direct Firebase writes in MCP.

## 8. Distance, car data and remaining-range model

### Explicit, maintainable data

Destination distances are already round-trip km; no reinterpretation or
doubling is required. Define new range fields explicitly rather than inheriting
meaning from the unused `Car.range`:

| Data | Suggested representation and ownership |
|---|---|
| Reference range | Replace `range` with nullable `nominalRangeKm` per range-managed car. Populate explicitly reviewed specifications, not a blind copy of unused legacy values. Zero/unknown never means unlimited or fully charged. |
| Winter degradation | Per-car `winterReductionPercent` in `[0, 100)`, with explicit season/date policy and version. Fleet default only when explicitly configured and disclosed. |
| Reserve | Configured `reserveKm` and/or percentage policy, applied once, with explicit values and effective dates. |
| Home-charging policy | Configured local-time window, initially approximately 00:00-06:00 in `Europe/Stockholm`, applicable to all cars. Record home/base, policy version and per-car/date exceptions such as away overnight, charger failure or charging disabled. |
| Energy state | `CarEnergyObservation`: car, observation time, remaining usable range in km, odometer anchor, actor/source and quality. Optionally store SOC for future use; SOC requires a documented capacity-to-range conversion. |
| Observation validity | Maximum age, effective season/factor and invalidation rules. An observation beyond the current odometer is inconsistent, not silently usable. |
| Booking eligibility | Explicit active/out-of-service state. Existing free-text error logs/service information are not automatically hard availability rules. |
| Travel origin and destination distance | Configured home/base or explicit origin; existing destination `distance` is round-trip km from its reference base. Use directly, with source and verification time. A different departure base needs a revised total estimate, not doubling. |
| Booking estimate | Snapshot total planned km, source, origin, route kind and estimation policy/version. Later destination edits must not alter historical reservations. |
| Charging-dependent booking | Snapshot charging preference, whether charging is required, acknowledged warning/policy version and any user-declared return-energy commitment. Do not store a planned charge as an actual energy observation. |

Provide admin editing for static car parameters and reviewed destinations, plus
a permission-controlled way to record a fresh range/charge observation at a
known odometer or a home-charging exception. For ordinary mornings, use the
configured home-charging assumption; manual observations are supplemental,
especially for exceptions and charging-dependent trips. No fleet telemetry
exists today. Treat telemetry/map integration as a later adapter, not a launch
dependency.

Use a **policy-based full-charge baseline at the end of an eligible overnight
window**, followed by that day's consumption, as the normal MVP calculation.
Return its source as `assumed_home_charge`, with local date/time and policy
version. An actual energy observation has a distinct source and observation
time; never turn an assumption into a recorded charge event.

Store the active seasonal basis for observations so seasonal adjustment is
applied once. Do not multiply an already winter-adjusted dashboard reading by
the winter factor again. A policy full-charge baseline uses the effective
range for the target date, so future-day bookings do not require today's energy
observation to remain fresh until departure.

Use existing round-trip destination distances directly. Do not ask whether the
user wants to return on every ordinary booking; that is the normal case.
Explicit one-way trips, detours or another origin need an adjusted total.
A future routing provider requires
origin/route intent, bounded HTTPS requests, timeouts, attribution/privacy
review and cached dated estimates. Never send unrelated participant information.
Provider failure produces an explicit unknown-distance issue and manual-input
path, not a fabricated distance or straight-line estimate.

### Conservative projection

Return separate **time availability**, **trip suitability** and **charging
requirement**. A car can be free and suitable with charging, suitable without
charging, or have unknown suitability. Expose projection inputs, source
timestamps, reserved kilometres, remaining margin and uncertainty.

For a consistent observation and season basis:

```text
effectiveFullRangeKm = nominalRangeKm * (1 - winterReductionPercent / 100)
availableAtStartKm =
    baselineRemainingKm
    - actualKmSinceBaseline
    - plannedButNotYetAccountedKmBeforeStart
marginAfterTripKm = availableAtStartKm - requestedTotalKm - reserveKm
```

The baseline is either the latest applicable assumed home charge
(`baselineRemainingKm = effectiveFullRangeKm`) or a later valid observation.
`actualKmSinceBaseline` comes from trips/odometer history attributable to that
energy period. Do not require an odometer reading taken exactly at 06:00.
Each journey is counted once: actual consumption replaces its planned
reservation when logged. An unlogged journey already included in an observation
must not be deducted again; ambiguous overlap between observations, actual
travel and unlogged reservations requires reconciliation. Do not allocate a
trip to an energy period using only its logging timestamp: use its linked
journey interval or explicit occurrence data, and clarify ambiguous unlinked or
cross-boundary trips. A full-capacity estimate is current planning input only
when the home-charging policy applies, not evidence of measured charge.

Project chronologically through bookings, observations and eligible overnight
resets, including other users and intervening dates. Subtract earlier trips
within each energy period; do not accumulate yesterday's consumption after
today's eligible full-charge reset. Evaluate effects on later reservations
until the next independent valid baseline. A same-day trip can affect later
same-day bookings; normally it does not reduce tomorrow's range if the car is
home for the overnight window. For a charging-dependent trip, show any required
return-energy commitment or subsequent-booking impact before that reset for
explicit review. Count multi-day journey distance once and ordinary
recurring occurrences separately. Unknown-distance reservations, missing logs
that prevent sound allocation and stale observations produce explicit unknown
or blocked suitability only where they affect the current energy period, not
across an independent eligible full-charge reset.

### Overnight home charging and exceptions

At approximately 06:00 local time, reset planned available range to the
season-adjusted full range if the car is expected to be home throughout the
configured charging window and no exception contradicts charging. For normal
round-trip bookings, infer home presence from their return/departure times
and the configured base; do not require users to confirm it every morning.
Make this inference and its source visible in results.

An overnight/multi-day trip means the car is away, even if its persisted daily
segments have a midnight boundary. Do not reset on those nights. A booking or
reported actual trip overlapping the charging window, a late return, a departure
before charging completes, a known charger fault or a not-at-home report prevents
the ordinary full-charge assumption for the affected period. Initially require
the full configured window; do not invent partial charging rates for a 03:00
return or treat a 05:00 departure as already fully charged. Use a valid prior/
actual baseline or ask for remaining range when necessary. Partial-charge
modeling can be added later with explicit car/charger data.

A departure at/after the window's end may use the reset; a booking ending
exactly at its start may count as returned. Define these boundaries in local
time and handle DST as a scheduled charging policy, not an assumption of exactly
six elapsed hours. A later low-range observation or charging-failure report
overrides the assumption and invalidates affected previews. Persist unresolved
fault/away exceptions so a later date cannot silently erase them.

During the day, assume **no replenishment**, even when the car is parked at
home between bookings. Actual reported charging or an acknowledged long-trip
charging condition is separate. Do not infer that a long-trip car returns fully
charged or subtract the entire long-trip distance into an impossible negative
post-charge state. Until an observation, explicit conditional estimate or the
next eligible overnight reset, its return energy may remain unknown and affect
later bookings. Overnight policy assumptions remain estimates; warn on known
exceptions without labeling routine policy-based estimates as unavailable.

### Long trips and charging-dependent suitability

The default charging preference is `prefer_no_charging`. Prefer a car that can
complete the round trip with reserve. If none can, recommend an available car
with long effective full-charge range and return `charging_required`, rather
than rejecting the trip solely because total distance exceeds battery range.
An explicit `require_no_charging` excludes these candidates; `allow_charging`
allows them while retaining the warning and acknowledgement.

For charging-dependent candidates, disclose available range at departure,
season-adjusted full-charge range and that charging en route must be arranged.
A partial initial charge is not equivalent to a small battery: compare both
departure range and full-charge range. Prefer greater effective full-charge
range among viable charging-dependent cars, then departure range, configured
order and stable ID. Departure range must be sufficient for any known first
leg; if essential departure information is missing, request it rather than
claiming the trip is feasible.

The MVP does not need an automatic charger itinerary to permit a long-trip
booking. The user acknowledges responsibility for arranging charging; if charger
locations/availability or charging time have not been checked, say so and do not
invent stop counts or promise completion within the booked interval. If a
specific route/first charging stop is supplied, validate known leg distances
against the usable range/reserve. Conflicting known facts remain blockers.
Persist `CHARGING_REQUIRED` and the acknowledgement as domain data, and display
them consistently in web UI, MCP preview and write receipt.

Without telemetry this is a conservative planning estimate, not a guarantee.
A newly observed lower range may invalidate existing plans: flag affected
bookings and notify their users; do not silently cancel or move them.
Return `suitable_without_charging`, `charging_required`, `unknown`, `blocked`,
or explicit `not_applicable` for reviewed vehicle types outside the range policy.
Keep physical margin separate from bookability: a negative no-charge margin
can lead to the supported `charging_required` workflow, not necessarily a
rejection. Automatic recommendation excludes unknown/blocked candidates; a
charging-dependent candidate requires user acknowledgement before commit.
There is no generic `force: true` bypass for hard blockers.

Example acceptance fixture: observed normalized range 180 km, actual use 20 km,
unaccounted prior reservations 30 km, requested return trip 80 km and reserve
20 km gives **30 km margin**. Exactly zero margin is sufficient without charging;
negative margin requires charging unless the user requires no charging.
Also test a 600 km round trip with available cars of 250 km and 400 km effective
full-charge range: when both have viable departure conditions, recommend the
400 km car and allow commit after charging acknowledgement. Include a case
where a new trip consumes later reserved energy: either retain a blocker for
the no-charge command or explicitly preview a charging/return-energy condition,
never silently declare the later reservation unaffected.
Also test a car with 300 km effective full range and 20 km reserve: after an
eligible overnight window, an earlier same-day 80 km round trip leaves a
150 km round trip with 50 km margin. No daytime top-up is assumed. The next
eligible morning starts at 300 km again, not 220 km. A night away or known
charging failure must prevent that reset.

Recommend cars deterministically among eligible candidates: no overlap, active
status, adequate seats if passenger count is part of the supported contract,
the no-charge/charging-dependent ranking above, then configured car order and
stable ID. Do not claim
seat suitability from today's schema, which has no seat count. Return reasons
and rejected alternatives. A recommendation is rechecked at commit.

## 9. Correct interpretation of final odometer digits

Move `handleOdometerChange` out of `register-trip.tsx` into the trip service.
Accept final digits as a **string** to preserve leading zeros and distinguish
them from a full reading. The initial contract is integer kilometres, matching
the current app; document it in every relevant schema.

Given latest reading `O`, `n` digits interpreted as `s` and `m = 10^n`, the
smallest strictly increasing candidate is:

```text
C = floor(O / m) * m + s
if C <= O: C = C + m
distance = C - O
```

Do not blindly accept that candidate. Final digits can represent multiple
rollovers; equal digits can also mean zero travel. Compare with the booking,
elapsed context, permitted limits and outstanding logs, and ask for the full
reading when the interpretation is ambiguous or implausible. No hidden
assumption that a positive trip or exactly one rollover occurred. With no
reliable baseline, require a full reading and an explicit initialization/
correction workflow; never default the old odometer to zero.

Example fixtures:

- Baseline 12,320, suffix `"45"` -> candidate 12,345, distance 25 km.
- Baseline 12,398, suffix `"05"` -> candidate 12,405, distance 7 km.
- Baseline ending `"45"`, suffix `"45"` -> clarify, not automatic 100 km.
- An existing long booking may imply more than one rollover; request the full
  reading rather than forcing the smallest candidate.

Preserve the existing positive-distance and maximum-distance policy initially
(the UI currently uses 9,999 km), documenting whether that limit is inclusive.
Evaluate long/deviating distance warnings on the server. Fetch the true latest
per-car reading even if the last trip is months old. A changed reading between
preview and commit invalidates the preview; never recompute and silently charge
for a different distance. An unlogged preceding journey may make distance
attribution ambiguous even if suffix expansion is mathematically possible.

For "log final digits 45 on Vita", resolve the car and eligible booking first.
One unambiguous eligible booking may be proposed with its participants. Multiple
candidates, another person's booking, missing comments or uncertain reading
produce the relevant question/confirmation. Unlinked logging is explicit and
does not silently mark an unrelated booking logged.

## 10. End-to-end behavior for the requested scenarios

### Booking a car to Laxa tomorrow, 17:00-20:00

1. Obtain timezone/local date; resolve tomorrow to an absolute date and the
   destination to a stable ID.
2. Use the destination's stored round-trip km directly for the configured base;
   ask only if distance is missing or the user specifies a different origin or
   route. Do not double the distance or routinely ask for return intent.
3. Search the interval across cars using current bookings and range projection.
   Prefer sufficient range without charging. Otherwise recommend a long-range
   available car with a charging-required warning and obtain acknowledgement.
   Show reasons if no viable candidate exists; never shorten the requested trip
   or drop range checks silently.
4. Preview the chosen car, exact interval, distance, participants and warnings.
   Gather only missing data/required consent.
5. Commit with the same preview and idempotency key; return the stored booking
   ID, car, destination and absolute date/time. State estimates as estimates.

### Which cars are available today?

Return today's remaining free intervals in local time, with fully/partially
available labels. Distinguish time availability from unknown route suitability.
No confirmation or destination question is needed just to answer this query.

### Log final digits 45 on Vita

Resolve Vita; load authoritative per-car context and eligible bookings. Expand
the suffix on the server, show old/new odometer, distance, price, participants
and affected booking(s). Ask for a full reading or booking choice if necessary.
After required confirmation, commit atomically and report the stored trip ID,
full reading, charged amount and bookings marked logged.

## 11. Implementation order and deliverables

| Phase | Work and completion condition |
|---|---|
| 0. Contracts and compatibility | Select target clients; verify SDK/protocol/auth support. Encode confirmed round-trip semantics, overnight home charging approximately 00:00-06:00, no daytime charging by default and long-trip charging support. Agree timezone, departure base, range basis, reserve, consent and actor policies. Add representative fixtures without reading or modifying production data. |
| 1. Shared domain layer | Extract current transactions; add runtime schemas, typed issues and authoritative logging/predecessor queries. Move calculations/mandatory comments/confirmations server-side and wire REST + web. Parity tests pass; intended behavior shifts documented. |
| 2. Data and range | Replace unused `Car.range`; add configuration, home-charging policy/exceptions, optional observations, origins/distance provenance, charging conditions and snapshot/version fields. Extend admin/web flows and serializers. Build and test daily energy periods, overnight resets and charging-dependent recommendations. |
| 3. Safe operations | Persist previews, operations, acknowledgements and audit entries. Add idempotency, concurrency revalidation and receipts. Route all coupled web/admin writers through the same invariants. |
| 4. MCP read-only pilot | Mount protected `/mcp`, metadata and scoped token auth. Deliver context, availability, own bookings and logging context; verify with actual chosen clients and Inspector. Feature flag defaults off. |
| 5. Booking writes | Deliver preview/commit booking with required warnings and range qualification. Verify parity with web and retry behavior before granting write scopes. |
| 6. Trip writes | Deliver preview/commit trip logging, suffix clarification, price and multi-day/recurring link semantics. Verify old-baseline, own/other-user and race cases. |
| 7. Controlled release | Enable per-user/client scopes for a pilot, monitor domain outcomes, document configuration/client setup and expand only after acceptance criteria pass. |
| Later | Atomic series edits/swaps, explicit cancellation/correction tools, telemetry, routing and optional home-page chat. No frontend orchestration copied into MCP. |

Schema changes use reviewed Prisma migrations with additive/backward-compatible
deployment first, nullable new fields and data verification before enforcement.
Do not copy unused `range` values blindly; populate the new specifications
explicitly. Preserve existing round-trip destination values unchanged. Replace
all `range` references in frontend rules/types/admin forms, API contracts,
serializers, seeds/importers and tests; retain a temporary compatibility field
only if the deployment sequence actually requires it, then drop the old column.
Ensure old clients/importers cannot overwrite new semantics unnoticed. Run migrations as
the existing controlled deployment action; no auto-seed/reset or remote restart
is part of this plan. Rollback disables MCP writes without damaging web access,
domain data, energy observations or durable receipts.

Update `README.md`, `.env.example`, relevant deployment documentation and
`AGENTS.md` as implementation lands. Document client registration, scopes,
protocol matrix, privacy/retention, observation maintenance, warning codes and
timeout recovery. Keep reverse-proxy/Authelia configuration in the infra repo.
No new secrets or provider credentials in documentation or Git.

## 12. Validation and acceptance criteria

Use the existing backend Jest/Supertest and frontend Vitest/MSW infrastructure.
Add service unit tests, isolated PostgreSQL integration tests for locking/
idempotency and MCP contract tests using the chosen released SDK. No new test
framework is required. Use an isolated test database, not a shared deployed DB.

| Area | Required cases |
|---|---|
| Input/contracts | Missing, malformed and ambiguous fields; invalid users; leading zeros; invalid calendars; fractional/out-of-bounds minutes; unsupported compound operation; schema-valid results for every status. |
| Time | Today/tomorrow at local midnight; backend/agent different timezones; DST gap/overlap; boundary-adjacent bookings; end-of-day `1440`; partial versus whole-day availability. |
| Warnings | Own versus other-user predecessor; logged/own immediate predecessor not skipped; previous date older than UI window; predecessor not ended yet; own missed logs remain separate; required comments; every acknowledgement invalidated when context changes. |
| Booking/range | Two simultaneous clients choose the same slot; web competes with MCP; destination round-trip km never doubled; deterministic no-charge-first recommendation; long-trip fallback prefers long-range car and commits with charging acknowledgement; explicit no-charge request rejects insufficient range; ordinary 06:00 full-charge baseline without mandatory observation; same-day consumption/no daytime top-up; next-day reset; no reset while away overnight, late return, early departure or known charger fault; 00:00/06:00 and DST boundaries; observation overrides assumption; future-day projection; logged travel allocated by occurrence, not logging time; winter basis not applied twice; reserve boundary; prior/later reservations and conditional return energy; missing distances; no assumed fully charged long-trip return; full multi-day distance counted once; `Car.range` replacement updates all references. |
| Odometer/price | Months-old baseline; suffix rollover and equal suffix; multiple possible readings; full reading; no baseline; bounds; booking deviation boundaries; over-500-km warning; price rounding/rate snapshot; intervening write invalidates preview. |
| Trip linkage | Another user's booking requires confirmation; ordinary recurrence logs one; multi-day logs all once; unknown legacy kind blocks; already logged rejects; corrections/deletions leave coherent links and projections. |
| Reliability | Same key concurrent retries; same key/different payload; different key/consumed preview; process restart; lost HTTP response after commit; operation lookup access isolation; SSE failure after commit; no partial booking/trip state. |
| Authorization | Expired/wrong-audience/ID tokens; insufficient scopes; revoked/deactivated identity; cross-user preview/receipt access; forged actor/admin fields; invalid Origin; bearer auth independent of browser cookie; browser paths unchanged. |
| MCP compatibility | Selected revision and actual client matrix; capability-gated elicitation plus fallback; decline/cancel; protocol/business error distinction; structured/text agreement; no protocol-session identity leakage. |
| UI parity | Web shows server issues and acknowledgements, uses server distance/cost, updates from MCP writes via existing SSE and can recover by ordinary REST reload. No old write route bypasses shared safety checks. |

All three requested scenarios must work end-to-end using ordinary MCP tools,
including clarification variants, not just manually prepared complete inputs.
Every successful write returns a durable, precise receipt. Every blocked action
explains what is missing or conflicting and how to proceed. Neither malformed
nor incomplete input may create a booking, temporary destination, trip or
confirmation as a side effect.

Record minimal operational metrics: tool latency, domain outcome/issue codes,
stale previews, idempotent retries and range-data age. Audit actor/client/action,
affected IDs, approved warnings and operation ID. Redact tokens and avoid
logging free-text comments, full conversation payloads or unrelated personal
data. Set retention/access rules for previews, audit and receipts.

## 13. Decisions to settle before enabling writes

These do not prevent planning or a read-only implementation, but must become
documented policies rather than LLM guesses:

- Which MCP hosts/clients and protocol revisions must be supported at launch,
  and which authorization-server setup actually issues suitable resource tokens?
- What is the configured departure base for the confirmed round-trip destination
  distances, and which reviewed specifications populate the replacement for
  unused `Car.range`?
- How are home presence and charging exceptions recorded, and who can supply
  optional energy observations? What exact configurable overnight boundaries,
  winter, reserve and fallback policies apply for exceptional periods?
  How are return-energy commitments and subsequent-booking impacts presented
  for charging-dependent trips before the next eligible overnight reset?
- How should host consent/delegation work for an ordinary unambiguous request,
  and is app-side authenticated approval required for higher-risk operations?
- Which existing cross-user editing/logging actions remain allowed, what
  confirmations are mandatory, and what are the currency/rounding rules?

Recommended initial defaults: private/read-only pilot; existing local authority
preserved; assumed full charge after an eligible home window approximately
00:00-06:00, no daytime replenishment by default, optional verified observations
and explicit charging exceptions; reviewed total-trip distances;
existing destination distances used as round-trip km without doubling;
prefer no charging, otherwise recommend a long-range car with explicit charging
acknowledgement; unknown/blocked departure suitability excluded from automatic
recommendation; policy-based overnight charge labeled as an assumption rather
than a measured event, no other unobserved charge treated as fact and no generic blocker
override; explicit preview and required-warning approval before writes.
Numerical reserve/season/age settings require fleet-specific agreement.

## 14. Primary references

Official sources consulted on 2026-10-16. Recheck SDK/client support when starting
implementation; do not treat examples for different revisions as interchangeable.

- [MCP specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Tools, schemas, results and input-required behavior](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Streamable HTTP and revision compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP authorization and resource-server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Elicitation and supported input modes](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
- [Official SDKs](https://modelcontextprotocol.io/docs/2026-07-28/sdk)
- [Related local Firebase beta-sync plan](2026-10-16-firebase-beta-sync.md)
