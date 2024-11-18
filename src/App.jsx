// App.jsx
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { RegisterTrip } from './pages/RegisterTrip';
import { TripLog } from './pages/TripLog';
import { getUserDocByEmail } from './utils/firebase';
import PropTypes from "prop-types";

// Skapa contexts för global state
export const AuthContext = createContext();
export const CarContext = createContext();

// Custom hook för att använda auth context
export const useAuth = () => useContext(AuthContext);
export const useCar = () => useContext(CarContext);

function App() {
  const [authState, setAuthState] = useState({
    user: null,
    isMember: false,
    loading: true
  });

  const [carState, setCarState] = useState({
    cars: [],
    selectedCar: '',
    lastOdometer: ''
  });

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userDoc = await getUserDocByEmail(user.email);
        const isMember = userDoc != null;
        setAuthState({
          user: { user_id: userDoc?.id, ...user },
          isMember,
          loading: false
        });
      } else {
        setAuthState({
          user: null,
          isMember: false,
          loading: false
        });
      }
    });

    return () => unsubscribe();
  }, []);

  if (authState.loading) {
    return <div className="flex items-center justify-center min-h-screen">Laddar...</div>;
  }

  return (
    <Router>
      <AuthContext.Provider value={{ ...authState, setAuthState }}>
        <CarContext.Provider value={{ ...carState, setCarState }}>
          <div className="min-h-screen bg-background">
            {authState.user && authState.isMember && <Navbar />}
            <div className="container mx-auto px-4 py-4">
              <Routes>
                <Route
                  path="/login"
                  element={
                    authState.user && authState.isMember ?
                      <Navigate to="/register-trip" replace /> :
                      <Login />
                  }
                />
                <Route
                  path="/register-trip"
                  element={
                    <ProtectedRoute>
                      <RegisterTrip />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/trip-log"
                  element={
                    <ProtectedRoute>
                      <TripLog />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="*"
                  element={<Navigate to="/register-trip" replace />}
                />
              </Routes>
            </div>
          </div>
        </CarContext.Provider>
      </AuthContext.Provider>
    </Router>
  );
}

// Skyddad route komponent
function ProtectedRoute({ children }) {
  const { user, isMember } = useAuth();

  if (!user || !isMember) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default App;
