import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
//import { MultiSelect } from "@/components/MultiSelect"
import Select from 'react-select';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useCar } from '../App';
import { useAuth } from '../App';


const MAX_DIST = 999;
const COST_PER_KM = 2.5; // FIXME: Fetch from DB.

export function RegisterTrip() {

  const navigate = useNavigate();
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
    // Hämta alla användare en gång och cacha dem
    const fetchUsers = async () => {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const usersData = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(usersData);
      setSelectedUsers([user.user_id]); // Förvälj användaren
    };

    fetchUsers();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (selectedCar) {
        fetchLastOdometer(selectedCar);
      }
    };
    fetchData();
  }, [selectedCar]);


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
      alert('Kan inte hämta senaste mätarställning för vald bil.');
      setLastOdometer('');
    }
    resetAllFields();
  };

  const resetAllFields = () => {
    setEditOdometer('');
    setTripDistance('');
    setCost('');
    setNewOdometer('');
    setComment('');    
  }

  const handleOdometerChange = (value) => {
    setEditOdometer(value);
    let newOdo = lastOdometer;
    if (value.length > 0) {
      let prefix = lastOdometer.slice(0, -value.length);
      newOdo = prefix + value;
      if (newOdo < lastOdometer) {
          newOdo = (parseInt(prefix) + 1).toString() + value;
      }
    }
    let dist = newOdo - lastOdometer;
    if (dist <= 0 || dist > MAX_DIST) dist = '';
    setTripDistance(dist);
    setCost(dist != '' ? (dist*COST_PER_KM).toFixed(2) : '');
    setNewOdometer(newOdo);
  }

  const handleSubmit = async () => {
    if (!selectedCar || selectedUsers.length === 0 || !newOdometer) {
      alert('Vänligen fyll i alla fält');
      return;
    }

    try {
      const carRef = doc(db, 'cars', selectedCar);
      const userRefs = selectedUsers.map((u) => doc(db, 'users', u));
      const byUser = doc(db, 'users', user.user_id);
      // First check that nothing changed?
      await addDoc(collection(db, 'trips'), {
        car: carRef,
        users: userRefs,
        odo: Number(newOdometer),
        distance: tripDistance,
        cost: Number(cost),
        timestamp: serverTimestamp(),
        comment: comment,
        byUser: byUser
      });

      navigate('/trip-log');
    } catch (error) {
      console.error('Error saving trip:', error);
      alert('Ett fel uppstod när resan skulle sparas');
    }
  };

  // Konvertera users-arrayen till det format react-select förväntar sig
  const userOptions = users.map(user => ({
    value: user.id,
    label: `${user.name} (${user.id})`  // eller bara user.name om du föredrar
  }));

  const selectedValues = userOptions.filter(option => 
    selectedUsers.includes(option.value)
  );

  const handleSelectionChange = (selectedOptions) => {
    const selectedIds = selectedOptions ? selectedOptions.map(option => option.value) : [];
    setSelectedUsers(selectedIds); 
  };

  const CompactField = ({ label, children }) => (
    <div className="flex items-center gap-2">
      <Label className="w-24">{label}</Label>
      {children}
    </div>
);

  return (
    <Card className="max-w-md mx-auto p-6 space-y-4">
      <CarSelector />
      <CompactField label="Resenärer">
          <Select
            isMulti
            options={userOptions}
            value={selectedValues}
            onChange={handleSelectionChange}
            formatOptionLabel={(option, { context }) => {
              if (context === 'menu') {
                return option.label;
              } else {
                return option.value;
              }
            }}            
            className="w-full"
            classNames={{
                control: (state) => 'border-input bg-background',
                menu: () => 'bg-background',
                option: (state) => state.isFocused ? 'bg-accent' : 'bg-background',
              }}
            placeholder="Välj ..."
          />
      </CompactField>

      <CompactField label="Senaste ODO">
        <Input
          type="number"
          value={lastOdometer}
          disabled
        />
      </CompactField>

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
              if (value === '') {
                resetAllFields();
              } else if (parseInt(value) <= 999) {
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
            value={tripDistance + ' km'}
            disabled
          />
        </div>
        <div className="space-y-2">
          <Label>Kostnad</Label>
          <Input
            value={cost + ' kr'}
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