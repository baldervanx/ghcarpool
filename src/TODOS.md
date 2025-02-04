
# TODOs 
## General
- [ ] Add unit tests or similar, complexity is starting to get big. Need to cover all scenarios.
- [ ] Fix bugs in initial tests
- [ ] Create test data generator that adds many bookings 
- [ ] Do performance test with > 200 bookings

## Store
- [X] Add the caching functionality, must always return the cached copy first 

## Menu
- [X] Make it scale better, shrink space between items
- [X] Possibly use icon for bookings (calendar symbol)
- [X] Maybe icons for all features - if accepted.

## Book-trip
- [X] IMPORTANT: Must support bookings outside current cache. Or, change current cache to include more data.
      Perhaps add a set of support functions, to transparently fetch data as needed.
- [ ] ... limit how far into the future bookings are allowed
- [ ] Warn when modifying a booking made by someone else.
- [ ] Swap existing bookings between cars
- [ ] Validate overlap - present more details about overlap and better handling of recurring booking
- [ ] Validate driving-range - check previous use and calc remaining range, estimate range depending on weather. Only warning.
- [ ] Ensure validation after update never detect collisions with "itself". 
- [X] Validate recurringEndDate - is set and is after start-date
- [X] It shall not be possible to edit or delete past bookings, only future ones.
- [ ] Use accordion (https:ui.shadcn.com/docs/components/accordion) for the advanced settings?
- [X] Recurring booking should end at and including end-date
- [X] Must fetch all existing bookings for the entire range of dates that is being booked and
      verify that there are no collisions BEFORE starting to book dates.
- [ ] Recurring booking must (optionally) delete all entries including the recurring-booking entry.
- [X] Multi-day booking must delete all entries (including the recurring-booking entry) when deleted. 
- [ ] Updating recurring booking - must be tested - quite complex, might need to limit for now.
- [ ] Lock fields in recurring booking that may not be edited 
- [ ] Allow deletion only of future recurring booking entries.
- [ ] Allow disconnecting a single booking in a recurring booking from the series 
- [X] *Bug*: Multi-day booking end-time and distance is not set correctly when editing, as the last entry must be fetched to see those settings.
- [X] *Bug*: Deleting multi-day booking does not update local cache correctly.
- [ ] Better date selector - that fits with the theme - https:ui.shadcn.com/docs/components/date-picker
- [ ] Better time selector - selecting times quicker with "scroll".
- [ ] Lock fields while waiting - loading/saving.
- [ ] Transactional update - never overwrite external update.
- [ ] Should be possible to use editable combo-box to allow entering custom destination
- [X] Multi-day booking: If selecting some other entry than the first, must locate the first entry.
- // TODO: Should store the recurrenceDoc - for deletion
- // TODO: Fetch all related bookings for the recurrence
- // TODO: Must check if it is OK that some updates fail due to collisions.
- //       But for a multi-day booking ALL bookings MUST succeed.

## Booking-overview
- [X] Font-size of bookings should adjust with accessibility settings.
- [X] Past bookings shall be read-only.
- [X] Maybe: Have yesterday as top row, to easily see which cars was used recently
- [X] Use onSnapshot() to cache at least one page
- [X] Loading state to avoid showing incomplete calendar
- [X] Each page is not showing all dates

## Home
- [X] Add list of current active bookings, 
- [ ] ...including "past" bookings that has not been logged
- [ ] ...make it nice to look at - car name, spacing etc.
- [ ] Have buttons to edit, delete and log the active bookings.
- [X] Move journal export button here, 
- [ ] Make journal export accessible only by admins 
- [ ] Use home page as landing-page
