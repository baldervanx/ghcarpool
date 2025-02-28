// pages/RegisterTrip.jsx

import React, { useState, useEffect } from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { db } from '@/db/firebase';
import {collection, doc, addDoc, updateDoc, serverTimestamp, runTransaction} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { CarSelector } from '@/components/CarSelector';
import UserSelector from '@/components/UserSelector';
import { setSelectedUsers, setSelectedCar } from '@/store';
import type { AppStore } from '@/store';
import { isOnline } from '@/lib/utils';

const MAX_DIST = 9999;
let COST_PER_KM = 1;


export function RegisterTrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { selectedCar } = useSelector((state: AppStore) => state.car);
  const { user } = useSelector((state: AppStore) => state.auth);
  const { selectedUsers, users } = useSelector((state: AppStore) => state.user);
  const { data } = useSelector((state: AppStore) => state.settings);
  const { trips, loading: tripsLoading } = useSelector((state: AppStore) => state.trip);
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnectedBooking, setIsConnectedBooking] = useState(false);
  const [connectedBooking, setConnectedBooking] = useState(null);

  useEffect(() => {
    COST_PER_KM = data.cost_per_km;
    // TODO: This should just be set once when user logs on.
    dispatch(setSelectedUsers([user.user_id]));
  }, [dispatch, users.length, user.user_id]);

  useEffect(() => {
    const handleOnlineStatus = () => {
      if (!isOnline()) {
        setErrorMessage('Du är offline. Aktivera nätverk för att logga.');
        setIsProcessing(true);
      } else {
        setErrorMessage(null);
        setIsProcessing(false);
      }
    };
    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);

    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (location.state && location.state.booking) {
       const booking = location.state.booking;
       setIsConnectedBooking(true);
       setConnectedBooking(booking);
       dispatch(setSelectedCar(booking.car.id));
       dispatch(setSelectedUsers(booking.users.map(u => u.id)));
    }
  }, [location.state]);

  useEffect(() => {
    setErrorMessage('');
    if (selectedCar) {
      const relevantTrips = trips.filter(trip => trip.car.id === selectedCar);
      if (relevantTrips.length > 0) {
        const [latestTrip, prevTrip] = relevantTrips;
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
        setErrorMessage('Kan inte hämta senaste mätarställning för vald bil.');
        setLastOdometer('');
        resetAllFields('');
      }
    }
  }, [selectedCar, trips]);

  const resetAllFields = (lastOdo) => {
    setEditOdometer('');
    setTripDistance('');
    setCost('');
    setNewOdometer(lastOdo);
    setComment(connectedBooking?.destination || '');
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

  function distanceSimilarToBooking() {
    if (!isConnectedBooking || !connectedBooking) return true;

    return (connectedBooking.distance - 5 < tripDistance) && (connectedBooking.distance + 5 > tripDistance);
  }

  const handleSubmit = async () => {
    if (!selectedCar || selectedUsers.length === 0 || !newOdometer) {
      setErrorMessage('Vänligen fyll i alla fält');
      return;
    }

    const selUserObjs = getSelectedUserObjects();
    const userCommentMandatory = selUserObjs.find(user => user.commentMandatory === true);
    if (comment === "" && userCommentMandatory) {
      setErrorMessage('Kommentar krävs för ' + userCommentMandatory.shortName);
      return;
    }

    if (!distanceSimilarToBooking()) {
      setErrorMessage('Angiven sträcka skiljer sig från bokningen ' + connectedBooking.distance);
      return; // TODO: This should be made to a soft validation - confirmation dialog?
    }

    if (isProcessing) return;

    try {
      setIsProcessing(true);

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

      let tripRef;
      if (isEditMode && lastTrip) {
        tripRef = doc(db, 'trips', lastTrip.id);
        await updateDoc(tripRef, {
          ...tripData,
          editedAt: serverTimestamp()
        });
      } else {
        console.log('Submitting trip:', tripData);
        tripRef = await addDoc(collection(db, 'trips'), {
          ...tripData,
          timestamp: serverTimestamp()
        });
      }

      if (isConnectedBooking && connectedBooking) {
        // Fetch booking and update it with the trip reference
        const dateCarDocRef = doc(db, 'date-car-bookings', connectedBooking.parent_id);
        return await runTransaction(db, async (transaction) => {
          const dateBookingsDoc = await transaction.get(dateCarDocRef);
          if (dateBookingsDoc.exists()) {
            const existingBookings = dateBookingsDoc.data().bookings;
            const updatedBookings =
                existingBookings.map(b => b.id === connectedBooking.id ? {...b, logged: tripRef} : b);
            transaction.update(dateCarDocRef, {bookings: updatedBookings});
          }
        });
      }
      navigate('/trip-log');
    } catch (error) {
      console.error('Error saving trip:', error);
      setErrorMessage('Ett fel uppstod när resan skulle sparas');
    } finally {
      setIsProcessing(false);
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
        <CarSelector disabled={isProcessing} />
        {/* Behöver markera inmatad text som röd, eller helst inte tillåta textinmatning alls.
            Ser ut som att värdet accepteras. */}
        <UserSelector disabled={isProcessing} />

        {lastTrip && canEdit && (
            <div className="flex items-center space-x-2">
              <Checkbox
                  id="edit-mode"
                  checked={isEditMode}
                  onCheckedChange={handleEditModeChange}
                  disabled={isProcessing}
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
                placeholder={tripsLoading ? 'Laddar ...' : ''}
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
                disabled={isProcessing || tripsLoading}
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
              disabled={isProcessing}
          />
        </div>

        {connectedBooking && (
            <div className="flex items-center space-x-2">
              <Checkbox
                  id="connected-booking"
                  checked={isConnectedBooking}
                  onCheckedChange={(state) => {
                    if (state !== 'indeterminate') {
                      setIsConnectedBooking(state);
                    }
                  }}
                  disabled={isProcessing}
              />
              <Label htmlFor="connected-booking" className="text-sm">
                {`För bokning`}
              </Label>
            </div>
        )}

        {/* FIXME: Använd Alert istället? */}
        {errorMessage && (
            <div className="text-red-500">
              {errorMessage}
            </div>
        )}

        {/* FIXME: Bör vara enabled så att användaren får feedback på felaktig inmatning. Fast inte om "isProcessing".
            Måste se till att errorMessage nollställs när felet korrigeras. */}
        <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={
                isProcessing || !selectedCar || selectedUsers.length === 0 || !newOdometer || tripDistance <= 0
            }
        >
          {isProcessing && isOnline() ? 'Sparar ...' : (isEditMode ? 'Uppdatera resa' : 'Spara resa')}
        </Button>
      </Card>
  );
}
