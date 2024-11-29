import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getDocs, collection, doc, getDoc } from 'firebase/firestore';
import { db } from './utils/firebase';

// TODO: Should save all data to local storage, they should not have to be re-fetched very often.
export const fetchUsers = createAsyncThunk('user/fetchUsers', async () => {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    return usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

// Hämta bilar
export const fetchCars = createAsyncThunk('car/fetchCars', async () => {
    const carsSnapshot = await getDocs(collection(db, 'cars'));
    return carsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

// Hämta inställningar
export const fetchSettings = createAsyncThunk('settings/fetchSettings', async () => {
    const settingsSnap = await getDoc(doc(db, 'settings', 'main'));
    return settingsSnap.exists() ? settingsSnap.data() : null;
});

// Förbättrad autentiseringshantering
export const fetchAuthState = createAsyncThunk(
    'auth/fetchAuthState',
    async (_, { dispatch }) => {
        return new Promise(async (resolve) => {
            const auth = getAuth();

            // Hämta användare, bilar och inställningar parallellt
            const [users, cars, settings] = await Promise.all([
                dispatch(fetchUsers()).unwrap(),
                dispatch(fetchCars()).unwrap(),
                dispatch(fetchSettings()).unwrap()
            ]);

            onAuthStateChanged(auth, async (user) => {
                let authState = {
                    user: null,
                    isMember: false,
                    loading: false
                };
                if (user) {
                    // Hitta användaren i den hämtade användarlistan
                    const matchedUser = users.find(u => u.email === user.email);
                    if (matchedUser) {
                        authState = {
                            user: {
                                uid: user.uid,
                                email: user.email,
                                user_id: matchedUser.id,
                                role: matchedUser.role
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

const store = configureStore({
    reducer: {
        auth: authSlice.reducer,
        car: carSlice.reducer,
        user: userSlice.reducer,
        settings: settingsSlice.reducer
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredPaths: ['payload.user']
            }
        })
});

export const { setAuthState } = authSlice.actions;
export const { setCarState } = carSlice.actions;
export const { setUsers, setSelectedUsers } = userSlice.actions;

export default store;
