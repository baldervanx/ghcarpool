
# TODOs 
## General
- [ ] Add unit tests or similar, complexity is starting to get big. Need to cover all scenarios.
- [ ] Fix bugs in initial tests
- [ ] Create test data generator that adds many bookings 
- [ ] Do performance test with > 200 bookings
- [ ] Add cleanup of old trip and booking entries, possibly with some archiving logic.
- [ ] Remove selectedCar and selectedUsers from store - should use location.state to transfer state between pages instead

## Store
- [X] Add the caching functionality, must always return the cached copy first
- [ ] The older log entries (4 entries back) could be cached, as they don't change, reducing the amount of entries to fetch

## Menu
- [X] Make it scale better, shrink space between items
- [X] Possibly use icon for bookings (calendar symbol)
- [X] Maybe icons for all features - if accepted.
- [X] Bigger buttons and icons

## Register-trip
- [ ] Make it possible to edit log entries, other than the last one
-     ... Should only allow limited changes, as it can be assumed that the last entry has correct odo
-     ... Allow inserting another log-line, by splitting one log-line in two entries
-     ... Allow adjusting the odo of one line and with this also changing the next line.
-     ... Show a warning, telling exactly what is being changed so the user can confirm
-     ... Only allow chaning the last few lines, any older shall be read-only
- [ ] *ONGOING* Connect with booking, find the closest matching booking - alternatively use the one coming as argument


## Book-trip
- [X] IMPORTANT: Must support bookings outside current cache. Or, change current cache to include more data.
      Perhaps add a set of support functions, to transparently fetch data as needed.
- [X] ... limit how far into the future bookings are allowed
- [X] ... *BUG* bookings on last page not showing up.
- [X] Warn with pop-up confirmation when modifying a booking made by someone else. 
- [X] ...Also have an alert message from the very beginning of modification
- [ ] ...Also send message to the original creator using Slack: https://api.slack.com/methods/chat.postMessage
- [ ] ONGOING! - Swap existing bookings between cars
- [X] *BUG* Changing car produces duplicate entry
- [X] Validate overlap - present more details about overlap and better handling of recurring booking
- [ ] Validate driving-range - check previous use and calc remaining range, estimate range depending on weather. Only warning.
- [X] *NB* Ensure validation of multi-day booking after update never report collisions with "itself". 
- [X] Validate recurringEndDate - is set and is after start-date
- [X] It shall not be possible to edit or delete past bookings, only future ones.
- [ ] Use accordion (https:ui.shadcn.com/docs/components/accordion) for the advanced settings?
- [X] Recurring booking should end at and including end-date
- [X] Must fetch all existing bookings for the entire range of dates that is being booked and
      verify that there are no collisions BEFORE starting to book dates.
- [ ] Recurring booking must (optionally) delete all _future_ entries including the recurring-booking entry.
- [X] Multi-day booking must delete all entries (including the recurring-booking entry) when deleted. 
- [ ] Updating recurring booking - must be tested - quite complex, might need to limit for now.
-     ... for now, only allow deletion - will have to create a new booking with right values.
- [ ] Lock fields in recurring booking that may not be edited 
- [X] Allow deletion only of future recurring booking entries.
- [ ] Allow disconnecting a single booking in a recurring booking from the series - by unchecking the recurring-checkbox and this way unlocking the edit functionality
- [X] *Bug*: Multi-day booking end-time and distance is not set correctly when editing, as the last entry must be fetched to see those settings.
- [X] *Bug*: Deleting multi-day booking does not update local cache correctly.
- [ ] Better date selector - that fits with the theme - https:ui.shadcn.com/docs/components/date-picker
- [ ] Better time selector - selecting times quicker with "scroll".
- [X] Lock fields while waiting - loading/saving.
- [ ] Transactional update - never overwrite external update.
- [X] Use editable combo-box to allow entering custom destination
- [X] Destination "Other" should be available and selected as default, which allow anonymous destination. 
- [X] Multi-day booking: If selecting some other entry than the first, must locate the first entry.
- // TODO: Should store the recurrenceDoc - for deletion
- // TODO: Fetch all related bookings for the recurrence
- // TODO: Must check if it is OK that some updates fail due to collisions.
- //       But for a multi-day booking ALL bookings MUST succeed.

## Booking-overview
- [X] Font-size of bookings should adjust with accessibility settings.
- [X] *BUG* Past bookings shall be read-only.
- [X] Maybe: Have yesterday as top row, to easily see which cars was used recently
- [X] Use onSnapshot() to cache at least one page
- [X] Loading state to avoid showing incomplete calendar
- [X] Each page is not showing all dates
- [X] Sort bookings for a car/day, by start-time.
- [X] Add buttons to book a free car/day
- [X] ... and add an "Add" button when wanting to book the same car/cay with an additional booking
- [ ] Logged bookings shall not be editable

## Home
- [X] Add list of current active bookings, 
- [ ] ...including "past" bookings that has not been logged
- [X] ...showing booking logging status
- [ ] ...support multi-day better
- [X] ...make it nice to look at - car name, spacing etc.
- [X] Have buttons to edit, delete and log the active bookings.
- [X] Move journal export button here, 
- [ ] Make journal export accessible only by admins 
- [X] Use home page as landing-page
- [ ] Clear cache button
