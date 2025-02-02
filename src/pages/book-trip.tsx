import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '@/db/firebase';
import { collection, doc, serverTimestamp, getDoc, runTransaction, DocumentReference } from 'firebase/firestore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CarSelector } from '../components/CarSelector';
import { useDispatch, useSelector } from 'react-redux';
import UserSelector from '../components/UserSelector';
import { setSelectedUsers, setSelectedCar } from '../store';
import { format, isSameDay } from 'date-fns';

interface Booking {
  id?: string; // Optional, for existing bookings
  users: DocumentReference[];
  startTime: number;
  endTime: number;
  distance: number;
  destination: string;
  byUser: DocumentReference;
  recurrenceId?: string;
}

// TODO: How to use this interface?
interface DateCarBooking {
  date: string;
  car: DocumentReference;
  bookings: Array<Booking>;
}

const TimeSelector = ({ value, onChange, label }) => {
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  const minutes = ['00', '15', '30', '45'];

  const [selectedHour, selectedMinute] = value ? value.split(':') : ['', ''];

  const handleHourChange = (hour) => {
    onChange(`${hour}:${selectedMinute || '00'}`);
  };

  const handleMinuteChange = (minute) => {
    onChange(`${selectedHour || '00'}:${minute}`);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-1">
        <Select value={selectedHour} onValueChange={handleHourChange}>
          <SelectTrigger className="flex-1 time-select-trigger">
            <SelectValue placeholder="--" />
          </SelectTrigger>
          <SelectContent>
            {hours.map((hour) => (
              <SelectItem key={hour} value={hour}>
                {hour}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedMinute} onValueChange={handleMinuteChange}>
          <SelectTrigger className="flex-1 time-select-trigger">
            <SelectValue placeholder="00" />
          </SelectTrigger>
          <SelectContent>
            {minutes.map((minute) => (
              <SelectItem key={minute} value={minute}>
                {minute}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

const DestinationSelector = ({ value, onChange, onDistanceChange }) => {
  const { destinations } = useSelector(state => state.destination);
  const [customDestination, setCustomDestination] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');

  useEffect(() => {
      if (value) {
        setSelectedFromName(value);
      }
  }, [value]);

  const setSelectedFromName = (name) => {
    const destObj = destinations.find(d => d.name === name);
    if (destObj) {
      setSelectedDestination(destObj.id);
    } else {
      setSelectedDestination('custom');
      setCustomDestination(name);
    }
  }

  const handleDestinationChange = (value) => {
    setSelectedDestination(value);
    if (value === 'custom') {
      onChange(customDestination);
    } else {
      const destination = destinations.find(d => d.id === value);
      if (destination) {
        onChange(destination.name);
        onDistanceChange(destination.distance.toString());
      }
    }
  };

  const handleCustomDestinationChange = (e) => {
    setCustomDestination(e.target.value);
    onChange(e.target.value);
  };

  return (
    <div className="space-y-2">
      <Label>Destination</Label>
      <Select value={selectedDestination} onValueChange={handleDestinationChange}>
        <SelectTrigger>
          <SelectValue placeholder="Välj destination" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="custom">Annan destination</SelectItem>
          {destinations.map((destination) => (
            <SelectItem key={destination.id} value={destination.id}>
              {destination.name} ({destination.shortName})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedDestination === 'custom' && (
        <Input
          value={customDestination}
          onChange={handleCustomDestinationChange}
          placeholder="Ange destination"
        />
      )}
    </div>
  );
};

const BookTrip = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const { selectedCar } = useSelector(state => state.car);
  const { user } = useSelector(state => state.auth);
  const { selectedUsers } = useSelector(state => state.user);
  const bookings = useSelector(state => state.booking.bookings);
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
  const [existingBooking, setExistingBooking] = useState(null);

  useEffect(() => {
    dispatch(setSelectedUsers([user.user_id]));
  }, [user.user_id]);

  useEffect(() => {
    if (location.state) {
      const { parent_id, booking_id } = location.state;
      const dateCarBooking = bookings.find(b => b.parent_id === parent_id);

      if (dateCarBooking) {
        const bookingData = dateCarBooking.bookings.find(b => b.id === booking_id);

        if (bookingData) {
          setExistingBooking(booking_id);
          dispatch(setSelectedCar(dateCarBooking.car.id));
          setSelectedUsers(bookingData.users.map(u => u.id));
          setBookingDate(dateCarBooking.date);
          setBookingStartTime(timeToString(bookingData.startTime));
          setBookingEndTime(timeToString(bookingData.endTime));
          setDistance(bookingData.distance.toString());
          setDestination(bookingData.destination || '');

          // Handle recurrence logic
          if (bookingData.recurrenceId) {
            fetchRecurrenceData(bookingData.recurrenceId);
          }
        }
      }
    }
  }, [location.state, bookings]);

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
            setExistingBooking(firstMultiDayBooking.id);
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

  function isBookingOverlapping(bookings, newBooking, existingBookingId = null) {
    const sortedBookings = [...bookings]
        .filter(b => b.id !== existingBookingId)
        .concat(newBooking)
        .sort((a, b) => a.startTime - b.startTime);

    for (let i = 1; i < sortedBookings.length; i++) {
      if (sortedBookings[i].startTime < sortedBookings[i - 1].endTime) {
        return true;
      }
    }
    return false;
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
            docRef: dateBookings?.parent_ref
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
              const existingBookings = dateBookingsDoc.data().bookings;
              validation.bookings = existingBookings;
              const newBooking = {
                startTime: timeToNumber(validation.startTime),
                endTime: timeToNumber(validation.endTime)
              };

              if (isBookingOverlapping(existingBookings, newBooking, existingBooking)) {
                throw new Error(`Bokning krockar med existerande bokning ${validation.date}`);
              }
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

            transaction.update(bookingData.docRef, { bookings: updatedBookings });
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
      setAlerts([{ type: 'error', message: error.message }]);
      return false;
    }
  };

  const createSingleBooking = async (startTime: string, endTime: string, dist: string) => {
    const dateBookings = bookings.find(b =>
        b.car.id === selectedCar && b.date === bookingDate
    );

    try {
      return await runTransaction(db, async (transaction) => {
        const dateBookingsDoc = dateBookings ? await transaction.get(dateBookings.parent_ref) : undefined;

        const newBooking = {
          id: existingBooking || doc(collection(db, 'date-car-bookings')).id,
          users: selectedUsers.map(u => doc(db, 'users', u)),
          startTime: timeToNumber(startTime),
          endTime: timeToNumber(endTime),
          distance: Number(dist),
          destination,
          byUser: doc(db, 'users', user.user_id)
        };

        if (dateBookingsDoc && dateBookingsDoc.exists()) {
          const existingBookings = dateBookingsDoc.data().bookings;

          // Check for overlapping bookings
          if (isBookingOverlapping(existingBookings, newBooking, existingBooking)) {
            throw new Error('Vald tid krockar med annan bokning');
          }


          // Update existing document
          const updatedBookings = existingBooking
              ? existingBookings.map(b => b.id === existingBooking ? newBooking : b)
              : [...existingBookings, newBooking];

          transaction.update(dateBookingsDoc.ref, { bookings: updatedBookings });
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

        return true;
      });
    } catch (error) {
      console.error('Transaction failed:', error);
      setAlerts([{ type: 'error', message: error.message }]);
      return false;
    }
  };

  const deleteBooking = async () => {
    if (!existingBooking) return;

    const dateBookings = bookings.find(b =>
        b.car.id === selectedCar && b.date === bookingDate
    );

    try {
      await runTransaction(db, async (transaction) => {
        const dateBookingsDoc = dateBookings ? await transaction.get(dateBookings.parent_ref) : undefined;
        if (!dateBookingsDoc || !dateBookingsDoc.exists()) return;

        const bookingData = dateBookingsDoc.data();
        const bookingToDelete = bookingData.bookings.find(b => b.id === existingBooking);

        if (!bookingToDelete) return;

        if (bookingToDelete.recurrenceId) {
          // Get all bookings with this recurrence ID
          const recurrenceRef = doc(db, 'recurrence', bookingToDelete.recurrenceId);
          transaction.delete(recurrenceRef);

          const recurrenceBookings = bookings.filter(b =>
              b.car.id === selectedCar && b.bookings.find(b2 => b2.recurrenceId === bookingToDelete.recurrenceId)
          );

          // FIXME: Fetch all dateBookings before updating/deleting all of them.
          recurrenceBookings.forEach(book => {
            const bookings = book.bookings;
            const updatedBookings = bookings.filter(
                b => b.recurrenceId !== bookingToDelete.recurrenceId
            );

            if (updatedBookings.length === 0) {
              transaction.delete(book.parent_ref);
            } else {
              transaction.update(book.parent_ref, { bookings: updatedBookings });
            }
          });
        } else {
          // Handle single booking deletion
          const updatedBookings = bookingData.bookings.filter(
              b => b.id !== existingBooking
          );

          if (updatedBookings.length === 0) {
            transaction.delete(dateBookingsDoc.ref);
          } else {
            transaction.update(dateBookingsDoc.ref, { bookings: updatedBookings });
          }
        }
      });

      navigate('/booking-overview');
    } catch (error) {
      console.error('Delete transaction failed:', error);
      setAlerts([{ type: 'error', message: 'Ett fel uppstod när bokningen skulle tas bort' }]);
    }
  };

  const validateAllFields = async () => {
    let validations = [];
    if (!selectedCar || selectedUsers.length === 0 || !bookingDate || !bookingStartTime || !bookingEndTime || !distance) {
      validations.push({ type: 'error', message: 'Vänligen fyll i alla obligatoriska fält: bil, användare, datum, start- och sluttid, samt distans.' });
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
    if (!await validateAllFields()) {
      return;
    }
    try {
      if (await createOrUpdateBookings()) {
        navigate('/booking-overview');
      }
    } catch (error) {
      console.error('Error saving booking:', error);
      setAlerts([{ type: 'error', message: 'Ett fel uppstod när bokningen skulle sparas' }]);
    }
  };

  function dayAfter(bookingDate: string) {
    let nextDay = new Date(bookingDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return format(nextDay, 'yyyy-MM-dd');
  }

  return (
      <Card className="max-w-md mx-auto p-6 space-y-4">
        <CarSelector/>
        <UserSelector />

        <div className="flex gap-2">
          <div className="space-y-2">
            <Label>Datum</Label>
            <Input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <TimeSelector
              label="Starttid"
              value={bookingStartTime}
              onChange={setBookingStartTime}
          />
          <TimeSelector
              label="Sluttid"
              value={bookingEndTime}
              onChange={setBookingEndTime}
          />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
              id="recurring"
              checked={isRecurring}
              onCheckedChange={(checked) => {
                  setIsRecurring(checked);
                  if (checked) setIsMultiDay(false)}}
          />
          <Label htmlFor="recurring" className="text-sm">
            Återkommande bokning
          </Label>
          <Checkbox
              id="multiday"
              checked={isMultiDay}
              onCheckedChange={(checked) => {
                setIsMultiDay(checked);
                if (checked) setIsRecurring(false)}}
          />
          <Label htmlFor="multiday" className="text-sm">
            Flerdags bokning
          </Label>
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
                    onChange={(e) => setRecurringEndDate(e.target.value)}
                    min={dayAfter(bookingDate)}
                />
              </div>
            </div>
        )}

        <div className="flex gap-2">
          <DestinationSelector
              value={destination}
              onChange={setDestination}
              onDistanceChange={setDistance}
          />

          <div className="space-y-2">
            <Label>Distans (km)</Label>
            <Input
                type="number"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                required
            />
          </div>
        </div>

          {/* TODO: Use proper Alert elements */}
          {alerts.map((alert, index) => (
              <div
                  key={index}
                  className={`bg-${alert.type === 'error' ? 'red' : 'green'}-100 text-${alert.type === 'error' ? 'red' : 'green'}-800 p-1`}
              >
                {alert.message}
              </div>
          ))}

          <Button
              className="w-full"
              onClick={handleBooking}
              disabled={!selectedCar || selectedUsers.length === 0 || !bookingStartTime || !bookingEndTime || !distance}
          >
            { existingBooking ? 'Ändra bokning' : 'Boka resa' }
          </Button>

        {existingBooking && (
            <Button
                variant="destructive"
                onClick={deleteBooking}
                className="w-full mt-2"
            >
              Radera bokning
            </Button>
        )}
      </Card>
);
};

export default BookTrip;
