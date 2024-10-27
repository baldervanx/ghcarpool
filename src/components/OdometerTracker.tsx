import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  getDocs, 
  orderBy, 
  where,
  addDoc,
  serverTimestamp,
  doc,
  limit
} from 'firebase/firestore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const firebaseConfig = {
  apiKey: "AIzaSyDTquDT5hvgxOSutHhbdWRLi5TKshiE_yw",
  authDomain: "ghcarpool-f49f9.firebaseapp.com",
  projectId: "ghcarpool-f49f9",
  storageBucket: "ghcarpool-f49f9.appspot.com",
  messagingSenderId: "1005598472656",
  appId: "1:1005598472656:web:c42cf217a2ff84948661d5",
  measurementId: "G-3N16KHM59M"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const MAX_DIST = 999;
const COST_PER_KM = 2.5; // FIXME: Fetch from DB.

const OdometerTracker = () => {
  const [user, setUser] = useState(null);
  const [isMember, setIsMember] = useState(false); 
  const [cars, setCars] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCar, setSelectedCar] = useState('');  
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [lastOdometer, setLastOdometer] = useState('');
  const [tripDistance, setTripDistance] = useState('');
  const [cost, setCost] = useState('');
  const [newOdometer, setNewOdometer] = useState('');
  const [editOdometer, setEditOdometer] = useState('');
  const [comment, setComment] = useState('');
  
  useEffect(() => {
    // Lyssna på auth-status
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Kontrollera medlemskap när användaren loggar in
        const userDoc = await getUserDocByEmail(user.email);
        const isMember = userDoc != null;
        setIsMember(isMember);
        if (isMember) {
          await fetchData();          
          setSelectedUsers([userDoc.id]); // Förvälj användaren
          setUser({user_id: userDoc.id, ...user});
        }
      }      
    });
    return () => unsubscribe();
  }, []);

  const getUserDocByEmail = async (email) => {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email));
    const snapshot = await getDocs(q);
    return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  };

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const fetchData = async () => {
    // Hämta bilar
    const carsSnapshot = await getDocs(collection(db, 'cars'));
    const carsData = carsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    setCars(carsData);

    // Hämta användare
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const usersData = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    setUsers(usersData);
  };

  const fetchLastOdometer = async (carId) => {
    const tripsRef = collection(db, 'trips');
    const carRef = doc(db, 'cars', carId);
    const q = query(
      tripsRef,
      where('car', '==', carRef),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
    
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const lastTrip = snapshot.docs[0].data();
      setLastOdometer(lastTrip.odo.toString());
      setNewOdometer(lastTrip.odo.toString());
    } else {
      alert('Bilen saknar logg, ny bil?');
      setLastOdometer('0');
      setNewOdometer('0');
    }
  };

  const handleCarChange = (carId) => {
    setSelectedCar(carId);
    fetchLastOdometer(carId);
  };

  const handleOdometerChange = (value) => {
    setEditOdometer(value);
    let newOdometer = lastOdometer;
    if (value.length > 0) {
      let prefix = lastOdometer.slice(0, -value.length);
      newOdometer = prefix + value;
      if (newOdometer < lastOdometer) {
          newOdometer = (parseInt(prefix) + 1).toString() + value;
      }
    }
    let dist = newOdometer - lastOdometer;
    if (dist <= 0 || dist > MAX_DIST) dist = '';
    setTripDistance(dist);
    setCost(dist != '' ? (dist*COST_PER_KM).toFixed(2) + " kr" : '');
    setNewOdometer(newOdometer);
  }

  const handleUserToggle = (userId) => {
    setSelectedUsers(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  const handleSubmit = async () => {
    if (!selectedCar || selectedUsers.length === 0 || !newOdometer) {
      alert('Vänligen fyll i alla fält');
      return;
    }

    try {
      const carRef = doc(db, 'cars', selectedCar);
      const userRefs = selectedUsers.map((u) => doc(db, 'users', u));
      const byUser = doc(db, 'users', user.user_id);
      await addDoc(collection(db, 'trips'), {
        car: carRef,
        users: userRefs,
        odo: Number(newOdometer),
        distance: tripDistance,
        cost: cost,
        timestamp: serverTimestamp(),
        comment: comment,
        byUser: byUser
      });
      
      alert('Resa sparad!');
      handleOdometerChange('');
      fetchLastOdometer(selectedCar);
    } catch (error) {
      console.error('Error saving trip:', error);
      alert('Ett fel uppstod när resan skulle sparas');
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Button onClick={signIn}>
          Logga in med Google
        </Button>
      </div>
    );
  }

  // Visa meddelande om användaren inte är medlem
  if (!isMember) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">Åtkomst nekad</h2>
          <p>Du är inte medlem i denna bilpool.</p>
          <p>Kontakta administratören för att få tillgång.</p>
          <Button 
            onClick={() => signOut(auth)} 
            className="mt-4"
          >
            Logga ut
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <Card className="max-w-md mx-auto p-6 space-y-4">
      <div className="space-y-2">
        <Label>Välj bil</Label>
        <Select value={selectedCar} onValueChange={handleCarChange}>
          <SelectTrigger>
            <SelectValue placeholder="Välj en bil" />
          </SelectTrigger>
          <SelectContent>
            {cars.map(car => (
              <SelectItem key={car.id} value={car.id}>
                {car.make} {car.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Välj användare</Label>
        <div className="flex flex-wrap gap-2 p-2 border rounded">
          {users.map(user => (
            <Button
              key={user.id}
              variant={selectedUsers.includes(user.id) ? "default" : "outline"}
              size="sm"
              onClick={() => handleUserToggle(user.id)}
            >
              {user.id}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Senaste mätarställning</Label>
        <Input
          type="number"
          value={lastOdometer}
          disabled
        />
      </div>

      <div className="flex gap-4">
        <div className="space-y-2 flex-1">
          <Label>Ny mätarställning</Label>
          <Input
            type="number"
            value={newOdometer}
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label>Sista siffror</Label>
          <Input
            min="0"
            max="999"
            type="number"
            value={editOdometer}
            onChange={(e) => {
              const value = e.target.value;
              if (value.length <= 3 && parseInt(value) <= 999) {
                handleOdometerChange(value);
              }
            }}
          />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="space-y-2 flex-1">
          <Label>Sträcka</Label>
          <Input
            type="number"
            value={tripDistance}
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label>Kostnad</Label>
          <Input
            value={cost}
            disabled
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Kommentar</Label>
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <Button 
        className="w-full" 
        onClick={handleSubmit}
        disabled={!selectedCar || selectedUsers.length === 0 || !newOdometer || tripDistance <= 0}
      >
        Spara resa
      </Button>
    </Card>
  );
};

export default OdometerTracker;
