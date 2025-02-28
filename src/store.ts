import { configureStore, createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getDoc, getDocs, collection, doc, DocumentData } from 'firebase/firestore';
import { db } from './db/firebase.js';

const CACHE_DURATION = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

interface CachedData<T> {
    data: T;
    isStale: boolean;
    timestamp: number;
}

const getCachedData = <T>(key: string): CachedData<T> | null => {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const age = Date.now() - timestamp;

    return {
        data,
        isStale: age > CACHE_DURATION,
        timestamp
    };
};

const setCachedData = <T>(key: string, data: T): void => {
    localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
    }));
};

const createCachedThunk = <T>(key: string, fetchFunction: () => Promise<T>) => {
    return createAsyncThunk(`${key}/fetch`, async (_, { dispatch }) => {
        const cached = getCachedData<T>(key);

        if (cached) {
            // If cache exists, dispatch it immediately
            dispatch({
                type: `${key}/fetch/fulfilled`,
                payload: cached.data
            });

            // If cache is stale, fetch new data in background
            if (cached.isStale) {
                const freshData = await fetchFunction();
                setCachedData(key, freshData);
                return freshData;
            }

            return cached.data;
        }

        // If no cache exists, fetch and cache the data
        const freshData = await fetchFunction();
        setCachedData(key, freshData);
        return freshData;
    });
};

interface UserDb {
    id: string;
    email: string;
    isAdmin: boolean;
}
// Updated fetch functions using cache
export const fetchUsers = createCachedThunk('user', async () => {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    return usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserDb));
});

export const fetchCars = createCachedThunk('car', async () => {
    const carsSnapshot = await getDocs(collection(db, 'cars'));
    let cars = carsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Car));
    return cars.sort((a,b)=> a.order-b.order);
});

export const fetchDestinations = createCachedThunk('destination', async () => {
    const destsSnapshot = await getDocs(collection(db, 'destinations'));
    return destsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Destination));
});

export const fetchSettings = createCachedThunk('settings', async () => {
    const settingsSnap = await getDoc(doc(db, 'settings', 'main'));
    return settingsSnap.exists() ? settingsSnap.data() : null;
});

// Modified auth state handling with cache awareness
export const fetchAuthState = createAsyncThunk(
    'auth/fetchAuthState',
    async (_, { dispatch }) => {
        return new Promise<void>((resolve) => {
            const auth = getAuth();

            onAuthStateChanged(auth, async (user: User | null) => {
                let authState: AuthState = {
                    user: null,
                    isMember: false,
                    loading: false
                };

                if (user) {
                    // Check if we need to wait for fresh data
                    const needsFreshData = !getCachedData('user') ||
                        !getCachedData('car') ||
                        !getCachedData('settings') ||
                        !getCachedData('destination');

                    // Fetch all required data
                    const users = await dispatch(fetchUsers()).unwrap();

                    // Only wait for these if we need fresh data
                    if (needsFreshData) {
                        await Promise.all([
                            dispatch(fetchCars()),
                            dispatch(fetchSettings()),
                            dispatch(fetchDestinations())
                        ]);
                    } else {
                        // Otherwise fetch in background
                        dispatch(fetchCars());
                        dispatch(fetchSettings());
                        dispatch(fetchDestinations());
                    }

                    const matchedUser = users.find(u => u.email === user.email);
                    if (matchedUser) {
                        authState = {
                            user: {
                                uid: user.uid,
                                email: user.email,
                                user_id: matchedUser.id,
                                isAdmin: matchedUser.isAdmin
                            },
                            isMember: true,
                            loading: false
                        };
                    }
                }
                dispatch(setAuthState(authState));
                resolve();
            });
        });
    }
);

// Auth Slice
interface AuthState {
    user: {
        uid: string;
        email: string;
        user_id: string;
        isAdmin: boolean;
    } | null;
    isMember: boolean;
    loading: boolean;
}

const authSlice = createSlice({
    name: 'auth',
    initialState: {
        user: null,
        isMember: false,
        loading: true
    } as AuthState,
    reducers: {
        setAuthState: (state, action: PayloadAction<AuthState>) => {
            return { ...state, ...action.payload };
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchAuthState.pending, (state) => {
                state.loading = true;
            })
            .addCase(fetchAuthState.fulfilled, (state) => {
                state.loading = false;
            });
    }
});

interface Car {
    id: string;
    name: string;
    range: number;
    order: number;
}

// Car Slice
interface CarState {
    cars: Car[];
    selectedCar: string;
    lastOdometer: string;
}

const carSlice = createSlice({
    name: 'car',
    initialState: {
        cars: [],
        selectedCar: '',
        lastOdometer: ''
    } as CarState,
    reducers: {
        setCarState: (state, action: PayloadAction<Partial<CarState>>) => {
            return { ...state, ...action.payload };
        },
        setSelectedCar: (state, action: PayloadAction<string>) => {
            state.selectedCar = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder.addCase(fetchCars.fulfilled, (state, action) => {
            state.cars = action.payload;
        });
    }
});

interface UserDb {
    id: string;
    email: string;
    isAdmin: boolean;
    commentMandatory?: boolean;
    shortName: string;
}
// User Slice
interface UserState {
    users: UserDb[];
    selectedUsers: string[];
}

const userSlice = createSlice({
    name: 'user',
    initialState: {
        users: [],
        selectedUsers: []
    } as UserState,
    reducers: {
        setUsers: (state, action: PayloadAction<UserDb[]>) => {
            state.users = action.payload;
        },
        setSelectedUsers: (state, action: PayloadAction<string[]>) => {
            state.selectedUsers = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder.addCase(fetchUsers.fulfilled, (state, action) => {
            state.users = action.payload;
        });
    }
});

interface Destination {
    id: string,
    distance?: number,
    name: string,
    shortName: string
}
// Destination Slice
interface DestinationState {
    destinations: Destination[];
}

const destinationSlice = createSlice({
    name: 'destination',
    initialState: {
        destinations: [],
    } as DestinationState,
    reducers: {
        setDestinations: (state, action: PayloadAction<Destination[]>) => {
            state.destinations = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder.addCase(fetchDestinations.fulfilled, (state, action) => {
            state.destinations = action.payload;
        });
    }
});

// Settings Slice
interface SettingsState {
    data: DocumentData | null;
    loading: boolean;
    error: string | null;
}

const settingsSlice = createSlice({
    name: 'settings',
    initialState: {
        data: null,
        loading: false,
        error: null
    } as SettingsState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchSettings.pending, (state) => {
                state.loading = true;
            })
            .addCase(fetchSettings.fulfilled, (state, action) => {
                state.data = action.payload;
                state.loading = false;
            })
            .addCase(fetchSettings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to fetch settings';
            });
    }
});

interface Trip {
    id: IdObject,
    byUser: string,
    car: IdObject,
    comment?: string,
    cost: number,
    distance: number,
    odo: number,
    timestamp: string,
    users: IdObject[]
}

// Trips Slice
interface TripState {
    trips: Trip[];
    loading: boolean;
}

const tripSlice = createSlice({
    name: 'trip',
    initialState: {
        trips: [],
        loading: false,
    } as TripState,
    reducers: {
        setTrips: (state, action: PayloadAction<Trip[]>) => {
            state.trips = action.payload;
        },
        setTripsLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },
        addMultipleTrips: (state, action) => {
            if (state.trips.length > 0) {
                // Do I need to check if any of the added ones already exist?
                state.trips = [...state.trips, ...action.payload].sort((a,b) => b.odo - a.odo);
            } else {
                state.trips = action.payload.sort((a,b) => b.odo - a.odo);
        }
        },
        addOrUpdateTrip: (state, action) => {
            const index = state.trips.findIndex(t => t.id === action.payload.id);
            if (index >= 0) {
                state.trips[index] = action.payload;
            } else {
                // Should typically be coming in at the end anyway
                state.trips = [...state.trips, action.payload].sort((a,b) => b.odo - a.odo);
            }
        },
        removeTrip: (state, action) => {
            state.trips = state.trips.filter(trip => trip.id !== action.payload.id);
}}});

interface IdObject {
    id: string;
}

interface Booking {
    parent_id: string;
    id: string;
    users: IdObject[];
    startTime: number; // Minutes from midnight
    endTime: number; // Minutes from midnight
    distance: number;
    destination: string;
    byUser: IdObject;
    recurrenceId?: string; // For recurring entries
}

interface DateCarBooking {
    id: string;
    date: string;
    car: IdObject;
    bookings: Array<Booking>;
}

// Booking Slice
interface BookingState {
    bookings: DateCarBooking[];
    bookingsByDate: Record<string, DateCarBooking[]>; // Lookup map by date
    loading: boolean;
    range: Record<string, any>;
}

const initialState: BookingState = {
    bookings: [],
    bookingsByDate: {},
    loading: false,
    range: {}
};

const bookingSlice = createSlice({
    name: 'booking',
    initialState,
    reducers: {
        setBookingsRange: (state, action: PayloadAction<Record<string, any>>) => {
            state.range = action.payload;
        },
        setBookings: (state, action: PayloadAction<DateCarBooking[]>) => {
            state.bookings = action.payload;
            // Rebuild the lookup map
            state.bookingsByDate = action.payload.reduce((acc, booking) => {
                if (!acc[booking.date]) acc[booking.date] = [];
                acc[booking.date].push(booking);
                return acc;
            }, {} as Record<string, DateCarBooking[]>);
        },
        setBookingsLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },
        addMultipleBookings: (state, action: PayloadAction<DateCarBooking[]>) => {
            // FIXME: Also update bookingsByDate
            state.bookings = [...state.bookings, ...action.payload];
        },
        addOrUpdateBooking: (state, action: PayloadAction<DateCarBooking>) => {
            const index = state.bookings.findIndex(b => b.id === action.payload.id);
            if (index >= 0) {
                state.bookings[index] = action.payload;
            } else {
                state.bookings.push(action.payload);
            }
            // Update the lookup map
            if (!state.bookingsByDate[action.payload.date]) {
                state.bookingsByDate[action.payload.date] = [];
            }
            const dateIndex = state.bookingsByDate[action.payload.date].findIndex(b => b.id === action.payload.id);
            if (dateIndex >= 0) {
                state.bookingsByDate[action.payload.date][dateIndex] = action.payload;
            } else {
                state.bookingsByDate[action.payload.date].push(action.payload);
            }
        },
        removeBooking: (state, action: PayloadAction<DateCarBooking>) => {
            state.bookings = state.bookings.filter(b => b.id !== action.payload.id);
            // Update the lookup map
            if (state.bookingsByDate[action.payload.date]) {
                state.bookingsByDate[action.payload.date] = state.bookingsByDate[action.payload.date].filter(
                    b => b.id !== action.payload.id
                );
            }
        }
    }
});

// Accessor method to get bookings by date
export const findBookingsByDate = (state: { booking: BookingState }, date: string): DateCarBooking[] => {
    return state.booking.bookingsByDate[date] || [];
};

// Accessor method to get bookings by date and car
export const findDateCarBooking = (state: { booking: BookingState }, date: string, car: string): DateCarBooking => {
    let dateBookings = state.booking.bookingsByDate[date] || [];
    return dateBookings.find(db => db.car.id === car);
};


const store = configureStore({
    reducer: {
        auth: authSlice.reducer,
        car: carSlice.reducer,
        user: userSlice.reducer,
        destination: destinationSlice.reducer,
        settings: settingsSlice.reducer,
        trip: tripSlice.reducer,
        booking: bookingSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredPaths: ['payload.user']
            }
        })
});

export const { setAuthState } = authSlice.actions;
export const { setCarState, setSelectedCar } = carSlice.actions;
export const { setUsers, setSelectedUsers } = userSlice.actions;
export const { setTrips,
    setTripsLoading,
    addMultipleTrips,
    addOrUpdateTrip,
    removeTrip
} = tripSlice.actions;
export const {
    setBookings,
    setBookingsRange,
    setBookingsLoading,
    addMultipleBookings,
    addOrUpdateBooking,
    removeBooking
} = bookingSlice.actions;

export type AppStore = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export default store;
