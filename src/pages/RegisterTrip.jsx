import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import React, { useState, useEffect } from 'react';
import { db } from '../utils/firebase';
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
import { useCar } from '../App';
import { useAuth } from '../App';


const MAX_DIST = 999;
const COST_PER_KM = 2.5; // FIXME: Fetch from DB.

export function RegisterTrip() {

  const { selectedCar } = useCar();
  const { user, isMember } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [lastOdometer, setLastOdometer] = useState('');
  const [tripDistance, setTripDistance] = useState('');
  const [cost, setCost] = useState('');
  const [newOdometer, setNewOdometer] = useState('');
  const [editOdometer, setEditOdometer] = useState('');
  const [comment, setComment] = useState('');
  
  useEffect(() => {
    const fetchData = async () => {
      // Hämta användare
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const usersData = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(usersData);
      setSelectedUsers([user.user_id]); // Förvälj användaren
    };
    fetchData();
  }, []);



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
    } else {
      alert('Bilen saknar logg, ny bil?');
      setLastOdometer('0');      
    }
    handleOdometerChange('');
    setComment('');    
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
      fetchLastOdometer(selectedCar);
    } catch (error) {
      console.error('Error saving trip:', error);
      alert('Ett fel uppstod när resan skulle sparas');
    }
  };

  return (
    <Card className="max-w-md mx-auto p-6 space-y-4">
      <CarSelector />
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
}