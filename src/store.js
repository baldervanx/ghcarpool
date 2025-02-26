import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getDoc, getDocs, collection, doc } from 'firebase/firestore';
import { db } from './db/firebase.js';

const CACHE_DURATION = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

const getCachedData = (key) => {
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

const setCachedData = (key, data) => {
    localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
    }));
};

const createCachedThunk = (key, fetchFunction) => {
    return createAsyncThunk(`${key}/fetch`, async (_, { dispatch }) => {
        const cached = getCachedData(key);

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

// Updated fetch functions using cache
export const fetchUsers = createCachedThunk('user', async () => {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    return usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

export const fetchCars = createCachedThunk('car', async () => {
    const carsSnapshot = await getDocs(collection(db, 'cars'));
    let cars = carsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return cars.sort((a,b)=> a.order-b.order);
});

export const fetchDestinations = createCachedThunk('destination', async () => {
    const destsSnapshot = await getDocs(collection(db, 'destinations'));
    return destsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

export const fetchSettings = createCachedThunk('settings', async () => {
    const settingsSnap = await getDoc(doc(db, 'settings', 'main'));
    return settingsSnap.exists() ? settingsSnap.data() : null;
});

// Modified auth state handling with cache awareness
export const fetchAuthState = createAsyncThunk(
    'auth/fetchAuthState',
    async (_, { dispatch }) => {
        return new Promise((resolve) => {
            const auth = getAuth();

            onAuthStateChanged(auth, async (user) => {
                let authState = {
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
const authSlice = createSlice({
    name: 'auth',
    initialState: {
        user: null,
        isMember: false,
        loading: true
    },
    reducers: {
        setAuthState: (state, action) => {
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

// Car Slice
const carSlice = createSlice({
    name: 'car',
    initialState: {
        cars: [],
        selectedCar: '',
        lastOdometer: ''
    },
    reducers: {
        setCarState: (state, action) => {
            return { ...state, ...action.payload };
        },
        setSelectedCar: (state, action) => {
            state.selectedCar = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder.addCase(fetchCars.fulfilled, (state, action) => {
            state.cars = action.payload;
        });
    }
});

const userSlice = createSlice({
    name: 'user',
    initialState: {
        users: [],
        selectedUsers: []
    },
    reducers: {
        setUsers: (state, action) => {
            state.users = action.payload;
        },
        setSelectedUsers: (state, action) => {
            state.selectedUsers = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder.addCase(fetchUsers.fulfilled, (state, action) => {
            state.users = action.payload;
        });
    }
});

const destinationSlice = createSlice({
    name: 'destination',
    initialState: {
        destinations: [],
    },
    reducers: {
        setDestinations: (state, action) => {
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
const settingsSlice = createSlice({
    name: 'settings',
    initialState: {
        data: null,
        loading: false,
        error: null
    },
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
                state.error = action.error.message;
            });
    }
});

// Trips Slice
const tripSlice = createSlice({
    name: 'trip',
    initialState: {
        trips: [],
        loading: false,
    },
    reducers: {
        setTrips: (state, action) => {
            state.trips = action.payload;
        },
        setTripsLoading: (state, action) => {
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
        }
    }
});

const bookingSlice = createSlice({
    name: 'booking',
    initialState: {
        bookings: [],
        loading: false,
        range: {}
    },
    reducers: {
        setBookingsRange: (state, action) => {
            state.range = action.payload;
        },
        setBookings: (state, action) => {
            state.bookings = action.payload;
        },
        setBookingsLoading: (state, action) => {
            state.loading = action.payload;
        },
        addMultipleBookings: (state, action) => {
            state.bookings = [...state.bookings, ...action.payload];
        },
        addOrUpdateBooking: (state, action) => {
            const index = state.bookings.findIndex(b =>
                b.id === action.payload.id
            );
            if (index >= 0) {
                state.bookings[index] = action.payload;
            } else {
                state.bookings.push(action.payload);
            }
        },
        removeBooking: (state, action) => {
            state.bookings = state.bookings.filter(
                b => b.id !== action.payload.id
            );
        }
    }
});

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

export default store;
