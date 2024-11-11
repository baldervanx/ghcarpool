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
import { setSelectedUsers } from '../store';
import { format } from 'date-fns';

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
      const params = new URLSearchParams(location.search);
      const bookingId = params.get('id');

      if (bookingId) {
        const bookingDoc = await getDoc(doc(db, 'bookings', bookingId));
        if (bookingDoc.exists()) {
          const bookingData = bookingDoc.data();
          setExistingBooking(bookingDoc.id);
          // FIXME:
          //setSelectedCar(bookingData.car.id);
          setSelectedUsers(bookingData.users.map(u => u.id));
          setBookingDate(bookingData.date);
          setBookingStartTime(timeToString(bookingData.startTime));
          setBookingEndTime(timeToString(bookingData.endTime));
          setDistance(bookingData.distance.toString());
          setDestination(bookingData.destination || '');

          if (bookingData.recurrenceId) {
            const recurrenceDoc = await getDoc(doc(db, 'recurrence', bookingData.recurrenceId));
            if (recurrenceDoc.exists()) {
              const recurrenceData = recurrenceDoc.data();
              setIsRecurring(true);
              setRecurringDays(recurrenceData.recurringDays);
              setRecurringEndDate(recurrenceData.recurringEndDate);
            }
          }
        }
      } else {
        // Set default start time to current time rounded to nearest 15 minutes
        const now = new Date();
        const minutes = Math.ceil(now.getMinutes() / 15) * 15;
        const hours = now.getHours() + Math.floor(minutes / 60);
        const adjustedMinutes = minutes % 60;
        setBookingStartTime(
            `${hours.toString().padStart(2, '0')}:${adjustedMinutes.toString().padStart(2, '0')}`
        );
        setBookingEndTime(
            `${(hours+2).toString().padStart(2, '0')}:00`
        );
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

  // Uppdatera createBookings för att hantera uppdateringar
  const createOrUpdateBookings = async () => {
    const carRef = doc(db, 'cars', selectedCar);
    const userRefs = selectedUsers.map((u) => doc(db, 'users', u));
    const byUser = doc(db, 'users', user.user_id);

    const bookingData = {
      car: carRef,
      users: userRefs,
      startTime: timeToNumber(bookingStartTime),
      endTime: timeToNumber(bookingEndTime),
      distance: Number(distance),
      date: bookingDate,
      destination,
      byUser,
      timestamp: serverTimestamp()
    };

    if (existingBooking) {
      // Uppdatera existerande bokning
      await updateDoc(doc(db, 'bookings', existingBooking), bookingData);
    } else if (!isRecurring) {
      // Skapa ny enskild bokning
      await addDoc(collection(db, 'bookings'), bookingData);
    } else {
      // Skapa ny återkommande bokning
      const recurrenceDoc = await addDoc(collection(db, 'recurrence'), {
        recurringDays,
        recurringEndDate,
        createdAt: serverTimestamp()
      });

      const start = new Date(bookingDate);
      const end = new Date(recurringEndDate);
      const currentDate = new Date(start);

      while (currentDate <= end) {
        if (recurringDays.includes(currentDate.getDay())) {
          await addDoc(collection(db, 'bookings'), {
            ...bookingData,
            date: format(currentDate, 'yyyy-MM-dd'),
            recurrenceId: recurrenceDoc.id
          });
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
  };

  const handleBooking = async () => {
    if (!selectedCar || selectedUsers.length === 0 || !bookingStartTime || !bookingEndTime || !distance) {
      setAlerts([{ type: 'error', message: 'Vänligen fyll i alla obligatoriska fält' }]);
      return;
    }

    if (isRecurring && (!recurringEndDate || recurringDays.length === 0)) {
      setAlerts([{ type: 'error', message: 'Välj veckodagar och slutdatum för återkommande bokning' }]);
      return;
    }

    try {
      await createOrUpdateBookings();
      navigate('/booking-overview');
    } catch (error) {
      console.error('Error saving booking:', error);
      setAlerts([{ type: 'error', message: 'Ett fel uppstod när bokningen skulle sparas' }]);
    }
  };

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
              label="Start tid"
              value={bookingStartTime}
              onChange={setBookingStartTime}
          />
          <TimeSelector
              label="Slut tid"
              value={bookingEndTime}
              onChange={setBookingEndTime}
          />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
              id="recurring"
              checked={isRecurring}
              onCheckedChange={setIsRecurring}
          />
          <Label htmlFor="recurring" className="text-sm">
            Återkommande bokning
          </Label>
        </div>

        {isRecurring && (
            <div className="space-y-4">
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

              <div className="space-y-2">
                <Label>Slutdatum</Label>
                <Input
                    type="date"
                    value={recurringEndDate}
                    onChange={(e) => setRecurringEndDate(e.target.value)}
                    min={bookingDate}
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

          {alerts.map((alert, index) => (
              <div
                  key={index}
                  className={`bg-${alert.type === 'error' ? 'red' : 'green'}-100 text-${alert.type === 'error' ? 'red' : 'green'}-800 p-4 rounded`}
              >
                {alert.message}
              </div>
          ))}

          <Button
              className="w-full"
              onClick={handleBooking}
              disabled={!selectedCar || selectedUsers.length === 0 || !bookingStartTime || !bookingEndTime || !distance}
          >
            Boka resa
          </Button>
      </Card>
);
};

export default BookTrip;
