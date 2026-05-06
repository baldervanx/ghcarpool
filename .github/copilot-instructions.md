# Copilot Instructions for Carpool Webapp

## Build, Test, and Lint Commands

### Development
```bash
# Start dev server (uses Firebase emulator by default)
npm run dev

# Use production Firebase data instead
$env:USE_FIREBASE_EMULATOR="false"
npm run dev

# Start Firebase emulator with data persistence
firebase emulators:start --import ./emulated_database --export-on-exit
```

### Testing
```bash
# Run all tests in watch mode
npm run test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm run test -- src/pages/book-trip.test.tsx

# Run tests matching pattern
npm run test -- --grep "creates a simple booking"
```

### Build & Deploy
```bash
# Build for production
npm run build

# Lint code
npm run lint

# Deploy to preview channel
firebase hosting:channel:deploy <preview_name>

# Deploy to production
firebase deploy
```

## High-Level Architecture

### Data Flow: Firebase → Redux → Components

**Redux Store Structure** (5 slices):
- `auth` - User identity & permissions (uid, email, isAdmin)
- `car` - Vehicle list & selection (cars, selectedCar, lastOdometer)
- `user` - Team members & selection (users, selectedUsers)
- `destination` - Trip destinations
- `booking` - DateCarBooking[] with date lookup map (bookingsByDate)
- `trip` - Logged trip history (sorted by odometer descending)

**Caching Strategy**:
- **Static data** (cars, users, destinations, settings): localStorage with 2-day TTL
  - Returns cached data immediately if available
  - Refreshes in background if stale
  - Helper: `createCachedThunk()` in store.ts
- **Real-time data** (bookings, trips): Firebase onSnapshot listeners
  - Bookings: 3-month rolling window (-15 days to +106 days)
  - Trips: Last 30 days only
  - Incremental updates via `docChanges()` for efficiency

### Key Data Models

#### Booking Types
```typescript
// Base booking - stored in DateCarBooking.bookings[]
Booking {
  id: string
  users: IdObject[]
  startTime: number        // Minutes from midnight (0-1440)
  endTime: number          // Minutes from midnight
  distance: number
  destination: string
  logged?: string          // Trip ID if logged
  byUser: IdObject
  recurrenceId?: string    // Links recurring bookings
  parent_id?: string       // Original booking for recurring edits
  comment?: string
}

// Container grouping bookings by date and car
DateCarBooking {
  id: string
  date: string            // yyyy-MM-dd format
  car: IdObject
  bookings: Booking[]
}
```

**Three booking patterns**:
1. **Single**: One date, one time block
2. **Recurring**: Multiple dates (weekday pattern), same time daily
   - Stored in separate `recurring-bookings` collection
   - Creates DateCarBooking entries for each recurrence
3. **Multi-day**: Continuous date range
   - First day: user-defined start → 24:00
   - Middle days: 00:00 → 24:00
   - Last day: 00:00 → user-defined end

#### Trip Logging
```typescript
Trip {
  id: string
  car: IdObject
  byUser: IdObject
  users: IdObject[]
  odo: number           // Odometer reading
  distance: number
  cost: number
  comment: string
  timestamp: Date
}
```

**Link to bookings**: When a trip is logged, `booking.logged` is set to the trip ID, making the booking read-only.

### Page Responsibilities

- **BookingOverview** (`/booking-overview`) - 6-month calendar grid showing all bookings (car × date)
- **BookTrip** (`/book-trip`) - Create/edit bookings with validation (handles single, recurring, multi-day)
- **RegisterTrip** (`/register-trip`) - Log completed trips; auto-links to unlogged bookings for the day
- **TripLog** (`/trip-log`) - View/manage trip history
- **Home** (`/home`) - Dashboard showing today's active bookings

### Real-Time Listeners

Set up in `App.jsx` via custom hooks:
- `useListenToTrips()` - Maintains 30-day trip history
- `useListenToBookings()` - Maintains 3-month booking window

Both use `onSnapshot()` with `docChanges()` for incremental sync to Redux.

## Key Conventions

### Time Representation
All booking times are stored as **integer minutes from midnight (0-1440)**:
- `startTime: 480` = 08:00
- `endTime: 1080` = 18:00
- `1440` = 24:00 (full day marker)

**Conversion utilities** (scattered across components, no central util):
```typescript
// Minutes → HH:MM string
const timeToString = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// HH:MM string → Minutes
const timeToNumber = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
```

### Booking Validation Pattern
- **Overlap detection**: Check `startTime < otherEndTime && endTime > otherStartTime`
- **Transaction safety**: Use Firebase `runTransaction()` for multi-document operations (recurring/multi-day)
- **Smart conflict resolution**: Offers to swap bookings between cars if overlap detected

### Date Handling
- Always use `yyyy-MM-dd` format for date strings
- Use `date-fns` for date manipulation (imported throughout)
- Dates in Swedish locale where displayed to users

### State Selection Pattern
Components typically use multiple Redux slices:
```typescript
const cars = useSelector(state => state.car.cars);
const selectedCar = useSelector(state => state.car.selectedCar);
const bookings = useSelector(state => state.booking.bookings);
const user = useSelector(state => state.auth.user);
```

### Lookup Optimization
The booking slice maintains a lookup map for O(1) date filtering:
```typescript
bookingsByDate: {
  "2024-01-15": [DateCarBooking, DateCarBooking],
  "2024-01-16": [DateCarBooking]
}
```

Access via `findBookingsByDate(date)` or `findDateCarBooking(date, carId)` functions in store.

### Multi-Day Booking Rules
- End-time input does NOT auto-adjust when start-time changes (no temporal relationship between days)
- Deletion must remove ALL date entries and the recurring-booking document
- Edit preserves original creator unless explicitly transferred
- Last entry holds the final end-time and total distance

### Logged Booking Rules
- Bookings with `logged` field set are **read-only** (cannot be edited)
- Displayed with checkmark icon in BookingCell component
- Visual indicator: reduced opacity (70%) and cursor-default

### Component Organization
- **Pages**: `src/pages/` - Route-level components
- **Components**: `src/components/` - Reusable UI components
  - `booking-cell.tsx` - Calendar cell renderer (handles touch gestures)
  - `ui/` - shadcn/ui components
- **Database**: `src/db/` - Firebase config and listener hooks
- **Store**: `src/store.ts` - All Redux logic (single file)

### Testing Patterns
- Tests live alongside source files (e.g., `book-trip.test.tsx`)
- Use Page Object pattern (e.g., `BookTripPage` in `src/test/bookTripPage.tsx`)
- Mock Firebase with `@/test/mocks` utilities
- Wrap renders in `<Provider store={store}><MemoryRouter>...</MemoryRouter></Provider>`

### Swedish Language
UI text is in Swedish:
- "Logga" = Log
- "Kört" = Driven/Completed
- "Boka" = Book
- Error messages and alerts in Swedish

## Firebase Configuration

**Firestore Collections**:
- `users` - User profiles (email, isAdmin, shortName)
- `cars` - Vehicles (name, range, order, hasLog)
- `destinations` - Predefined trip destinations
- `date-car-bookings` - Individual booking entries
- `recurring-bookings` - Metadata for recurring series
- `trips` - Logged trip history
- `settings` - App configuration (cost_per_km, etc.)

**Emulator Ports** (defined in firebase.json):
- Firestore: 9090
- Auth: 9099
- UI: 4000

**Environment Variable**:
- `USE_FIREBASE_EMULATOR` - Set to "false" to use production data

## Common Pitfalls

- **Time arithmetic**: Always work in minutes from midnight, convert at display/input boundaries
- **Multi-day end-time**: Auto-adjustment disabled for multi-day bookings (added check in `updateBookingStartTime()`)
- **Transaction requirements**: Recurring and multi-day bookings MUST use transactions to ensure atomicity
- **Cache staleness**: Don't bypass cache helpers; they handle stale data refresh automatically
- **Booking lookup**: Use `findDateCarBooking()` instead of filtering bookings array directly
- **Trip sorting**: Trips sorted by odometer DESC, not by timestamp
- **Read-only bookings**: Check both `readOnly` prop AND `booking.logged` status before allowing edits
