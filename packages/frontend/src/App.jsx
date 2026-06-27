// App.jsx
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Provider } from 'react-redux';
import store, { fetchAuthState } from './store';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { RegisterTrip } from './pages/register-trip';
import { TripLog } from './pages/TripLog';
import BookTrip from './pages/book-trip';
import BookingOverview from './pages/booking-overview';
import ErrorLog from './pages/error-log';
import Expenses from './pages/expenses';
import CarInfoPage from './pages/car-info';

import { AccessibilityProvider } from './lib/utils';
import { ThemeProvider } from './components/theme-context';
import { HomePage } from './pages/home';
import PropTypes from "prop-types";
import {useListenToTrips} from "@/db/use-listen-to-trips";
import {useListenToBookings} from "@/db/use-listen-to-bookings";

function App() {
  console.log('App rendering');
  useListenToTrips();
  useListenToBookings();
  const dispatch = useDispatch();
  const authState = useSelector(state => state.auth);

  useEffect(() => {
    dispatch(fetchAuthState());
  }, [dispatch]);

  if (authState.loading) {
    return <div className="flex items-center justify-center min-h-screen">Laddar...</div>;
  }

  return (
      <Router>
        {authState.user && authState.isMember && <Navbar />}
        <div className="container mx-auto px-2 py-2">
          <Routes>
            <Route
                path="/login"
                element={authState.user && authState.isMember ? <Navigate to="/home" replace /> : <Login />}
            />
            <Route
                path="/home"
                element={<ProtectedRoute><HomePage /></ProtectedRoute>}
            />
            <Route
                path="/book-trip"
                element={<ProtectedRoute><BookTrip /></ProtectedRoute>}
            />
            <Route
                path="/booking-overview"
                element={<ProtectedRoute><BookingOverview /></ProtectedRoute>}
            />
            <Route
                path="/register-trip"
                element={<ProtectedRoute><RegisterTrip /></ProtectedRoute>}
            />
            <Route
                path="/trip-log"
                element={<ProtectedRoute><TripLog /></ProtectedRoute>}
            />
            <Route
                path="/error-log"
                element={<ProtectedRoute><ErrorLog /></ProtectedRoute>}
            />
            <Route
                path="/expenses"
                element={<ProtectedRoute><Expenses /></ProtectedRoute>}
            />
            <Route
                path="/car-info"
                element={<ProtectedRoute><CarInfoPage /></ProtectedRoute>}
            />
            <Route
                path="*"
                element={<Navigate to="/home" replace />}
            />
          </Routes>
        </div>
      </Router>
  );
}

function ProtectedRoute({ children }) {
  const { user, isMember } = useSelector(state => state.auth);

  if (!user || !isMember) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default function RootApp() {
  return (
      <Provider store={store}>
        <AccessibilityProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </AccessibilityProvider>
      </Provider>
  );
}
