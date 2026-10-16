
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
1. Previous booking of another user not logged on the same car. The user should be warned that there is an unlogged previous booking on the home page. (working - but warning does not mention which car!)
2. Previous booking of another user not logged on the same car. The user should be warned that there is an unlogged previous booking on the register-trip page. (not working!)
3. There is a past booking of the same user on any car. The user should be warned that there is an unlogged booking on the home page. (working)
4. A multi-day booking is logged. All bookings in the series should be marked as logged. (working)
5. A repeated booking is logged. Only the current booking should be marked as logged. (working)
6. It shall be possible to edit a past booking that hasn't been logged. (not working! - past bookings are read only)
7. It shall be possible to log someone else's booking. (working)
8. When logging someone else's booking (current user is not in the list of users), the user should be warned that they are logging someone else's booking. (not working!)
9. A car is booked several times on the same day. The user should be warned about an unlogged booking _after_ the booking time of the previous booking ended. (not working!)

Ideas for future improvements:
1. Two-way sync with firebase. Only for bookings, recurrences, date-car-bookings and trips.
   Is it possible to trigger sync on "commit" of a booking? Old frontend may need an update to support this. The sync should be triggered on the backend, not on the frontend. 
   Extra help-fields with date/and or checksum may help with this. The sync should be triggered on the backend, not on the frontend.
   Important that the sync is only possible to activate on production environment, not on development environment.
   Errors should be logged on postgres side, and if possible only affect this side. I.e. a collision should mean that firebase-side is left intact, and the user should be warned that the booking was not logged on firebase. The user should be able to retry the sync.
2. Fix current migration: 
   - Only import bookings one year back.
   - serietyp=okänd, means no recurrence found? 
   - Recurrence 'xxxx' has invalid source range/day metadata, seems to be missing "days" field. Could probably just be dropped.
   - More information needed to identify the failing bookings, can't find them based on document id. 
4. Test-mode that can inject test data into the database. This is useful for testing the frontend without having to create test data manually. 
   The test data should be removed after the test is done. The test-mode should be activated by an environment variable, not by a code change.
5. Develop MCP-interface that can be used by an AI agent to book and log trips. A chat-interface could be added to the home page to test it.
   Warnings and similar feedback is even more important in this case.
   
6. Cars should be extended with a range-field that can be used to calculate if a car can be booked for a trip or not. Winter degradation must be another field, as it is less for some cars.