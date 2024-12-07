import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { db } from '../utils/firebase';
import { collection, query, getDocs, where, addDoc, doc, serverTimestamp, getDoc, updateDoc } from 'firebase/firestore';
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
import { DocumentReference } from "firebase/firestore";

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

// Should be possible to use editable combo-box to allow entering custom destination
// Destinations could be loaded and cached locally as they rarely change.
const DestinationSelector = ({ value, onChange, onDistanceChange }) => {
  const [destinations, setDestinations] = useState([]);
  const [customDestination, setCustomDestination] = useState('');
  const [selectedDestination, setSelectedDestination] = useState('');

  useEffect(() => {
    const fetchDestinations = async () => {
      const snapshot = await getDocs(collection(db, 'destinations'));
      const destinationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setDestinations(destinationsData);
      // TODO: This isn't working.
      if (value) {
        setSelectedDestination(value);
      }
    };
    fetchDestinations();
  }, []);

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

// TODO:
// * Swap existing bookings between cars
// * Validate overlap - give more details and better handling of recurring booking
// * Validate range - check previous use and calc remaining range, estimate range depending on weather. Only warning.
// * Destination is not set when updating existing entry
// * Use accordion (https://ui.shadcn.com/docs/components/accordion) for the advanced settings?
// * Recurring booking should end at and including end-date
// * Recurring booking must (optionally) delete all entries including the recurring-booking entry.
// * Updating recurring booking - must be tested - quite complex, might need to limit for now.
// * Support multi-day booking - i.e. a special case of recurring booking
// * Better date selector - that fits with the theme - https://ui.shadcn.com/docs/components/date-picker
// * Better time selector - selecting times quicker with "scroll".
// * Lock fields while waiting - loading/saving.

// * Transactional update - never overwrite external update.
const BookTrip = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const { selectedCar } = useSelector(state => state.car);
  const { user } = useSelector(state => state.auth);
  const { selectedUsers, users } = useSelector(state => state.user);
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

  // Lägg till useEffect för att hämta existerande bokning
  useEffect(() => {
    const fetchExistingBooking = async () => {
      if (location.state) {
        const { parent_id, booking_id } = location.state;
        const dateCarDoc = await getDoc(doc(db, 'date-car-bookings', parent_id));
        if (dateCarDoc.exists()) {
          // TODO: Store this bookingData.
          const bookingData = dateCarDoc.data().bookings.find(b => b.id === booking_id);

          if (bookingData) {
            setExistingBooking(booking_id);
            dispatch(setSelectedCar(dateCarDoc.data().car.id));
            setSelectedUsers(bookingData.users.map(u => u.id));
            setBookingDate(dateCarDoc.data().date);
            setBookingStartTime(timeToString(bookingData.startTime));
            setBookingEndTime(timeToString(bookingData.endTime));
            setDistance(bookingData.distance.toString());
            setDestination(bookingData.destination || '');

            // Handle recurrence
            if (bookingData.recurrenceId) {
              const recurrenceDoc = await getDoc(doc(db, 'recurrence', bookingData.recurrenceId));
              if (recurrenceDoc.exists()) {
                const recurrenceData = recurrenceDoc.data();
                if (recurrenceData.isMultiDay) {
                  setIsMultiDay(true);
                } else {
                  setIsRecurring(true);
                  setRecurringDays(recurrenceData.recurringDays);
                }
                setRecurringEndDate(recurrenceData.recurringEndDate);
              }
            }
          }
        }
      }
    };

    fetchExistingBooking();
  }, [location.search]);

  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  function timeToNumber(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function isBookingOverlapping(bookings: Booking[]) {
    if (bookings.length === 1) {
      return false;
    }
    // TODO: Present details about the overlap, and also warn when booking close to another booking.
    for (let i = 1; i < bookings.length; i++) {
      if (bookings[i].startTime < bookings[i - 1].endTime) {
        return true;
      }
    }
    return false;
  }

  // TODO: Must fetch all existing bookings for the entire range of dates that is being booked and
  // verify that there are no collisions BEFORE starting to book dates.
  const createOrUpdateBookings = async () => {
    if (!isRecurring && !isMultiDay) {
      // Existing single booking creation logic
      return await createSingleBooking(bookingStartTime, bookingEndTime, distance);
    } else {
      // Recurring booking logic
      const recurrenceDoc = await addDoc(collection(db, 'recurrence'), {
        isMultiDay,
        recurringDays,
        recurringEndDate,
        createdAt: serverTimestamp()
      });

      const start = new Date(bookingDate);
      const end = new Date(recurringEndDate);
      // TODO: Must ensure end-date is set and is after start-date.

      const currentDate = new Date(start);
      let startTime = bookingStartTime;
      let endTime = bookingEndTime;
      let dist = distance;
      while (currentDate <= end) {
        if (isMultiDay || recurringDays.includes(currentDate.getDay())) {
          if (isMultiDay) {
            if (isSameDay(currentDate, start)) {
              endTime = "24:00";
              dist = '';
            } else if (isSameDay(currentDate, end)) {
              endTime = bookingEndTime;
              dist = distance; // Should only have distance set on the last entry when multi-day.
            } else {
              startTime = "00:00";
            }
          }
          // Create booking for each recurring day
          const succeeded = await createSingleBooking(
              startTime, endTime, dist,
              format(currentDate, 'yyyy-MM-dd'),
              recurrenceDoc.id
          );
          if (!succeeded) {
            // TODO: Must check if it is OK that some updates fail due to collisions.
            // For a multi-day booking ALL bookings MUST succeed.
            return false;
          }
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    return true;
  };

  const createSingleBooking = async (startTime, endTime, dist, date = bookingDate, recurrenceId = null) => {
    const carRef = doc(db, 'cars', selectedCar);
    const dateCarQuery = query(
        collection(db, 'date-car-bookings'),
        where('date', '==', date),
        where('car', '==', carRef)
    );

    const snapshot = await getDocs(dateCarQuery);

    const newBooking = {
      id: existingBooking || doc(collection(db, 'date-car-bookings')).id,
      users: selectedUsers.map(u => doc(db, 'users', u)),
      startTime: timeToNumber(startTime),
      endTime: timeToNumber(endTime),
      distance: Number(dist),
      destination,
      byUser: doc(db, 'users', user.user_id),
      ...(recurrenceId && { recurrenceId })
    };

    if (snapshot.empty) {
      // First booking for this date and car
      await addDoc(collection(db, 'date-car-bookings'), {
        date,
        car: carRef,
        bookings: [newBooking]
      });
    } else {
      // Existing date-car document
      const docRef = snapshot.docs[0].ref;
      const currentBookings = snapshot.docs[0].data().bookings;

      let updatedBookings: Booking[];
      if (existingBooking) {
        // Update existing booking
        updatedBookings = currentBookings.map(booking =>
            booking.id === existingBooking ? newBooking : booking
        );
      } else {
        updatedBookings = [...currentBookings, newBooking];
      }
      updatedBookings = updatedBookings.sort((a, b) => a.startTime - b.startTime);
      if (isBookingOverlapping(updatedBookings)) {
        // For recurring bookings there might be many collisions.
        setAlerts([{ type: 'error', message: 'Vald tid krockar med annan bokning' }]);
        return false;
      }
      await updateDoc(docRef, { bookings: updatedBookings });
    }
    return true;
  };

  // FIXME: Must handle deletion of all recurring bookings too, including the recurrence entry.
  const deleteBooking = async () => {
    if (!existingBooking) return;

    const dateCarQuery = query(
        collection(db, 'date-car-bookings'),
        where('date', '==', bookingDate),
        where('car', '==', doc(db, 'cars', selectedCar))
    );

    const snapshot = await getDocs(dateCarQuery);
    if (!snapshot.empty) {
      const docRef = snapshot.docs[0].ref;
      const currentBookings = snapshot.docs[0].data().bookings;

      const updatedBookings = currentBookings.filter(
          booking => booking.id !== existingBooking
      );

      await updateDoc(docRef, { bookings: updatedBookings });
      navigate('/booking-overview');
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
