
# TODOs 
## General
- [ ] Add unit tests or similar, complexity is starting to get big. Need to cover all scenarios.

## Store
- [X] Add the caching functionality, must always return the cached copy first 

## Menu
- [X] Make it scale better, shrink space between items
- [X] Possibly use icon for bookings (calendar symbol)
- [X] Maybe icons for all features - if accepted.

## Book-trip
- [ ] Swap existing bookings between cars
- [ ] Validate overlap - present more details about overlap and better handling of recurring booking
- [ ] Validate driving-range - check previous use and calc remaining range, estimate range depending on weather. Only warning.
- [X] Validate recurringEndDate - is set and is after start-date
- [X] It shall not be possible to edit or delete past bookings, only future ones.
- [ ] Use accordion (https:ui.shadcn.com/docs/components/accordion) for the advanced settings?
- [X] Recurring booking should end at and including end-date
- [ ] Must fetch all existing bookings for the entire range of dates that is being booked and
      verify that there are no collisions BEFORE starting to book dates.
- [ ] Recurring booking must (optionally) delete all entries including the recurring-booking entry.
- [ ] Multi-day booking must delete all entries (including the recurring-booking entry) when deleted. 
- [ ] Updating recurring booking - must be tested - quite complex, might need to limit for now.
- [ ] *Bug*: Multi-day booking end-time and distance is not set correctly when editing, as the last entry must be fetched to see those settings.
- [ ] Better date selector - that fits with the theme - https:ui.shadcn.com/docs/components/date-picker
- [ ] Better time selector - selecting times quicker with "scroll".
- [ ] Lock fields while waiting - loading/saving.
- [ ] Transactional update - never overwrite external update.
- [ ] Should be possible to use editable combo-box to allow entering custom destination
- // TODO: Should store the recurrenceDoc - for deletion
- // TODO: Fetch all related bookings for the recurrence
- // TODO: Must check if it is OK that some updates fail due to collisions.
- // For a multi-day booking ALL bookings MUST succeed.

## Booking-overview
- [X] Font-size of bookings should adjust with accessibility settings.
- [X] Past bookings shall be read-only.
- [X] Maybe: Have yesterday as top row, to easily see which cars was used recently
- [X] Use onSnapshot() to cache at least one page
- [X] Loading state to avoid showing incomplete calendar
- [X] Each page is not showing all dates

## Home
- [ ] Add list of current active bookings, including "past" bookings that has not been logged
- [ ] Have buttons to edit, delete and log the active bookings.
- [X] Move journal export button here, 
- [ ] Make journal export accessible only by admins 
- [ ] Use home page as landing-page
