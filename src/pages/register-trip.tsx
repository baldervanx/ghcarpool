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
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import type { AppStore } from '@/store';
import { isOnline } from '@/lib/utils';
import ConfirmationDialog from "@/components/confirmation-dialog";

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
  const { bookings } = useSelector((state: AppStore) => state.booking);
  const { trips, loading: tripsLoading } = useSelector((state: AppStore) => state.trip);
  const [lastOdometer, setLastOdometer] = useState('');
  const [tripDistance, setTripDistance] = useState(0);
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
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: null,
    onCancel: null
  });

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

  const clearConnectedBooking = () => {
    setIsConnectedBooking(false);
    setConnectedBooking(null);
  };

  const setConnectedFromDateBooking = (selectedCarId: string, dateBooking: any) => {
    if (!dateBooking) return clearConnectedBooking();
    const candidates = dateBooking.bookings
        .filter(b => !b.logged)
        .sort((a, b) => (a.endTime ?? 0) - (b.endTime ?? 0));
    if (candidates.length === 0) return clearConnectedBooking();
    const chosen = candidates[0];
    const augmented = { ...chosen, car: { id: selectedCarId }, date: dateBooking.date };
    setIsConnectedBooking(true);
    setConnectedBooking(augmented);
  };

  // If user navigates directly and selects a car, auto-select today's earliest unlogged booking for that car
  useEffect(() => {
    if (location.state && location.state.booking) return; // do not override explicit navigation
    if (!selectedCar) return clearConnectedBooking();

    const today = format(new Date(), 'yyyy-MM-dd');
    const dateBooking = bookings.find(dcb => dcb.car.id === selectedCar && dcb.date === today);
    setConnectedFromDateBooking(selectedCar, dateBooking);
  }, [selectedCar, bookings, location.state]);

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

  const resetAllFields = (lastOdo: string) => {
    setEditOdometer('');
    setTripDistance(0);
    setCost('');
    setNewOdometer(lastOdo);
    setComment(connectedBooking?.destination || '');
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
    let dist: number = parseInt(newOdo) - parseInt(lastOdometer);
    if (dist <= 0 || dist > MAX_DIST) dist = 0;
    setTripDistance(dist);
    setCost(dist !== 0 ? (dist * COST_PER_KM).toFixed(2) : '');
    setNewOdometer(newOdo);
  };

  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
    const mins = (minutes % 60).toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }

  function connectedBookingLabel(): string {
    if (!connectedBooking || connectedBooking.endTime === undefined) return 'För bokning';
    const endStr = timeToString(connectedBooking.endTime);
    return `För bokning med sluttid ${endStr}`;
  }

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
    let distDiff: number = connectedBooking.distance / 5;
    if (distDiff < 2) distDiff = 2;
    return (connectedBooking.distance - distDiff < tripDistance) && (connectedBooking.distance + distDiff > tripDistance);
  }

  const showConfirmDialog = async (title: string, description: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        title,
        description,
        onConfirm: () => {
          setDialogState(prev => ({ ...prev, isOpen: false }));
          resolve(true);
        },
        onCancel: () => {
          setDialogState(prev => ({ ...prev, isOpen: false }));
          resolve(false);
        }
      });
    });
  };

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
      if (!await showConfirmDialog('Bekräfta sträcka',
          'Angiven sträcka skiljer sig från bokningens ' + connectedBooking.distance
          + ' är detta förväntat?'))
        return;
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
        await runTransaction(db, async (transaction) => {
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
        <ConfirmationDialog
            isOpen={dialogState.isOpen}
            title={dialogState.title}
            description={dialogState.description}
            onConfirm={dialogState.onConfirm}
            onCancel={dialogState.onCancel}
        />

        <CarSelector disabled={isProcessing} carFilter={(cars) => cars.filter(c => c.hasLog ?? true)} />
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
                value={Math.round(Number(cost)) + ' kr'}
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
                {connectedBookingLabel()}
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
