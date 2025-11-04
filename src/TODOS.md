
# TODOs 

## Bugs in release
- [X] Does not jump properly to Log after having logged from home-page.
- [ ] Date incorrect format on "Boka" tab - use react-datepicker? Format "DD MMM"?
- [ ] Switching bookings where one booking is recurring, does not work (should "unlock" automatically)
- [ ] Destination creation feature misunderstood, can it be simplified? 
- [ ] Scrolling on booking overview not working fully, when touching bookings - can use header for scrolling
-      make the scroll-bars always visible?
- [X] The logging-of-booking feature need to be completed, connect also from logging page and describe booking properly
-     Logging of multi-day should mark all entries as logged.
- [X] Home page showing "Logga" on multi-day booking, before end-date
- [X] Multi-day booking: should be possible to adjust end-date, change comment
- [X] Multi-day booking: Slut-tid ska visas efter slut-datum
- [X] When validating distance of logging, must be soft validation - it happens that you drive longer than you booked.
- [ ] When updating a booking that someone else created, it should not switch "ownership"
- [ ] Should always be able to change a booking where one of the users are the one editing it, even if it is created by someone else
- [X] Titles in export shall be semicolon separated
- [X] Updating multi-day booking has multiple issues: comments, start/end-times loaded/set incorrectly, distance lost, 
      changing end-time collides with itself
- [ ] Make it possible to do limited updates of recurring bookings
- [ ] Should load more booking history when going back

## General
- [ ] Add unit tests or similar, complexity is quite high. Need to cover all scenarios.
- [ ] ... Fix bugs in initial tests
- [ ] Create test data generator that adds many bookings 
- [ ] Do performance test with > 200 bookings
- [ ] Add cleanup of old trip and booking entries, possibly with some archiving logic.
- [ ] Maybe: Remove selectedCar and selectedUsers from store - should use location.state to transfer state between pages instead
- [X] *IMPORTANT* *BUG* Logga ut + logga in - alla bokningar har tripplerats. Försvinner vid omladdning. Vad händer?
- [ ] Show offline status in all pages - trigger a refresh when getting online
- [X] Align "loading" view across the pages - use animated version
- [X] Use TypeScript version of store.js.
- [X] *IMPORTANT* Trailers do not have a log -> should not show up for logging in Home or Register-trip.

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
- [ ] *IMPORTANT* *ONGOING* Connect with booking, find the closest matching booking - alternatively use the one coming as argument
- [X] ... Add destination as a default comment
- [ ] ... Soft-validate that the distance is approximately what was booked
- [ ] ... *BUG* Not showing details about which booking the log is made
- [ ] ... *BUG* Not navigating to Log after logging a booking
- [ ] Move the alert-functionality to a component, supporting different life-times of the alerts, 
-     ... connect to monitor that checks if the source-value changes?
-     ... use this alert component in both book-trip and register-trip
- [ ] *IMPORTANT* Ensure to always find the last trips for the car, even if it hasn't been used for a long time.


## Book-trip
- [X] IMPORTANT: Must support bookings outside current cache. Or, change current cache to include more data.
      Perhaps add a set of support functions, to transparently fetch data as needed.
- [X] ... limit how far into the future bookings are allowed
- [X] ... *BUG* bookings on last page not showing up.
- [X] Warn with pop-up confirmation when modifying a booking made by someone else. 
- [X] ...Also have an alert message from the very beginning of modification
- [ ] ...Also send message to the original creator using Slack: https://api.slack.com/methods/chat.postMessage
- [X] *IMPORTANT* Swap existing bookings between cars
- [X] ...Also have an alert message when swapping someone else's booking
- [X] *BUG* Changing car/date produces duplicate entry
- [X] Validate overlap - present more details about overlap and better handling of recurring booking
- [ ] Validate driving-range - check previous use and calc remaining range, estimate range depending on weather. Only warning.
- [X] *NB* Ensure validation of multi-day booking after update never report collisions with "itself". 
- [X] Validate recurringEndDate - is set and is after start-date
- [X] It shall not be possible to edit or delete past bookings, only future ones.
- [ ] Use accordion (https:ui.shadcn.com/docs/components/accordion) for the advanced settings?
- [X] Recurring booking should end at and including end-date
- [X] *BUG* Recurring booking was made on the wrong days, off by one
- [X] Must fetch all existing bookings for the entire range of dates that is being booked and
      verify that there are no collisions BEFORE starting to book dates.
- [X] Multi-day booking must delete all entries (including the recurring-booking entry) when deleted. 
- [ ] Updating recurring booking - must be tested - quite complex, might need to limit for now.
-     ... for now, only allow deletion - will have to create a new booking with right values.
-     ... should allow some limited changes, e.g. extending end-date. Could simplify it by having a change 
          become a delete + new booking action. But requires validation first.
- [X] Lock fields in recurring booking that may not be edited 
- [X] Allow deletion only of future recurring booking entries.
- [X] Allow deletion of single recurring booking
- [X] Allow disconnecting a single booking in a recurring booking from the series - by unchecking the recurring-checkbox and this way unlocking the edit functionality
- [X] *Bug*: Multi-day booking end-time and distance is not set correctly when editing, as the last entry must be fetched to see those settings.
- [X] *Bug*: Deleting multi-day booking does not update local cache correctly.
- [ ] Better date selector - that fits with the theme - https:ui.shadcn.com/docs/components/date-picker
-     ... maybe quite OK as it is?
- [ ] Better time selector - selecting times quicker with "scroll".
- [X] Lock fields while waiting - loading/saving.
- [ ] Transactional update - never overwrite external update.
- [X] Use editable combo-box to allow entering custom destination
- [X] Destination "Other" should be available and selected as default, which allow anonymous destination. 
- [X] Multi-day booking: If selecting some other entry than the first, must locate the first entry.
- [ ] *IMPORTANT* Confirmation when deleting all recurring bookings
- [X] *IMPORTANT* Support booking trailer 
- [X] *IMPORTANT* Only require distance for electric cars, not for trailer or volvo. Use "range" setting.
- [X] *IMPORTANT* Comment - e.g. for broken car etc. 
- [ ] When comment is set - allow user to be not set.
- [X] When start-time is selected the end-time should be set to the next hour, 
      unless already higher than start-time

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
- [X] ... and should be shown as logged with a check-box
- [X] Recurring bookings should be shown as such with a round arrow
- [X] *IMPORTANT* Sort car-columns on priority
- [X] *IMPORTANT* Scroll on table, not page. Ensure buttons always visible.
- [X] *IMPROVEMENT* Remove pagning or use paging on month basis instead.
- [ ] Only have previous month if current day is in the beginning of the month.
-     Load in 2-3 weeks of history - can be stored in cache.
-     Extend timespan of bookings to match the 5 month of pages
- [ ] Zoom-feature, to get a better overview - store in settings
- [ ] Allow pure comment bookings - no user and no time/full day.

## Home
- [X] Add list of current active bookings, 
- [ ] ...including yesterday's bookings that has not been logged
- [X] ...showing booking logging status
- [ ] ...support multi-day better, showing the entire trip and not showing log-button unless it is the last day.
- [X] ...make it nice to look at - car name, spacing etc.
- [X] Have buttons to edit, delete and log the active bookings.
- [X] Move journal export button here, 
- [X] *BUG* Export function shall use ";" separator to work properly with comma in cost column.
- [X] Make journal export accessible only by admins 
- [X] Use home page as landing-page
- [ ] Clear cache button
- [X] Use accordion for settings, so that it is collapsed by default
