// register-trip.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { db } from '../utils/firebase';
import { collection, query, getDocs, doc, orderBy, where, addDoc, updateDoc, serverTimestamp, limit, getDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import UserSelector from '../components/UserSelector';
import { setSelectedUsers } from '../store';

const MAX_DIST = 9999;
let COST_PER_KM = 1;

export function RegisterTrip() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { selectedCar } = useSelector(state => state.car);
  const { user } = useSelector(state => state.auth);
  const { selectedUsers, users } = useSelector(state => state.user);
  const { data } = useSelector(state => state.settings);
  const [odometerLoading, setOdometerLoading] = useState(false);
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    COST_PER_KM = data.cost_per_km;
    dispatch(setSelectedUsers([user.user_id]));
  }, [dispatch, users.length, user.user_id]);

  useEffect(() => {
    const fetchData = async () => {
      if (selectedCar) {
        await fetchLastTrips(selectedCar);
      }
    };
    fetchData();
  }, [selectedCar]);

  const fetchLastTrips = async (carId) => {
    resetAllFields('');
    setLastOdometer('');
    setOdometerLoading(true);
    // FIXME: May not use cache if offline!
    const tripsRef = collection(db, 'trips');
    const carRef = doc(db, 'cars', carId);
    const q = query(
        tripsRef,
        where('car', '==', carRef),
        orderBy('timestamp', 'desc'),
        limit(2)
    );

    const snapshot = await getDocs(q);
    setOdometerLoading(false);
    if (!snapshot.empty) {
      const trips = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const [latestTrip, prevTrip] = trips;
      setLastTrip(latestTrip);
      setPreviousTrip(prevTrip);

      const canEditTrip = latestTrip.byUser?.id === user.user_id;
      setCanEdit(canEditTrip);

      if (isEditMode && canEditTrip) {
        setLastOdometer(prevTrip ? prevTrip.odo.toString() : '0');
        dispatch(setSelectedUsers(latestTrip.users.map(u => u.id)));
        setNewOdometer(latestTrip.odo.toString());
        setTripDistance(latestTrip.distance);
        setEditOdometer(calculateEditOdometer(latestTrip.odo.toString(), latestTrip.distance.toString()));
        setCost(latestTrip.cost.toFixed(2));
        setComment(latestTrip.comment || '');
      } else {
        setLastOdometer(latestTrip.odo.toString());
        resetAllFields(latestTrip.odo.toString());
      }
    } else {
      alert('Kan inte hämta senaste mätarställning för vald bil.');
      setLastOdometer('');
      setNewOdometer('');
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
    let newOdo: any = lastOdometer;
    if (value.length > 0) {
      let prefix = lastOdometer.slice(0, -value.length);
      newOdo = prefix + value;
      if (newOdo < lastOdometer) {
        newOdo = (parseInt(prefix) + 1).toString() + value;
      }
    }
    let dist: any = newOdo - lastOdometer;
    if (dist <= 0 || dist > MAX_DIST) dist = '';
    setTripDistance(dist);
    setCost(dist !== '' ? (dist * COST_PER_KM).toFixed(2) : '');
    setNewOdometer(newOdo);
  };

  const calculateEditOdometer = (newOdo, dist) => {
    return newOdo.slice(newOdo.length - dist.length);
  };

  const handleEditModeChange = async (checked) => {
    setIsEditMode(checked);
    if (checked && lastTrip && canEdit && previousTrip) {
      setLastOdometer(previousTrip.odo.toString());
      dispatch(setSelectedUsers(lastTrip.users.map(u => u.id)));
      setNewOdometer(lastTrip.odo.toString());
      setTripDistance(lastTrip.distance);
      setEditOdometer(calculateEditOdometer(lastTrip.odo.toString(), lastTrip.distance.toString()));
      setCost(lastTrip.cost.toFixed(2));
      setComment(lastTrip.comment || '');
    } else {
      setLastOdometer(lastTrip?.odo.toString() || '');
      resetAllFields(lastTrip?.odo.toString() || '');
      dispatch(setSelectedUsers([user.user_id]));
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

    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

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

      // FIXME: Must not wait forever when offline.
      if (isEditMode && lastTrip) {
        const tripRef = doc(db, 'trips', lastTrip.id);
        await updateDoc(tripRef, {
          ...tripData,
          editedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'trips'), {
          ...tripData,
          timestamp: serverTimestamp()
        });
      }

      navigate('/trip-log');
    } catch (error) {
      console.error('Error saving trip:', error);
      alert('Ett fel uppstod när resan skulle sparas');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getSelectedUserObjects = () => {
    return users.filter(user =>
        selectedUsers.includes(user.id)
    ).map(user => ({
      ...user,
      commentMandatory: user.commentMandatory ?? false
    }));
  };

  return (
      <Card className="max-w-md mx-auto p-6 space-y-4">
        <CarSelector disabled={isSubmitting} />
        <UserSelector disabled={isSubmitting} />

        {lastTrip && canEdit && (
            <div className="flex items-center space-x-2">
              <Checkbox
                  id="edit-mode"
                  checked={isEditMode}
                  onCheckedChange={handleEditModeChange}
                  disabled={isSubmitting}
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
                placeholder={odometerLoading ? 'Laddar ...' : ''}
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
                disabled={isSubmitting || odometerLoading}
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
                value={Math.round(cost) + ' kr'}
                disabled
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Kommentar</Label>
          <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={isSubmitting}
          />
        </div>

        <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={
                isSubmitting || !selectedCar || selectedUsers.length === 0 || !newOdometer || tripDistance <= 0
            }
        >
          {isSubmitting ? 'Sparar ...' : (isEditMode ? 'Uppdatera resa' : 'Spara resa')}
        </Button>
      </Card>
  );
}
