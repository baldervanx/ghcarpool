
Making ghcarpool ready for production deployment requires a few additional steps.

1. Merging branch feature/log-checking (a single commit) to current branch feature/firebase-to-postgres-migration.
   The log-checking branch is based on the old Firebase backend so the logic has to be adapted to the new Prisma backend.
2. Change container architecture from 3 containers to 2. 
   The current architecture is based on 3 containers: frontend, backend and database. 
   For production deployment, we want to have a single container that runs both the frontend and backend.
   It is probably OK to let Node serve the frontend resources as the number of users is small (< 20).
3. The frontend shall be adapted to sit behind a reverse proxy like Caddy.
4. SSO login support. The plan is to combine Caddy with an SSO provider like Authelia.


Test scenarios:
1. Previous booking of another user not logged on the car booked by current user. Warn on the home page, including when the predecessor is on an earlier date. Do not skip a logged or own immediate predecessor to warn about older bookings. (working!)
2. Previous booking of another user not logged on the car booked by current user. Apply the same predecessor warning on the register-trip page, including across dates. (working!)
3. There is a past booking of the current user on any car. The user should be warned that there is an unlogged booking on the home page. (working!)
4. A multi-day booking is logged. All bookings in the series should be marked as logged. (working!)
5. A repeated booking is logged. Only the current booking should be marked as logged. (working!)
6. It shall be possible to edit a past booking that hasn't been logged. (working!)
7. It shall be possible to log someone else's booking. (working!)
8. When logging someone else's booking (current user is not in the list of users), show "Notera: Du loggar bokning åt <namn>" with a required inline confirmation checkbox instead of an extra ownership popup on save. Reset confirmation when the booking, car, users or logging mode changes. (working!)
9. A car is booked several times on the same day. Warn about another user's unlogged preceding booking only _after_ its booking time ended. Do not show this predecessor warning for an own booking; keep the separate own missed-booking reminder. (working!)
10. Bug: När bokningstiden passerat så dyker en varning upp ovanför bokningen att "Bokning <datum> har inte loggats". Varningen bör dyka upp på själva bokningen som fortfarande syns på hemsidan.
11. Förbättring av test-scenario 1: Låt varningen för "föregående bokning" dyka upp på bokningen, snarare än ovanför den. Detta gör det tydligare för användaren vilken bokning som varningen gäller. Då behöver heller inte bilens namn ingå i varingstexten.

Ideas for future improvements:
1. Two-way sync with firebase. Only for bookings, recurrences, date-car-bookings and trips.
   (Fix påbörjad) Development plan: [.hermes/plans/2026-10-16-firebase-beta-sync.md](.hermes/plans/2026-10-16-firebase-beta-sync.md).
   Is it possible to trigger sync on "commit" of a booking? Old frontend may need an update to support this. The sync should be triggered on the backend, not on the frontend. 
   Extra help-fields with date/and or checksum may help with this. 
   Important that the sync is only possible to activate on production environment, not on development environment (unless it is towards a test-firebase-instance).
   Errors should be logged on postgres side, and if possible only affect this side. I.e. a collision should mean that firebase-side is left intact, and the user should be warned that the booking was not synced to firebase. The user should be able to retry the sync.
2. Fix current migration: 
   - Only import bookings one year back.
   - serietyp=okänd, means no recurrence found? 
   - Recurrence 'xxxx' has invalid source range/day metadata, seems to be missing "days" field. Could probably just be dropped.
   - More information needed to identify the failing bookings, can't find them based on document id. 
4. (Fixat) Test-mode that can inject test data into the database. This is useful for testing the frontend without having to create test data manually. 
   The test data should be removed after the test is done. The test-mode should be activated by an environment variable, not by a code change.
5. Develop MCP-interface that can be used by an AI agent to book and log trips. A chat-interface could be added to the home page to test it.
   (Fix påbörjad) plan: [.hermes/plans/2026-10-16-mcp-booking-and-trip-logging.md](.hermes/plans/2026-10-16-mcp-booking-and-trip-logging.md).
   Warnings and similar feedback is even more important in this case. 
6. Cars should be extended with a range-field that can be used to calculate if a car can be booked for a trip or not. Winter degradation must be another field, as it is less for some cars.
7. Multi-languange support. The frontend should be able to switch between languages. The backend should be able to provide translations for all messages, warnings and errors. Investigate the best way to implement this (translations in file or in database).
8. README should contain more overview of what the application does, its features etc, how to set it up and how to run it. Details should be moved to a separate document. The README should be the first thing a new developer sees when they look at the project. It should contain a high-level overview of the project, its purpose, and how to get started with development.
9. Any swedish text in documentation, code, comments, etc. should be translated to english. This code principle must be documented in AGENTS.md.
10. Om man loggar in med SSO ska "Byt lösenord" inte visas under home. Det ska vara möjligt att stänga av lokal inloggning helt, så att enbart SSO används automatiskt.