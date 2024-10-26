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
  doc
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

const OdometerTracker = () => {
  const [user, setUser] = useState(null);
  const [cars, setCars] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedCar, setSelectedCar] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [lastOdometer, setLastOdometer] = useState('');
  const [newOdometer, setNewOdometer] = useState('');
  
  useEffect(() => {
    // Lyssna på auth-status
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) {
        fetchData();
      }
    });
    return () => unsubscribe();
  }, []);

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
      orderBy('timestamp', 'desc')
      //limit(1)
    );
    
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const lastTrip = snapshot.docs[0].data();
      setLastOdometer(lastTrip.odo.toString());
      setNewOdometer(lastTrip.odo.toString());
    } else {
      setLastOdometer('0');
      setNewOdometer('0');
    }
  };

  const handleCarChange = (carId) => {
    setSelectedCar(carId);
    fetchLastOdometer(carId);
  };

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
      await addDoc(collection(db, 'trips'), {
        car: carRef,
        users: userRefs,
        odo: Number(newOdometer),
        timestamp: serverTimestamp()
      });
      
      alert('Resa sparad!');
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
              {user.name}
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

      <div className="space-y-2">
        <Label>Ny mätarställning</Label>
        <Input
          type="number"
          value={newOdometer}
          onChange={(e) => setNewOdometer(e.target.value)}
        />
      </div>

      <Button 
        className="w-full" 
        onClick={handleSubmit}
        disabled={!selectedCar || selectedUsers.length === 0 || !newOdometer}
      >
        Spara resa
      </Button>
    </Card>
  );
};

export default OdometerTracker;
