// App.jsx
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Provider } from 'react-redux';
import store, { fetchAuthState, fetchUsers } from './store';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { RegisterTrip } from './pages/register-trip';
import { TripLog } from './pages/TripLog';
import { AccessibilityProvider } from './lib/utils';
import { ThemeProvider } from './components/theme-context';
import { HomePage } from './pages/home';
import PropTypes from "prop-types";

function App() {
  const dispatch = useDispatch();
  const authState = useSelector(state => state.auth);

  useEffect(() => {
    dispatch(fetchUsers());
    dispatch(fetchAuthState());
  }, [dispatch]);

  if (authState.loading) {
    return <div className="flex items-center justify-center min-h-screen">Laddar...</div>;
  }

  return (
      <Router>
        {authState.user && authState.isMember && <Navbar />}
        <div className="container mx-auto px-4 py-4">
          <Routes>
            <Route
                path="/login"
                element={authState.user && authState.isMember ? <Navigate to="/register-trip" replace /> : <Login />}
            />
            <Route
                path="/home"
                element={<ProtectedRoute><HomePage /></ProtectedRoute>}
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
                path="*"
                element={<Navigate to="/register-trip" replace />}
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
