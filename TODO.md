
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