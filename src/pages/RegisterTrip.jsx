import ThemeSwitcher from '../components/ThemeSwitcher';
import { User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import MultipleSelector from '@/components/ui/multiple-selector';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../utils/firebase';
import {
  collection,
  query,
  getDocs,
  getDoc,
  orderBy,
  where,
  addDoc,
  updateDoc,
  serverTimestamp,
  doc,
  limit
} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useCar } from '../App';
import { useAuth } from '../App';

const MAX_DIST = 9999;
let COST_PER_KM = 1;

export function RegisterTrip() {
  const navigate = useNavigate();
  const { selectedCar } = useCar();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [lastOdometer, setLastOdometer] = useState('');
  const [tripDistance, setTripDistance] = useState('');
  const [cost, setCost] = useState('');
  const [newOdometer, setNewOdometer] = useState('');
  const [editOdometer, setEditOdometer] = useState('');
  const [comment, setComment] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [lastTrip, setLastTrip] = useState(null);
  const [previousTrip, setPreviousTrip] = useState(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const usersData = usersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(usersData);
      setSelectedUsers([user.user_id]);
      const settingsSnap = await getDoc(doc(db, 'settings', 'main'));
      const settings = settingsSnap.data();
      COST_PER_KM = settings.cost_per_km;
    };
    fetchUsers();
  }, []); //Missing deps user.user_id?

  useEffect(() => {
    const fetchData = async () => {
      if (selectedCar) {
        await fetchLastTrips(selectedCar);
      }
    };
    fetchData();
  }, [selectedCar]); //ESLint: "Missing deps fetchLastTrips", why?

  const fetchLastTrips = async (carId) => {
    const tripsRef = collection(db, 'trips');
    const carRef = doc(db, 'cars', carId);
    const q = query(
        tripsRef,
        where('car', '==', carRef),
        orderBy('timestamp', 'desc'),
        limit(2)
    );

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const trips = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const [latestTrip, prevTrip] = trips;
      setLastTrip(latestTrip);
      setPreviousTrip(prevTrip);

      // Check if the user can edit this trip
      const canEditTrip = latestTrip.byUser?.id === user.user_id;
      setCanEdit(canEditTrip);

      if (isEditMode && canEditTrip) {
        // In edit mode, use previous trip's odometer as lastOdometer
        setLastOdometer(prevTrip ? prevTrip.odo.toString() : '0');
        // Load trip data for editing
        setSelectedUsers(latestTrip.users.map(u => u.id));
        setNewOdometer(latestTrip.odo.toString());
        setTripDistance(latestTrip.distance);
        setEditOdometer(calculateEditOdometer())
        setCost(latestTrip.cost.toFixed(2));
        setComment(latestTrip.comment || '');
      } else {
        // In new trip mode, use latest trip's odometer as lastOdometer
        setLastOdometer(latestTrip.odo.toString());
        resetAllFields(latestTrip.odo.toString());
      }
    } else {
      alert('Kan inte hämta senaste mätarställning för vald bil.');
      setLastOdometer('');
      setLastTrip(null);
      setPreviousTrip(null);
      setCanEdit(false);
    }
  };

  const resetAllFields = (lastOdo) => {
    setEditOdometer('');
    setTripDistance('');
    setCost('');
    setNewOdometer(lastOdo);
    setComment('');
  };

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
    setCost(dist !== '' ? (dist * COST_PER_KM).toFixed(2) : '');
    setNewOdometer(newOdo);
  };

  const getSelectedUserObjects = () => {
    return users.filter(user =>
        selectedUsers.includes(user.id)
    ).map(user => ({
      ...user,
      commentMandatory: user.commentMandatory ?? false
    }));
  };

  // Calculate the editOdometer from newOdometer and distance
  const calculateEditOdometer = (newOdo, dist) => {
    return newOdo.slice(newOdo.length - dist.length);
  }

  const handleEditModeChange = async (checked) => {
    setIsEditMode(checked);
    if (checked && lastTrip && canEdit && previousTrip) {
      // Load the last trip data for editing
      setLastOdometer(previousTrip.odo.toString());
      setSelectedUsers(lastTrip.users.map(u => u.id));
      setNewOdometer(lastTrip.odo.toString());
      setTripDistance(lastTrip.distance);
      setEditOdometer(calculateEditOdometer(lastTrip.odo.toString(), lastTrip.distance.toString()))
      setCost(lastTrip.cost.toFixed(2));
      setComment(lastTrip.comment || '');
    } else {
      // Reset to new trip mode
      setLastOdometer(lastTrip?.odo.toString() || '');
      resetAllFields(lastTrip?.odo.toString() || '');
      setSelectedUsers([user.user_id]);
    }
  };

  const handleSubmit = async () => {
    if (!selectedCar || selectedUsers.length === 0 || !newOdometer) {
      alert('Vänligen fyll i alla fält');
      return;
    }

    const selUserObjs = getSelectedUserObjects();
    const userCommentMandatory = selUserObjs.find(user => user.commentMandatory === true);
    if (comment === "" && userCommentMandatory) {
      alert('Kommentar krävs för ' + userCommentMandatory.shortName);
      return;
    }

    try {
      const carRef = doc(db, 'cars', selectedCar);
      const userRefs = selectedUsers.map((u) => doc(db, 'users', u));
      const byUser = doc(db, 'users', user.user_id);

      const tripData = {
        car: carRef,
        users: userRefs,
        odo: Number(newOdometer),
        distance: tripDistance,
        cost: Number(cost),
        comment: comment,
        byUser: byUser
      };

      if (isEditMode && lastTrip) {
        // Update existing trip
        const tripRef = doc(db, 'trips', lastTrip.id);
        await updateDoc(tripRef, {
          ...tripData,
          editedAt: serverTimestamp()
        });
      } else {
        // Add new trip
        await addDoc(collection(db, 'trips'), {
          ...tripData,
          timestamp: serverTimestamp()
        });
      }

      navigate('/trip-log');
    } catch (error) {
      console.error('Error saving trip:', error);
      alert('Ett fel uppstod när resan skulle sparas');
    }
  };

  const userOptions = users.map(user => ({
    value: user.id,
    badgeLabel: `${user.shortName}`,
    label: `${user.name}`
  }));

  const selectedValues = userOptions.filter(option =>
      selectedUsers.includes(option.value)
  );

  const handleSelectionChange = (selectedOptions) => {
    const selectedIds = selectedOptions ? selectedOptions.map(option => option.value) : [];
    setSelectedUsers(selectedIds);
  };

  return (
      <Card className="max-w-md mx-auto p-6 space-y-4">
        <CarSelector />

        <div className="flex items-center gap-2">
          <User size={32} />
          <MultipleSelector
              value={selectedValues}
              onChange={handleSelectionChange}
              options={userOptions}
              maxSelected={3}
              hidePlaceholderWhenSelected={true}
              hideClearAllButton={true}
              placeholder="Välj personer"
          />
        </div>

        {lastTrip && canEdit && (
            <div className="flex items-center space-x-2">
              <Checkbox
                  id="edit-mode"
                  checked={isEditMode}
                  onCheckedChange={handleEditModeChange}
              />
              <Label htmlFor="edit-mode" className="text-sm">
                Redigera din senaste resa
              </Label>
            </div>
        )}

        <div className="flex gap-4">
          <div className="space-y-2 flex-1">
            <Label>Mätarställning</Label>
            <Input
                type="number"
                value={lastOdometer}
                disabled
            />
          </div>
          <div className="space-y-2 flex-1">
            <Label>Ny mätarställning</Label>
            <Input
                type="number"
                value={newOdometer}
                disabled
            />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="space-y-2 flex-1">
            <Label>Sista siffror</Label>
            <Input
                min="0"
                max="9999"
                type="number"
                value={editOdometer}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    resetAllFields(lastOdometer);
                  } else if (parseInt(value) <= 9999) {
                    handleOdometerChange(value);
                  }
                }}
            />
          </div>
          <div className="space-y-2 flex-1">
            <Label>Sträcka</Label>
            <Input
                value={tripDistance + ' km'}
                disabled
            />
          </div>
          <div className="space-y-2 flex-1">
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
          {isEditMode ? 'Uppdatera resa' : 'Spara resa'}
        </Button>

        <ThemeSwitcher />
      </Card>
  );
}
