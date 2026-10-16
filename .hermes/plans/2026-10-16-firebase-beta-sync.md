# Conservative Firebase two-way sync for the limited beta

**Status:** Proposed development plan; no synchronization implemented.
**Date:** 2026-10-16
**Context:** The PostgreSQL application will initially run as a limited beta.
The existing Firebase application remains available as the fallback application.

## Decisions and safety boundaries

- The new application's backend owns the entire synchronization process.
  Neither frontend communicates with the other database.
- Firebase has precedence when concurrent changes cannot be reconciled safely.
  A conflicting export must make no Firebase writes. Preserve the local proposal
  separately and expose the conflict rather than silently losing either version.
- Start with conservative conflict detection, not automatic field-level merging.
  A conflict can involve different bookings in the same Firebase document.
- Scope: bookings, their date/car containers, recurrence metadata, trips and
  booking/trip links. Authentication, sessions and unrelated features are excluded.
- Users, cars, destinations and relevant settings are dependencies, not implicitly
  synchronized entities. Verify stable identity mappings and compatible values.
  Freeze unsupported shared-reference changes during beta or explicitly extend
  the contract before enabling them. New destinations need a defined compatible
  representation; do not export dangling references.
- This is asynchronous replication, not a distributed transaction or a backup.
  A local save can succeed while Firebase synchronization is pending or blocked.
  Independent backups and a tested restore procedure remain necessary.
- Disable unsupported write operations explicitly in the beta UI and API.
  Do not silently allow changes that the bridge cannot represent safely.

## Existing implementation findings

The assessment used the current migration branch and the legacy code on `master`.
Confirm the deployed legacy revision before implementation.

- `packages/backend/src/routes/bookings.ts` uses PostgreSQL transactions and car
  and recurrence locks. `routes/trips.ts` creates a trip and marks linked bookings
  as logged atomically, including multi-day series.
- `src/lib/sse.ts` and `src/lib/booking-events.ts` publish in-process notifications
  after API writes. They do not observe arbitrary database changes or provide a
  durable synchronization queue.
- `packages/backend/scripts/migrate-from-firestore.ts` provides useful conversion
  examples but is an import script, not a continuous replication mechanism.
  Its upsert behavior is not a complete replacement or deletion protocol.
- Legacy `src/pages/book-trip.tsx` uses Firestore transactions but can choose
  document existence from frontend state and creates date/car documents with
  random IDs. Two clients can create different documents for the same date/car.
- Legacy `src/pages/register-trip.tsx` writes the trip separately from the
  transaction that marks its booking as logged. A listener can see an intermediate
  state or a permanently incomplete operation after failure.
- Firebase stores bookings as an array inside `date-car-bookings`; PostgreSQL
  stores bookings and user links as separate rows. Preserve embedded booking IDs,
  Firestore reference types, timestamps and existing legacy document identities.

## Detecting writes since the relevant read

**Use two distinct concurrency checks. A Firestore transaction alone does not
detect all stale exports.**

1. When accepting a local mutation, retain the last synchronized Firebase
   baseline for every affected document: path, existence, server `updateTime`,
   and canonical business data or its hash. The job must refer to this baseline,
   not obtain a new baseline immediately before export.
2. In a Firestore transaction, read every affected document and required
   coordination/index document before performing any writes.
3. Compare those transaction snapshots with the job's expected baseline.
   A different version or unexpected existence means conflict: abort without
   writes. This catches changes made after the baseline read but before the
   transaction started, even if no listener event has arrived yet.
4. Firestore's transaction concurrency control handles changes to documents read
   during the transaction. If the SDK retries the callback, repeat validation
   against the original expected baseline. Never refresh the expected version
   just to make the retry pass.
5. Only after all checks pass, apply the complete operation and a bridge operation
   receipt atomically. Record the acknowledged remote state in PostgreSQL.

Prefer strict document `updateTime` checks initially: they also detect a document
changed and later restored to identical content. Treat unexpected metadata-only
changes conservatively until a tested rule permits them. A canonical content hash
is useful for comparison, diagnostics and loop suppression, but is not a lock or
a complete replacement for version checks. Application clocks are not versions.

Document absence also needs coordination: a transaction reading one missing
random-ID document cannot detect a competing document created under another ID
for the same date/car. Both writers must use the shared date/car identity protocol
described below.

This protects bridge writes, not arbitrary later legacy writes. Safe concurrent
operation requires the legacy changes below and retirement of outdated clients.

## Backend design

### Durable mutation journal and synchronization state

Introduce PostgreSQL records for:

- An outbox operation: stable operation ID, actor, ordered immutable payload or
  reconstructable version, affected aggregate keys, expected baseline versions,
  status, attempts, next attempt time and diagnostic information.
- Per-document mapping/baseline state, including legacy paths, local identities,
  canonical acknowledged data, remote version and deletion state.
- Applied inbound versions and export receipts for idempotency and recovery.
- Conflicts with baseline, local proposal and current remote data retained for
  explicit resolution. Avoid sensitive payloads in ordinary application logs.

Save the domain mutation and outbox entry in the same PostgreSQL transaction.
Rollback creates neither. Use a shared mutation service rather than duplicating
API validation and locking in a worker. Imported changes must not enqueue an
echo export.

Serialize operations that touch overlapping cars, dates, series or trips.
Support worker leases/recovery and a single active bridge initially. If a second
local mutation arrives before acknowledgement, retain its order and rebase only
over a proven acknowledgement of its own predecessor, never over an external edit.
For the initial beta, blocking further edits on a pending aggregate is an
acceptable simpler policy; choose and test the policy before enabling export.

Do not hold a PostgreSQL transaction or row lock open across a Firebase network
request. Use durable states and brief locking transactions to coordinate inbound
application, pending exports and final acknowledgements. On acknowledgement,
verify the local operation/version so a newer local edit cannot be overwritten.

### Export worker

- Read the durable job, not a potentially newer live database snapshot.
- Convert to the exact legacy representation and validate all dependencies.
- Use the baseline-checked Firestore transaction described above.
- For an existing container, construct the new booking array from the validated
  transaction snapshot, preserving unrelated bookings and unknown legacy fields.
- Atomically group moves, affected recurrence metadata/instances, and trip creation
  with all required booking log links. Apply transaction-size limits explicitly.
  Reject or defer oversized operations; do not split them into silently partial
  operations in the initial beta.
- Store an operation receipt in a separate bridge collection in the same
  transaction. Do not rely on helper fields in documents that legacy writers
  might replace. Transaction callbacks must have no external side effects.
- A Firebase commit may succeed before PostgreSQL acknowledgement fails.
  On retry, a matching durable receipt proves that this operation already
  committed. Acknowledge it without writing again; ingest any subsequent remote
  edits separately. Absence of a receipt is not permission to overwrite a changed
  baseline.
- Retry transient failures with bounded backoff. Conflicts and invalid data require
  explicit handling, not endless retries. Publish state changes to the frontend.

### Import worker and reconciliation

- Run backend-owned Firestore listeners independent of logged-in browser sessions.
  Their date/history scope must cover all enabled beta operations and dependencies,
  not just the current frontend display window.
- Establish an initial baseline and reconcile after startup, reconnect and
  periodically. Listener events are change hints, not the only durable evidence.
  Persist progress, handle duplicate notifications and reject obsolete versions.
  Re-read affected remote state when event ordering is uncertain.
- Coordinate the initial scan/listener handover so writes during startup cannot
  fall between them. Reconciliation must repair missed events after downtime.
- Distinguish document deletion from leaving a filtered query's result set.
  Confirm absence before deleting local data. Persist tombstones/expected absence
  so deleted data cannot be resurrected by delayed jobs.
- Replace synchronized membership accurately, including removed booking/trip
  users, moved bookings and deleted array entries. Do not use additive upserts as
  a substitute for synchronization.
- Apply remote data and baseline updates atomically in PostgreSQL, under shared
  domain locks. If a local proposal is pending, preserve it in a conflict record
  before applying Firebase precedence to the visible domain state.
- Recognize bridge-originated changes using receipts and acknowledged versions.
  Avoid echo writes without ignoring a later genuine legacy edit.
- Load coherent linked state for trips/series before applying it. Patched legacy
  transactions provide atomic writes, but callbacks for multiple documents need
  not arrive together. Re-read and validate the dependency set; explicitly flag
  unresolved/incomplete legacy operations rather than fabricating missing data.
- Publish normal booking/trip SSE updates after import commit. Ensure reconnect
  reload/delta handling and cache invalidation also repair missed updates,
  deletions and moved records; an SSE event alone is insufficient.

## Legacy application changes required before concurrent beta writes

Keep changes small and independently releasable. The old app continues to work
without the new backend.

1. **One document identity per date/car.** Introduce a shared transactionally read
   date/car index pointing to the canonical existing document. Preserve existing
   random-ID paths. Both bridge and legacy writers use this protocol to discover
   or create containers. Inventory existing duplicates and resolve them manually
   before enabling writes; do not silently combine conflicting bookings.
2. **Read authoritative data inside each transaction.** Do not decide document
   absence, collision checks, array contents, source/target moves or series
   membership from Redux state. Read all required documents before writes,
   validate again on callback retries, and coordinate series membership changes
   through a shared series document/version.
3. **Atomic trip logging.** Allocate a stable trip ID once per user operation,
   then create the trip and mark the correct booking(s) logged in one transaction.
   Validate existing log links and car odometer. A normal recurrence logs one
   instance; a multi-day booking logs all relevant instances. Unknown series types
   require explicit resolution, consistent with the new app.
4. **Stable operation identity and retry behavior.** Reuse operation and entity IDs
   across retries. Handle an uncertain previous success without creating a second
   trip or booking. Preserve booking IDs, unrelated array entries, unknown fields,
   and already logged history.
5. **Consistent edits/deletions.** Prevent edits to logged bookings and accidental
   removal of historical series instances. Define trip deletion and unlinking as
   one coherent operation, or disable that operation in both apps during beta.
6. **Outdated clients.** Add a compatibility/version gate enforced by Firestore
   rules or another authoritative write gate, not just a reload banner. Update
   rules and test allowed legacy/bridge writes before rollout. Require reload of
   stale tabs and address cached/service-worker assets if present. Do not permit
   concurrent writes until pre-patch clients can no longer bypass coordination.

The bridge must still detect conflicts; these improvements reduce races but do
not make asynchronous replication globally atomic.

## Environment controls and operations

- Default mode is disabled. Explicit modes: read-only import, shadow export and
  enabled export. Shadow mode computes proposed writes but writes nothing to
  Firebase, including receipts or helper documents.
- Production access requires explicit opt-in and an allowlisted Firebase project
  ID verified against the actual initialized client. `NODE_ENV` alone is not a
  protection. Development uses the emulator or an explicitly allowed test project;
  production credentials/projects must be rejected there.
- Use least-privilege credentials. Read-only phases should have no Firebase write
  permissions. Restrict enabled export to required business and bridge collections.
  Credentials stay server-side and outside Git, images and browser bundles.
- Provide separate import/export kill switches. Pausing export preserves queued
  work and diagnostics; it must not imply that fallback data is current.
- Monitor pending age/count, conflicts, failures, listener health, reconciliation
  results and last confirmed remote state. A single "last synced" timestamp is
  insufficient when individual operations are blocked.

## User experience

- Distinguish local save from remote confirmation: pending, synchronized, failed
  and conflicted. A pending booking is not confirmed in the fallback app.
- Show persistent status in booking/trip views, not only a transient toast.
- Retry a transient failure using the same operation ID. A conflict retry must
  compare/revalidate again and must never mean "force overwrite Firebase".
- Present baseline/local/remote differences and explicit actions: discard the
  local proposal or create a newly validated proposal based on current Firebase.
- Warn beta participants about replication delay and avoid alternating apps for
  the same pending operation. Restrict pilot participants and supported features
  server-side as well as in the UI.

## Delivery phases and acceptance gates

1. **Contract and isolated fixtures.** Inventory the deployed legacy schema and
   revision, identity mappings, duplicate containers, unknown recurrences and
   unsupported data. Define canonical serialization, scopes and reference policy.
   Create representative emulator fixtures; never experiment against production.
2. **Legacy safety release.** Implement and verify the legacy changes, initially
   with the bridge disabled. Establish the date/car index, compatibility gate
   and recovery behavior. Confirm old clients cannot bypass the new protocol.
3. **Read-only bridge.** Implement baseline/import/reconciliation and SSE/cache
   integration. Compare against Firebase without modifying it. Resolve discrepancies
   explicitly; do not reuse the migration script as an ongoing sync loop.
4. **Outbox and shadow export.** Implement export planning, statuses, conflict
   handling and crash recovery against emulator/test Firebase. In production,
   shadow export remains non-writing and cannot treat hypothetical success as a
   real acknowledged Firebase baseline.
5. **Limited beta.** Enable real export for an explicitly selected pilot, first
   simple bookings, then moves/deletes, recurrence and linked trip logging only
   after each operation's acceptance cases pass. Shared Firebase data is real
   production data even though the new UI is a beta.
6. **Expand or roll back.** Expand only after reconciliation remains clean and
   conflicts/failures are understandable and recoverable. On fallback, stop new
   beta writes, pause/drain export under operator control, review every unresolved
   operation, reconcile, and direct users to the old app. Never replay the queue
   blindly after a rollback or database restore.
7. **Retire the bridge.** Execute the lifecycle and removal procedure below.
   Disabling workers is an operational step, not completed feature removal.
   Avoid maintaining active-active replication indefinitely.

## Feature lifecycle and removal

The bridge is temporary migration infrastructure, not a permanent requirement for
booking or trip operations. Include its removal design in the initial implementation.

### Code boundaries and removal inventory

- Keep backend workers, Firestore adapters, baseline comparison, outbox handling,
  receipts, conflict handling and bridge configuration in a dedicated module,
  proposed as `packages/backend/src/sync/firebase-beta/`.
- Keep synchronization-specific frontend status, warnings and fallback actions
  together, proposed as `packages/frontend/src/features/firebase-beta-sync/`.
  Expose them through a small integration surface rather than scattering
  Firebase-specific conditions across booking and trip pages.
- Keep domain validation, car/series locks, serialization needed by the normal
  API, and ordinary SSE publishing independent of Firebase. Both API and import
  code may use shared domain services, but those services must not depend on
  Firestore types or require Firebase credentials.
- Use a narrow, explicitly optional bridge hook for capturing a local mutation
  inside its existing PostgreSQL transaction. Enabled mode must atomically enqueue
  the outbox record; explicitly disabled mode must perform no bridge work.
  Configuration/initialization failures must not silently select disabled mode.
  The hook and its call sites must be removable without redesigning domain logic.
- Clearly name bridge-only tables, API routes, event payloads, environment
  variables and tests. Keep schema relations to core entities minimal; prefer
  bridge-owned references so deleting bridge state cannot cascade into domain
  bookings, trips or users.
- Where separation is impractical, mark the integration point with a concise
  `TEMP(firebase-beta-sync):` comment stating what to remove and what must remain.
  Use comments for these removal boundaries, not for every line in the module.
- Maintain a removal inventory alongside the implementation: actual module paths,
  mutation hooks, schema objects, API/SSE contracts, UI components, dependencies,
  configuration, credentials/permissions, deployment wiring, monitoring, tests and
  legacy-app changes. Each item must identify whether to remove or retain and why.
  Update it whenever a new bridge integration point is added.
- Distinguish bridge-only Firebase dependencies from those used by the existing
  one-time import script. Do not remove the importer, its supported tooling or
  shared conversion helpers merely because the bridge is retired.
- Review legacy changes individually. Retain independent correctness improvements
  such as atomic logging and safe booking writes; retire bridge-only coordination
  only when no supported client or retained tool still depends on it.

### Lifecycle states

Track an explicit operator-controlled progression: disabled, read-only, shadow,
limited beta, cutover, retired and removed. Existing runtime modes cover the
operational stages; do not add unnecessary runtime flags for documentation-only
states. Record the responsible operator and exit evidence for each transition.
Never automatically promote to export or reactivate a retired bridge.

1. **Prepare cutover.** Obtain explicit approval that the new app is ready for
   full use. Resolve every pending/failed/conflicted operation, including uncertain
   remote commits, or record an explicit resolution. Agree an observation/rollback
   window and retention requirements before changing the source of authority.
2. **Final reconciliation.** Temporarily stop user writes in both applications
   using authoritative server/rules gates, including stale legacy clients.
   Allow only the controlled bridge operations needed to settle accepted work.
   Drain jobs, finish import, and verify the scoped domain data and links agree.
   An empty queue alone is not evidence of agreement. Do not continue cutover
   while unexplained differences remain.
3. **Make PostgreSQL authoritative.** While writes are still frozen, stop and
   fence all bridge workers, scheduled reconciliation and queued retries so no
   in-flight or restarted worker can mutate either database later. Permanently
   disable legacy writes and revoke bridge production Firebase access. Then enable
   normal writes only in the new app, without requiring any bridge connection.
   Mark the bridge retired and communicate that the old app is no longer current.
4. **Observe without replication.** Keep only the code/state required for the
   agreed observation period, with workers and credentials disabled. Verify normal
   booking, trip logging and real-time updates operate independently of Firebase.
   Once new-only writes have resumed, switching users back to the old app is not
   a safe rollback: its data is stale. Any rollback needs an explicit data
   reconciliation/restore procedure and approval, never merely a feature toggle.
5. **Remove application integration.** Remove bridge mutation hooks, workers,
   startup wiring, status/fallback UI, endpoints/events, flags, deployment secrets
   and bridge-only dependencies/tests. Keep domain services and useful regression
   tests. Verify normal startup and writes with no bridge credentials or tables.
6. **Remove persistent state separately.** Archive only required audit/conflict
   evidence under the retention policy. After no running or rollback-supported
   release depends on bridge tables, drop them in a separate reviewed migration.
   Never edit previously deployed migrations. Delete Firebase bridge indexes and
   receipts only after confirming no retained client/tool needs them; do not
   delete legacy business data or backups as incidental cleanup.
7. **Close the lifecycle.** Update operational documentation and this plan's
   status, remove obsolete configuration examples and monitoring, confirm access
   revocation, and record retained artifacts and their disposal policy. Completion
   means both operational retirement and removal of obsolete application code.

## Required acceptance scenarios

Use existing Jest/Supertest and frontend test infrastructure plus Firestore
Emulator integration tests. Keep test credentials/projects isolated.

- A legacy edit committed after the baseline read but before export causes a
  conflict and no bridge write to any affected Firebase document.
- A legacy edit during the export transaction triggers contention/retry; comparison
  against the original baseline still prevents overwriting it.
- Two writers creating the first booking for the same date/car produce exactly
  one canonical container; overlapping intervals cannot both be accepted.
- Non-overlapping bookings in one document are preserved. Initial conservative
  policy may report a conflict rather than attempt an unproven merge.
- Moves, recurrence changes, trip creation/logging and permitted deletions either
  complete as a coherent operation or leave Firebase unchanged.
- Multi-day logging marks all required bookings once; normal recurrence logging
  affects only the selected instance. Invalid/unknown metadata is explicit.
- Crash before/after local commit, before/after remote commit, and before/after
  acknowledgement loses no operation and creates no duplicates. Repeated jobs
  and notifications are idempotent.
- Remote success followed by an additional legacy edit and delayed acknowledgement
  neither repeats the export nor overwrites that later edit.
- Pending local changes and inbound edits preserve both versions and show a
  conflict. A newer local mutation is not overwritten by an older acknowledgement.
- Listener disconnect, missed delete, delayed/out-of-order events and initial
  scan races converge through reconciliation without resurrection or echo loops.
- Both UIs, including stale caches and reconnects, eventually show the correct
  bookings, user membership, trip links and synchronization status.
- Wrong project/environment, disabled export and read-only/shadow mode cannot
  modify production Firebase. Outdated legacy clients cannot bypass the write gate.
- The operator can identify every unsynchronized operation, stop export promptly,
  and execute a rehearsed fallback without claiming unsynced beta data is present
  in the old application.
- Cutover gates reject stale-client writes; no stopped/restarted worker or delayed
  retry can apply bridge writes after retirement.
- With the bridge disabled and later removed, the app starts and normal booking,
  recurrence, trip and SSE behavior works without Firebase access. After the
  cleanup migration, those operations also work without bridge tables.
- Removal preserves core domain data, useful regression coverage and the
  independently supported one-time Firestore import workflow.
