import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {db} from '@/db/firebase';
import {collection, doc, DocumentReference,
  getDoc,
  runTransaction,
  serverTimestamp,
  Transaction
} from 'firebase/firestore';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Checkbox} from '@/components/ui/checkbox';
import { Combobox, ComboboxOptions } from '@/components/ui/combobox';
import {CarSelector} from '@/components/CarSelector';
import {useDispatch, useSelector} from 'react-redux';
import UserSelector from '@/components/UserSelector';
import {setSelectedCar, setSelectedUsers} from '@/store';
import type { AppStore } from '@/store';
import {format, isSameDay} from 'date-fns';
import {Info, OctagonAlert, TriangleAlert} from 'lucide-react';
import ConfirmationDialog from '@/components/confirmation-dialog';
import {TimeSelector} from "@/components/time-selector";


interface DestinationSelectorProps {
  value: string,
  onChange: (destination: string) => void,
  onDistanceChange: (distance: string) => void,
  disabled?: boolean
}
const DestinationSelector = ({value, onChange, onDistanceChange, disabled=false}: DestinationSelectorProps) => {
  const {destinations} = useSelector((state: AppStore) => state.destination);
  const [actualDestinations, setActualDestinations] = useState(destinations);
  const [selectedDestination, setSelectedDestination] = useState('');

  useEffect(() => {
    setSelectedFromName(value || "Annan");
  }, [value]);

  const setSelectedFromName = (name: string) => {
    const destObj = actualDestinations.find(d => d.name === name);
    if (destObj) {
      setSelectedDestination(destObj.id);
    } else {
      // Must here also create the custom destination entry
      setActualDestinations([...actualDestinations, { id: name, name, shortName: "" }]);
      setSelectedDestination(name);
    }
  }

  const handleDestinationChange = (option: ComboboxOptions) => {
    setSelectedDestination(option.value);
    const destination = destinations.find(d => d.id === option.value);
    if (destination) {
      onChange(destination.name);
      // The "Other" destination doesn't have a distance
      onDistanceChange(destination.distance?.toString() || "");
    } else {
      // This is the case when the custom added destination is selected.
      onChange(option.value);
      onDistanceChange("");
    }
  };

  const handleCustomDestinationChange = (label: string) => {
    onChange(label); // This will actually trigger useEffect which in turn will create it.
  };

  return (
      <div className="space-y-2">
        <Label>Destination</Label>
        <Combobox
            options={actualDestinations.map((destination): ComboboxOptions => (
                { value: destination.id, label: `${destination.name} ${destination.shortName ? "("+destination.shortName+")":""}`}
            ))}
            placeholder="Välj destination"
            selected={selectedDestination}
            onChange={handleDestinationChange}
            onCreate={handleCustomDestinationChange}
            disabled={disabled}
        />
      </div>
  );
};

const BookTrip = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const {selectedCar, cars} = useSelector((state: AppStore) => state.car);
  const {user} = useSelector((state: AppStore) => state.auth);
  const {selectedUsers, users} = useSelector((state: AppStore) => state.user);
  const {bookings, range: bookingsRange} = useSelector((state: AppStore) => state.booking);
  const [bookingDate, setBookingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [bookingStartTime, setBookingStartTime] = useState('');
  const [bookingEndTime, setBookingEndTime] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [recurringDays, setRecurringDays] = useState([]);
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [distance, setDistance] = useState('');
  const [destination, setDestination] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [existingBooking, setExistingBooking] = useState(null);
  const [storedDateCarBooking, setStoredDateCarBooking] = useState(null);
  const [recurrenceId, setRecurrenceId] = useState(null);
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: null,
    onCancel: null
  });
  const [isComitting, setIsComitting] = useState(false);

  useEffect(() => {
    if (location.state && location.state.parent_id) {
      const {parent_id, booking_id} = location.state;
      const dateCarBooking = bookings.find(dcb => dcb.id === parent_id);

      if (dateCarBooking) {
        const bookingData = dateCarBooking.bookings.find(b => b.id === booking_id);

        if (bookingData) {
          setExistingBooking(booking_id);
          setStoredDateCarBooking(dateCarBooking);
          setIsEditing(true);
          // Should warn if editing someone else booking
          if (bookingData.byUser.id !== user.user_id) {
            setAlerts([{type: "warn", message: "Du håller på att ändra bokning av " + bookingData.byUser.id}]);
          }
          dispatch(setSelectedCar(dateCarBooking.car.id));
          dispatch(setSelectedUsers(bookingData.users.map(u => u.id)));
          setBookingDate(dateCarBooking.date);
          setBookingStartTime(timeToString(bookingData.startTime));
          setBookingEndTime(timeToString(bookingData.endTime));
          setDistance(bookingData.distance.toString());
          setDestination(bookingData.destination || '');

          // Handle recurrence logic
          if (bookingData.recurrenceId) {
            setRecurrenceId(bookingData.recurrenceId);
            fetchRecurrenceData(bookingData.recurrenceId);
          }
        }
      }
    } else if (location.state && location.state.car) {
      const {car, date} = location.state;
      dispatch(setSelectedCar(car));
      setBookingDate(format(date, 'yyyy-MM-dd'));
      dispatch(setSelectedUsers([user.user_id]));
    } else {
      dispatch(setSelectedUsers([user.user_id]));
    }
  }, [location.state, bookings, user.user_id]);

  const fetchRecurrenceData = async (recurrenceId) => {
    const recurrenceDoc = await getDoc(doc(db, 'recurrence', recurrenceId));
    if (recurrenceDoc.exists()) {
      const recurrenceData = recurrenceDoc.data();
      if (recurrenceData.isMultiDay) {
        setIsMultiDay(true);
        // Find the first booking in the sequence to get start time and distance
        const startDateBooking = bookings.find(b =>
            b.date === recurrenceData.recurringStartDate &&
            b.car.id === selectedCar
        );
        if (startDateBooking) {
          const firstMultiDayBooking = startDateBooking.bookings.find(b => b.recurrenceId === recurrenceId);
          if (firstMultiDayBooking) {
            setBookingDate(recurrenceData.recurringStartDate);
            setBookingStartTime(timeToString(firstMultiDayBooking.startTime));
          }
        }
        // Find the last booking in the sequence to get end time and distance
        const endDateBooking = bookings.find(b =>
            b.date === recurrenceData.recurringEndDate &&
            b.car.id === selectedCar
        );
        if (endDateBooking) {
          const lastMultiDayBooking = endDateBooking.bookings.find(b => b.recurrenceId === recurrenceId);
          if (lastMultiDayBooking) {
            setBookingEndTime(timeToString(lastMultiDayBooking.endTime));
            setDistance(lastMultiDayBooking.distance.toString());
          }
        }
      } else {
        setIsRecurring(true);
        setRecurringDays(recurrenceData.recurringDays);
      }
      setRecurringEndDate(recurrenceData.recurringEndDate);
    }
  };

  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0') + ':' + mins.toString().padStart(2, '0')}`;
  }

  function timeToNumber(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  interface BookingTimes {
    startTime: number;
    endTime: number;
  }

  function findOverlappingBooking(bookings, newBooking: BookingTimes, existingBookingId?: string, recurrenceId?: string) {
    // Filter out any old version of the booking, add the new one and sort.
    const sortedBookings = [...bookings]
        .filter(b => b.id !== existingBookingId && b.recurrenceId !== recurrenceId)
        .concat(newBooking)
        .sort((a, b) => a.startTime - b.startTime);

    // It may also happen that the new booking completely overlaps (i.e starts before and ends after) another booking
    // then this should be pointed out in the message.
    // TODO: Must also detect if the newBooking overlaps with multiple bookings
    // - store the result in a variable, continue looping through all bookings, then the multiple scenario is found.
    for (let i = 1; i < sortedBookings.length; i++) {
      if (sortedBookings[i].startTime < sortedBookings[i - 1].endTime) {
        if (sortedBookings[i] === newBooking) {
          // Start-time of newBooking overlaps with end time of existing booking
          return {booking: sortedBookings[i - 1], type: "startTime"};
        } else {
          // End-time of newBooking overlaps with start time of an existing booking
          return {booking: sortedBookings[i], type: "endTime"};
        }
      }
    }
    // If variable contain multiple results, return {type: "multiple"}
    return {};
  }

  function checkBookingOverlapping(bookings, newBooking: BookingTimes, existingBookingId, recurrenceId, date = null) {
    const {booking, type} = findOverlappingBooking(bookings, newBooking, existingBookingId, recurrenceId);
    if (!type) return;
    if (type === "startTime") {
      throw new Error(`${date ? date + ": " : ""}Vald starttid krockar med bokning som slutar ${timeToString(booking.endTime)}`);
    } else {
      throw new Error(`${date ? date + ": " : ""}Vald sluttid krockar med bokning som börjar ${timeToString(booking.startTime)}`);
    }
  }

  const createOrUpdateBookings = async () => {
    if (!isRecurring && !isMultiDay) {
      return await createSingleBooking(bookingStartTime, bookingEndTime, distance);
    }

    try {
      // Collect all dates that need booking before starting transaction
      const start = new Date(bookingDate);
      const end = new Date(recurringEndDate);
      const currentDate = new Date(start);
      const bookingValidations = [];

      while (currentDate <= end) {
        if (isMultiDay || recurringDays.includes(currentDate.getDay())) {
          let startTime = bookingStartTime;
          let endTime = bookingEndTime;
          let dist = distance;

          if (isMultiDay) {
            if (isSameDay(currentDate, start)) {
              endTime = "24:00";
              dist = '';
            } else if (isSameDay(currentDate, end)) {
              startTime = "00:00";
              endTime = bookingEndTime;
              dist = distance;
            } else {
              startTime = "00:00";
              endTime = "24:00";
              dist = '';
            }
          }

          const dateStr = format(currentDate, 'yyyy-MM-dd');
          const dateBookings = bookings.find(b =>
              b.car.id === selectedCar && b.date === dateStr
          );

          bookingValidations.push({
            date: dateStr,
            startTime,
            endTime,
            distance: dist,
            docRef: dateBookings ? doc(db, 'date-car-bookings', dateBookings.id) : null,
          });
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return await runTransaction(db, async (transaction) => {
        // Check all dates for conflicts within the transaction
        for (const validation of bookingValidations) {
          if (validation.docRef) {
            const dateBookingsDoc = await transaction.get(validation.docRef);
            if (dateBookingsDoc.exists()) {
              const bookingsFromDb = dateBookingsDoc.data().bookings;
              validation.bookings = bookingsFromDb;
              const newBooking = {
                startTime: timeToNumber(validation.startTime),
                endTime: timeToNumber(validation.endTime)
              };

              checkBookingOverlapping(bookingsFromDb, newBooking, existingBooking, recurrenceId, validation.date);
            }
          }
        }

        // If we get here, all validations passed. Create the recurrence document
        const recurrenceRef = doc(collection(db, 'recurrence'));
        transaction.set(recurrenceRef, {
          isMultiDay,
          recurringDays,
          recurringStartDate: bookingDate,
          recurringEndDate,
          createdAt: serverTimestamp()
        });

        // Create or update all bookings
        for (const bookingData of bookingValidations) {
          const newBooking = {
            id: existingBooking || doc(collection(db, 'date-car-bookings')).id,
            users: selectedUsers.map(u => doc(db, 'users', u)),
            startTime: timeToNumber(bookingData.startTime),
            endTime: timeToNumber(bookingData.endTime),
            distance: Number(bookingData.distance),
            destination,
            byUser: doc(db, 'users', user.user_id),
            recurrenceId: recurrenceRef.id
          };

          if (bookingData.bookings) {
            const existingBookings = bookingData.bookings;

            const updatedBookings = existingBooking
                ? existingBookings.map(b => b.id === existingBooking ? newBooking : b)
                : [...existingBookings, newBooking];

            transaction.update(bookingData.docRef, {bookings: updatedBookings});
          } else {
            const newDateBookingRef = doc(collection(db, 'date-car-bookings'));
            const carRef = doc(db, 'cars', selectedCar);
            transaction.set(newDateBookingRef, {
              date: bookingData.date,
              car: carRef,
              bookings: [newBooking]
            });
          }
        }

        return true;
      });
    } catch (error) {
      console.error('Transaction failed:', error);
      setAlerts([{type: 'error', message: error.message}]);
      return false;
    }
  };

  const createSingleBooking = async (startTime: string, endTime: string, dist: string) => {
    // If the car or date has changed in editing mode we need to do things a little differently
    // otherwise it will leave the old booking and create the new one with the same id.
    let movingBooking = storedDateCarBooking &&
        (storedDateCarBooking.car.id != selectedCar || storedDateCarBooking.date !== bookingDate);
    let sourceDateBooking = storedDateCarBooking;
    let targetDateBooking = storedDateCarBooking;
    if (!targetDateBooking || movingBooking) {
      targetDateBooking = bookings.find(dcb =>
          dcb.car.id === selectedCar && dcb.date === bookingDate
      );
    }

    try {
      return await runTransaction(db, async (transaction) => {
        // Fetching these docs within the transaction, to both read and update within the transaction.
        const targetDateBookingsDoc = targetDateBooking ? await transaction.get(doc(db, 'date-car-bookings', targetDateBooking.id)) : undefined;
        let sourceDateBookingsDoc = movingBooking ? await transaction.get(doc(db, 'date-car-bookings', sourceDateBooking.id)) : undefined;

        const newBooking = {
          id: existingBooking || doc(collection(db, 'date-car-bookings')).id,
          users: selectedUsers.map(u => doc(db, 'users', u)),
          startTime: timeToNumber(startTime),
          endTime: timeToNumber(endTime),
          distance: Number(dist),
          destination,
          byUser: doc(db, 'users', user.user_id)
        };

        if (targetDateBookingsDoc && targetDateBookingsDoc.exists()) {
          const existingBookings = targetDateBookingsDoc.data().bookings;

          // Check for overlapping bookings
          checkBookingOverlapping(existingBookings, newBooking, existingBooking, null);

          // Update existing document
          const updatedBookings = existingBooking && !movingBooking
              ? existingBookings.map(b => b.id === existingBooking ? newBooking : b)
              : [...existingBookings, newBooking];

          transaction.update(targetDateBookingsDoc.ref, {bookings: updatedBookings});
        } else {
          // Create new document
          const carRef = doc(db, 'cars', selectedCar);
          const newDateBookingRef = doc(collection(db, 'date-car-bookings'));
          transaction.set(newDateBookingRef, {
            date: bookingDate,
            car: carRef,
            bookings: [newBooking]
          });
        }
        // Now it is safe to delete the old booking, if moving
        if (sourceDateBookingsDoc && sourceDateBookingsDoc.exists()) {
          const sourceBookings = sourceDateBookingsDoc.data().bookings;
          const updatedSourceBookings = sourceBookings.filter(b => b.id !== existingBooking);
          updateOrDeleteDateBooking(transaction, sourceDateBookingsDoc.ref, updatedSourceBookings);
        }

        return true;
      });
    } catch (error) {
      console.error('Transaction failed:', error);
      setAlerts([{type: 'error', message: error.message}]);
      return false;
    }
  };

  const updateOrDeleteDateBooking = (transaction: Transaction, dateBookingRef: DocumentReference, updatedBookings: string | any[])=> {
    if (updatedBookings.length === 0) {
      transaction.delete(dateBookingRef);
    } else {
      transaction.update(dateBookingRef, { bookings: updatedBookings });
    }
  };

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

  const confirmChangeByOther = async (type: string): Promise<boolean> => {
    // This confirmation is currently only about editing a booking made by someone else
    if (!isEditing) return true;
    const bookingData = storedDateCarBooking.bookings.find(b => b.id === existingBooking);
    // TODO: Need to support the swapping scenario too, which also should be confirmed.
    if (bookingData.byUser.id === user.user_id) return true;
    const name = users.find(u => u.id === bookingData.byUser.id)?.shortName || bookingData.byUser.id;
    const action = type === "delete" ? "Raderar" : "Ändrar"
    return await showConfirmDialog(
        `${action} bokning av ${name}`,
        `Har du bekräftat med ${name} att du kan göra denna åtgärd?`
    );
  }

  const deleteBooking = async (single:boolean = false) => {
    try {
      setIsComitting(true);
      // Should not happen, but an extra check
      if (!isEditing || (!recurrenceId && !existingBooking)) return;

      if (!await confirmChangeByOther("delete")) return;

      await runTransaction(db, async (transaction) => {
        if (recurrenceId && !single) {
          // Get all bookings with this recurrence ID
          const recurrenceRef = doc(db, 'recurrence', recurrenceId);
          transaction.delete(recurrenceRef);
          const todayDate= format(new Date(), 'yyyy-MM-dd'); // Only allow deletion of future bookings
          const recurrenceBookings = bookings.filter(b =>
              b.car.id === selectedCar && b.date >= todayDate && b.bookings.find(b2 => b2.recurrenceId === recurrenceId)
          );

          // FIXME: Fetch all dateBookings before updating/deleting all of them.
          recurrenceBookings.forEach(book => {
            const bookings = book.bookings;
            updateOrDeleteDateBooking(transaction, doc(db, 'date-car-bookings', book.id), bookings.filter(
                b => b.recurrenceId !== recurrenceId
            ));
          });
        } else {
          const dateBooking = bookings.find(dcb =>
              dcb.car.id === selectedCar && dcb.date === bookingDate
          );
          updateOrDeleteDateBooking(transaction, doc(db, 'date-car-bookings', dateBooking.id), dateBooking.bookings.filter(
              b => b.id !== existingBooking
          ));
        }
      });

      navigate('/booking-overview');
    } catch (error) {
      console.error('Delete transaction failed:', error);
      setAlerts([{ type: 'error', message: 'Ett fel uppstod när bokningen skulle tas bort' }]);
    } finally {
      setIsComitting(false);
    }
  };

  const validateAllFields = async () => {
    let validations = [];
    const distanceReq = isDistanceRequired();
    if (!selectedCar || selectedUsers.length === 0 || !bookingDate || !bookingStartTime || !bookingEndTime || (!distance && distanceReq)) {
      validations.push({ type: 'error', message: `Vänligen fyll i alla obligatoriska fält: bil, användare, datum, start- och sluttid${distanceReq?", samt distans":""}.` });
    } else {
      if (!isMultiDay && bookingStartTime >= bookingEndTime) {
        validations.push({ type: 'error', message: 'Sluttid måste vara större än starttid' });
      }
    }

    if (isRecurring && (!recurringEndDate || recurringDays.length === 0)) {
      validations.push({ type: 'error', message: 'Välj veckodagar och slutdatum för återkommande bokning' });
    }

    if (isMultiDay && !recurringEndDate) {
      validations.push({ type: 'error', message: 'Välj slutdatum för flerdags bokning' });
    }

    setAlerts(validations);
    return validations.length === 0;
  }

  const handleBooking = async () => {
    try {
      setIsComitting(true);
      if (!await validateAllFields() || !await confirmChangeByOther("update")) {
        return;
      }

      if (await createOrUpdateBookings()) {
        // Navigate to the page where the first booking appears
        navigate('/booking-overview', {state: {date: new Date(bookingDate)}});
      }
    } catch (error) {
      console.error('Error saving booking:', error);
      setAlerts([{ type: 'error', message: 'Ett fel uppstod när bokningen skulle sparas' }]);
    } finally {
      setIsComitting(false);
    }
  };

  function getBookingDate(bookingDate: string = undefined, plusDays: number = 0) {
    let date = bookingDate ? new Date(bookingDate) : new Date();
    date.setDate(date.getDate() + plusDays);
    return format(date, 'yyyy-MM-dd');
  }

  function acceptCarChange(currentCar: string, newCar: string): boolean {
    if (isEditing) {
      if (isRecurring || isMultiDay) {
        // Currently not supported, complex scenario
        setAlerts([{ type: 'info', message: 'Byte av bil på en upprepande bokning stöds ej' }]);
        return false;
      }
      // Note that "swap" scenario is (of course) only possible for the same date, if the
      // date has been changed before the car-change, then we should just accept.
      if (storedDateCarBooking.date !== bookingDate) return true;
      // Check if newCar is available at the selected date and time
      const dateBooking = bookings.find(dcb =>
          dcb.car.id === newCar && dcb.date === bookingDate
      );
      if (dateBooking) {
        const newBooking = {
          startTime: timeToNumber(bookingStartTime),
          endTime: timeToNumber(bookingEndTime),
        };

        const {booking, type} = findOverlappingBooking(dateBooking.bookings, newBooking);
        if (booking) {
          // Overlap found - check if it would be possible to swap bookings
          // swap is only possible if
          // - the newCar booking fits without overlaps in the currentCar
          // - the newCar booking is not multi-day (if it is recurring it must be disconnected)
          // - there is only a single overlapping booking in newCar
          setAlerts([{type: 'info', message: 'Byte av bil krockar med annan bokning'}]);
          return false; // TODO: Implement swapping support
        }
      }
    }
    // If not editing it should always be OK to change
    return true;
  }

  function isDistanceRequired(): boolean {
    const range = cars.find(c => c.id == selectedCar)?.range;
    return range && range > 0;
  }

  return (
      <Card className="max-w-md mx-auto p-6 space-y-4">
        <ConfirmationDialog
            isOpen={dialogState.isOpen}
            title={dialogState.title}
            description={dialogState.description}
            onConfirm={dialogState.onConfirm}
            onCancel={dialogState.onCancel}
        />

        <CarSelector acceptChange={acceptCarChange} disabled={(isEditing && isRecurring) || isComitting}/>
        <UserSelector disabled={isEditing && isRecurring}/>

        <div className="flex gap-2">
          <div className="space-y-2">
            <Label>Datum</Label>
            <Input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                min={getBookingDate()}
                max={getBookingDate(undefined, 96)}
                disabled={isEditing && isRecurring}
            />
          </div>
          <TimeSelector
              label="Starttid"
              value={bookingStartTime}
              onChange={setBookingStartTime}
              disabled={isEditing && isRecurring}
          />
          <TimeSelector
              label="Sluttid"
              value={bookingEndTime}
              onChange={setBookingEndTime}
              disabled={isEditing && isRecurring}
          />
        </div>

        <div className="flex items-center space-x-8">
          <div className="flex items-center space-x-2">
            <Checkbox
                id="recurring"
                checked={isRecurring}
                disabled={isComitting}
                onCheckedChange={(checked) => {
                  setIsRecurring(checked === true);
                  if (checked) setIsMultiDay(false)
                }}
            />
            <Label htmlFor="recurring" className="text-sm">
              Återkommande
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
                id="multiday"
                checked={isMultiDay}
                disabled={isEditing}
                onCheckedChange={(checked) => {
                  setIsMultiDay(checked === true);
                  if (checked) setIsRecurring(false)
                }}
            />
            <Label htmlFor="multiday" className="text-sm">
              Flerdagars
            </Label>
          </div>
        </div>

          {(isRecurring || isMultiDay) && (
              <div className="space-y-4">
                {isRecurring && (
                    <div className="flex flex-wrap gap-2">
                      {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map((day, index) => (
                          <div key={index} className="flex items-center space-x-2">
                            <Checkbox
                                id={`day-${index}`}
                                checked={recurringDays.includes(index)}
                                disabled={isEditing}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setRecurringDays([...recurringDays, index]);
                                  } else {
                                    setRecurringDays(recurringDays.filter((d) => d !== index));
                                  }
                                }}
                            />
                            <Label htmlFor={`day-${index}`} className="text-sm">
                              {day}
                            </Label>
                          </div>
                      ))}
                    </div>
                )}

                <div className="space-y-2">
                  <Label>Slutdatum</Label>
                  <Input
                      type="date"
                      value={recurringEndDate}
                      disabled={isEditing}
                      onChange={(e) => setRecurringEndDate(e.target.value)}
                      min={getBookingDate(bookingDate, 1)}
                      max={getBookingDate(undefined, 96)}
                  />
                </div>
              </div>
          )}

          <div className="flex gap-2">
            <DestinationSelector
                value={destination}
                onChange={setDestination}
                onDistanceChange={setDistance}
                disabled={isEditing && isRecurring}
            />

            <div className="space-y-2">
              <Label>Distans (km)</Label>
              <Input
                  type="number"
                  value={distance}
                  disabled={isEditing && isRecurring}
                  onChange={(e) => setDistance(e.target.value)}
                  required={isDistanceRequired()}
              />
            </div>
          </div>

          {/* TODO: Use proper Alert elements */}
          {alerts.map((alert, index) => (
              <div
                  key={index}
                  className={`bg-${alert.type === 'error' ? 'red' : 'green'}-100 text-${alert.type === 'error' ? 'red' : 'green'}-800 flex gap-2`}
              >
                {alert.type === 'info' && (<Info size={32}/>)}
                {alert.type === 'warn' && (<TriangleAlert size={32}/>)}
                {alert.type === 'error' && (<OctagonAlert size={32}/>)}
                <span>{alert.message}</span>
              </div>
          ))}

          <Button
              className="w-full"
              onClick={handleBooking}
              disabled={isComitting || !selectedCar || selectedUsers.length === 0 || !bookingStartTime || !bookingEndTime || (!distance && isDistanceRequired())}
          >
            {isEditing ? 'Ändra bokning' : 'Boka resa'}
          </Button>

          {isEditing && isRecurring && (
              <div className="space-y-2">
                <Button
                    variant="destructive"
                    onClick={() => deleteBooking(false)}
                    disabled={isComitting}
                    className="w-full mt-2"
                >
                  Radera alla
                </Button>
                <Button
                    variant="destructive"
                    onClick={() => deleteBooking(true)}
                    disabled={isComitting}
                    className="w-full mt-2"
                >
                  Radera vald
                </Button>
              </div>
          )}

          {isEditing && !isRecurring && (
              <Button
                  variant="destructive"
                  onClick={() => deleteBooking(false)}
                  disabled={isComitting}
                  className="w-full mt-2"
              >
                Radera bokning
              </Button>
          )}
      </Card>
);
};

export default BookTrip;
