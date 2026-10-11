import React, { useState, useEffect, useMemo } from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
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
import type { AppStore, Booking } from '@/store';
import { isOnline } from '@/lib/utils';
import ConfirmationDialog from "@/components/confirmation-dialog";
import { tripsApi } from '@/api/trips';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { ApiError } from '@/api/client';
import { getLogBookings, getRecentLogBookings, getPrecedingUnloggedBooking } from '@/lib/booking-log';
import { useBookingClock } from '@/lib/use-booking-clock';

const MAX_DIST = 9999;
const LONG_DIST: number = 500;
type ConnectedBooking = Booking & { car: { id: string }; date?: string };
type StoredTrip = AppStore['trip']['trips'][number];

export function RegisterTrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { selectedCar, cars } = useSelector((state: AppStore) => state.car);
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
  const [lastTrip, setLastTrip] = useState<StoredTrip | null>(null);
  const [previousTrip, setPreviousTrip] = useState<StoredTrip | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnectedBooking, setIsConnectedBooking] = useState(false);
  const [connectedBooking, setConnectedBooking] = useState<ConnectedBooking | null>(null);
  const now = useBookingClock();
  const logBookings = useMemo(() => getLogBookings(bookings, cars), [bookings, cars]);
  const selectedCarInfo = cars.find(car => car.id === selectedCar);
  const canLogCar = selectedCarInfo !== undefined && selectedCarInfo.hasLog !== false;
  const explicitBooking: ConnectedBooking | undefined = location.state?.booking;
  const latestExplicitBooking = bookings.flatMap(container => container.bookings)
    .find(booking => booking.id === explicitBooking?.id);
  const selectedBookingLogged = explicitBooking?.car.id === selectedCar &&
    Boolean(explicitBooking.logged || latestExplicitBooking?.logged);
  const unresolvedRecurrence = connectedBooking?.recurrence?.isMultiDay === null ||
    explicitBooking?.car.id === selectedCar &&
      (latestExplicitBooking?.recurrence ?? explicitBooking.recurrence)?.isMultiDay === null;
  const costPerKm = typeof data?.cost_per_km === 'number' ? data.cost_per_km : 1;
  const precedingBooking = connectedBooking?.date
    ? getPrecedingUnloggedBooking(logBookings, { ...connectedBooking, date: connectedBooking.date }, now)
    : undefined;
  const bookingUserNames = connectedBooking?.users.map(member =>
    users.find(candidate => candidate.id === member.id)?.shortName ?? member.id,
  ).join(', ');
  const loggingForOthers = isConnectedBooking && connectedBooking &&
    !connectedBooking.users.some(member => member.id === user?.user_id);
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean; title: string; description: string;
    onConfirm: (() => void) | null; onCancel: (() => void) | null;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: null,
    onCancel: null
  });

  useEffect(() => {
    if (user && !location.state?.booking) dispatch(setSelectedUsers([user.user_id]));
  }, [dispatch, user?.user_id, location.state]);

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
    if (location.state?.booking) {
       const booking: ConnectedBooking = location.state.booking;
       dispatch(setSelectedCar(booking.car.id));
    }
  }, [location.state, dispatch]);

  const clearConnectedBooking = () => {
    setIsConnectedBooking(false);
    setConnectedBooking(null);
  };

  useEffect(() => {
    if (!canLogCar) return clearConnectedBooking();
    const explicit: ConnectedBooking | undefined = location.state?.booking;
    const chosen = explicit?.car.id === selectedCar
      ? logBookings.find(booking => booking.id === explicit.id) ?? explicit
      : getRecentLogBookings(logBookings, now).find(booking =>
        booking.car.id === selectedCar && !booking.logged &&
        (booking.date < format(now, 'yyyy-MM-dd') ||
          booking.startTime <= now.getHours() * 60 + now.getMinutes()),
      );
    if (chosen?.logged) {
      clearConnectedBooking();
      setErrorMessage('Bokningen har redan loggats. Kontrollera körjournalen innan du registrerar en ny resa.');
      return;
    }
    if (chosen) {
      setConnectedBooking(previous => previous === chosen ? previous : chosen);
      setIsConnectedBooking(previous => connectedBooking?.id === chosen.id ? previous : true);
    } else {
      clearConnectedBooking();
    }
  }, [selectedCar, canLogCar, logBookings, location.state, now, connectedBooking?.id]);

  useEffect(() => {
    if (connectedBooking && !isEditMode) {
      dispatch(setSelectedUsers(connectedBooking.users.map(member => member.id)));
      setComment(connectedBooking.destination || '');
    }
  }, [connectedBooking, dispatch, isEditMode]);

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

  const handleOdometerChange = (value: string) => {
    setEditOdometer(value);
    let newOdo = lastOdometer;
    if (value.length > 0) {
      let prefix = lastOdometer.slice(0, -value.length);
      newOdo = prefix + value;
      if (newOdo < lastOdometer && prefix.length > 0) {
        newOdo = (parseInt(prefix) + 1).toString() + value;
      }
    }
    let dist: number = parseInt(newOdo) - parseInt(lastOdometer);
    if (dist <= 0 || dist > MAX_DIST || isNaN(dist)) dist = 0;
    setTripDistance(dist);
    setCost(dist !== 0 ? (dist * costPerKm).toFixed(2) : '');
    setNewOdometer(newOdo);
  };

  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
    const mins = (minutes % 60).toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }

  function connectedBookingLabel(): string {
    const datePart = connectedBooking?.date && connectedBooking.date !== format(new Date(), 'yyyy-MM-dd')
      ? ` (${format(new Date(`${connectedBooking.date}T00:00:00`), 'EEE d MMM', { locale: sv })})`
      : '';
    if (connectedBooking?.endTime === undefined) return `För bokning${datePart}`;
    const endStr = timeToString(connectedBooking.endTime);
    return `För bokning${datePart} med sluttid ${endStr}`;
  }

  const calculateEditOdometer = (newOdo: string, dist: string) => {
    return newOdo.slice(newOdo.length - dist.length);
  };

  const handleEditModeChange = async (checked: boolean) => {
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
    if (unresolvedRecurrence) {
      setErrorMessage('Bokningsseriens typ saknas. Välj återkommande eller flerdagars i bokningen innan resan loggas.');
      return;
    }
    if (selectedBookingLogged) {
      setErrorMessage('Bokningen har redan loggats.');
      return;
    }
    if (!canLogCar) {
      setErrorMessage('Valt fordon saknar körjournal.');
      return;
    }
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

    if (!isEditMode && loggingForOthers && !await showConfirmDialog(
      'Logga någon annans bokning',
      `Du loggar en bokning för ${bookingUserNames}. Kontrollera att rätt användare och resa är valda.`,
    )) return;

    if (!isEditMode && !distanceSimilarToBooking()) {
      if (!await showConfirmDialog('Bekräfta sträcka',
          'Angiven sträcka skiljer sig från bokningens ' + connectedBooking.distance
          + ' är detta förväntat?'))
        return;
    } else if (!isConnectedBooking && tripDistance > LONG_DIST) {
        if (!await showConfirmDialog('Bekräfta lång sträcka',
            'Den angivna sträckan är ovanligt lång (' + tripDistance + ' km). Vill du fortsätta?'))
          return;
    }

    if (isProcessing) return;

    try {
      setIsProcessing(true);

      if (isEditMode && lastTrip) {
        await tripsApi.update(lastTrip.id, {
          userIds: selectedUsers,
          odo: Number(newOdometer),
          distance: tripDistance,
          cost: Number(cost),
          comment,
        });
      } else {
        await tripsApi.create({
          carId: selectedCar,
          userIds: selectedUsers,
          odo: Number(newOdometer),
          distance: tripDistance,
          cost: Number(cost),
          comment,
          bookingId: isConnectedBooking && connectedBooking ? connectedBooking.id : undefined,
          parentId: isConnectedBooking && connectedBooking ? connectedBooking.parent_id : undefined,
        });
      }

      navigate('/trip-log');
    } catch (error) {
      console.error('Error saving trip:', error);
      setErrorMessage(error instanceof ApiError ? error.message : 'Ett fel uppstod när resan skulle sparas');
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

        {unresolvedRecurrence && (
            <Alert variant="destructive">
              <AlertDescription>Bokningsseriens typ saknas. Välj återkommande eller flerdagars i bokningen innan resan loggas.</AlertDescription>
            </Alert>
        )}

        {selectedCar && !canLogCar && (
            <Alert variant="destructive">
              <AlertDescription>Valt fordon saknar körjournal. Välj en bil med körjournal för att registrera en resa.</AlertDescription>
            </Alert>
        )}

        {!isEditMode && precedingBooking && (
            <Alert className="border-yellow-500">
              <AlertTriangle size={16} />
              <AlertDescription>Föregående bokning på {precedingBooking.car.name} har inte loggats. Logga resorna i rätt ordning.</AlertDescription>
            </Alert>
        )}

        {!isEditMode && loggingForOthers && (
            <Alert className="border-yellow-500">
              <AlertTriangle size={16} />
              <AlertDescription>Du loggar någon annans bokning: {bookingUserNames}.</AlertDescription>
            </Alert>
        )}

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
            <Label htmlFor="edit-odometer">Sista siffror</Label>
            <Input
                id="edit-odometer"
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

        {!isEditMode && connectedBooking && (
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

        {!isEditMode && canLogCar && !connectedBooking && (
            <Alert variant="default" className="border-yellow-500">
              <AlertTriangle size={16} />
              <AlertDescription>Ingen ologgad bokning hittades för vald bil. Kontrollera att du loggar rätt resa.</AlertDescription>
            </Alert>
        )}

        {!isEditMode && isConnectedBooking && connectedBooking?.date && connectedBooking.date !== format(now, 'yyyy-MM-dd') && (
            <Alert variant="default" className="border-yellow-500">
              <AlertTriangle size={16} />
              <AlertDescription>Observera: Du loggar en bokning från {format(new Date(`${connectedBooking.date}T00:00:00`), 'EEE d MMM', { locale: sv })}. Kontrollera att detta är korrekt.</AlertDescription>
            </Alert>
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
                isProcessing || !canLogCar || selectedBookingLogged || unresolvedRecurrence || selectedUsers.length === 0 || !newOdometer || tripDistance <= 0
            }
        >
          {isProcessing && isOnline() ? 'Sparar ...' : (isEditMode ? 'Uppdatera resa' : 'Spara resa')}
        </Button>
      </Card>
  );
}
