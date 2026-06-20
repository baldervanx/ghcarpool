import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Checkbox} from '@/components/ui/checkbox';
import {CarSelector} from '@/components/CarSelector';
import {useDispatch, useSelector} from 'react-redux';
import UserSelector from '@/components/UserSelector';
import type {AppStore, DateCarBooking, Booking} from '@/store';
import {setSelectedCar, setSelectedUsers} from '@/store';
import {addDays, differenceInCalendarDays, format} from 'date-fns';
import {Info, OctagonAlert, TriangleAlert} from 'lucide-react';
import ConfirmationDialog from '@/components/confirmation-dialog';
import {TimeSelector} from "@/components/time-selector";
import {DestinationSelector} from "@/components/destination-selector";
import {bookingsApi} from '@/api/bookings';


const BookTrip = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const {selectedCar, cars} = useSelector((state: AppStore) => state.car);
  const {user} = useSelector((state: AppStore) => state.auth);
  const {selectedUsers, users} = useSelector((state: AppStore) => state.user);
  const {bookings} = useSelector((state: AppStore) => state.booking);
  const [bookingDate, setBookingDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [bookingStartTime, setBookingStartTime] = useState('');
  const [bookingEndTime, setBookingEndTime] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [recurringDays, setRecurringDays] = useState([]);
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [distance, setDistance] = useState('');
  const [destination, setDestination] = useState('');
  const [comment, setComment] = useState<string>('');
  const [alerts, setAlerts] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [existingBooking, setExistingBooking] = useState<string>(null);
  const [storedDateCarBooking, setStoredDateCarBooking] = useState<DateCarBooking>(null);
  const [recurrenceId, setRecurrenceId] = useState(null);
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: null,
    onCancel: null
  });
  const [isComitting, setIsComitting] = useState(false);
  const [bookingToSwap, setBookingToSwap] = useState<Booking>(null);

  useEffect(() => {
    if (location.state?.parent_id) {
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
          setComment(bookingData.comment || '');

          // Handle recurrence logic
          if (bookingData.recurrenceId) {
            setRecurrenceId(bookingData.recurrenceId);
            fetchRecurrenceData(bookingData.recurrenceId);
          }
        }
      }
    } else if (location.state?.car) {
      const {car, date} = location.state;
      dispatch(setSelectedCar(car));
      setBookingDate(format(date, 'yyyy-MM-dd'));
      dispatch(setSelectedUsers([user.user_id]));
    } else {
      dispatch(setSelectedUsers([user.user_id]));
    }
  }, [location.state, bookings, user.user_id]);

  const fetchRecurrenceData = async (rId: string) => {
    // Recurrence-data finns nu i bookings-state via SSE-hooken.
    // Hitta alla bookings med detta recurrenceId i det aktuella car-urvalet.
    const recurringBookings = bookings
      .filter(b => b.car.id === selectedCar && b.bookings.some(b2 => b2.recurrenceId === rId))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (recurringBookings.length === 0) return;

    const firstEntry = recurringBookings[0].bookings.find(b2 => b2.recurrenceId === rId);
    const lastEntry = recurringBookings[recurringBookings.length - 1].bookings.find(b2 => b2.recurrenceId === rId);

    if (!firstEntry || !lastEntry) return;

    // Kontrollera om det är en flerdagsbokning (00:00–24:00 i mitten)
    const isMultiDayBooking = recurringBookings.length > 1 &&
      firstEntry.endTime === 24 * 60 && lastEntry.startTime === 0;

    if (isMultiDayBooking) {
      setIsMultiDay(true);
      setBookingDate(recurringBookings[0].date);
      setBookingStartTime(timeToString(firstEntry.startTime));
      setBookingEndTime(timeToString(lastEntry.endTime));
      setDistance(lastEntry.distance.toString());
    } else {
      setIsRecurring(true);
      // Härleda veckodagar från de funna datumen
      const days = recurringBookings.map(b => dayToIndex(new Date(b.date)));
      setRecurringDays([...new Set(days)]);
    }
    setRecurringEndDate(recurringBookings[recurringBookings.length - 1].date);
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

  interface OverlappingBooking {
    type: string;
    booking?: Booking;
  }

  function findOverlappingBooking(bookings: Booking[], newBooking: BookingTimes, existingBookingId?: string, recurrenceId?: string): OverlappingBooking {
    // Filter out any old version of the booking, add the new one and sort.
    const sortedBookings = bookings
        .filter(b => b.id !== existingBookingId && (recurrenceId === undefined || b.recurrenceId !== recurrenceId))
        .sort((a, b) => a.startTime - b.startTime);

    // Håll separerad från sorteringen för att kunna hitta överlappningar korrekt
    const onlyExistingBookings = [...sortedBookings];

    // Hitta alla överlappande bokningar
    const overlappingBookings: OverlappingBooking[] = [];

    for (const booking of onlyExistingBookings) {
      // Kontrollera om den nya bokningen överlappar med den befintliga bokningen
      if (
          (newBooking.startTime < booking.endTime && newBooking.endTime > booking.startTime) ||
          (booking.startTime < newBooking.endTime && booking.endTime > newBooking.startTime)
      ) {
        let type = "";

        // Bestäm typ av överlappning
        if (newBooking.startTime < booking.startTime && newBooking.endTime > booking.endTime) {
          // Nya bokningen omsluter helt den befintliga
          type = "complete";
        } else if (newBooking.startTime < booking.endTime && newBooking.startTime >= booking.startTime) {
          // Start-tiden överlappar
          type = "startTime";
        } else {
          // End-tiden överlappar
          type = "endTime";
        }

        overlappingBookings.push({booking, type});
      }
    }

    // Returnera rätt resultat baserat på antal överlappningar
    if (overlappingBookings.length === 0) {
      return {type: "none"};
    } else if (overlappingBookings.length === 1) {
      return overlappingBookings[0];
    } else {
      return {type: "multiple", booking: overlappingBookings[0].booking};
    }
  }

  function checkBookingOverlapping(bookings: Booking[], newBooking: BookingTimes, existingBookingId: string, recurrenceId: string, date = null) {
    const overlappingBooking = findOverlappingBooking(bookings, newBooking, existingBookingId, recurrenceId);
    if (overlappingBooking.type === "none") return;
    if (overlappingBooking.type !== "multiple") {
      if (overlappingBooking.type === "startTime") {
        throw new Error(`${date ? date + ": " : ""}Vald starttid krockar med bokning som slutar ${timeToString(overlappingBooking.booking?.endTime)}`);
      } else if (overlappingBooking.type === "endTime") {
        throw new Error(`${date ? date + ": " : ""}Vald sluttid krockar med bokning som börjar ${timeToString(overlappingBooking.booking?.startTime)}`);
      } else {
        throw new Error(`${date ? date + ": " : ""}Bokningen krockar fullständigt med bokning ${timeToString(overlappingBooking.booking?.startTime)}-${timeToString(overlappingBooking.booking?.endTime)}`);
      }
    } else {
      throw new Error(`${date ? date + ": " : ""}Bokningen krockar med flera bokningar`);
    }
  }

  const dayToIndex = (date: Date): number => {
    const index = date.getDay() - 1; // Must change place on sunday
    return index >= 0 ? index : 6;
  };

  const createOrUpdateBookings = async (): Promise<boolean> => {
    if (!isRecurring && !isMultiDay) {
      return await createSingleBooking(bookingStartTime, bookingEndTime, distance);
    }

    try {
      const start = new Date(bookingDate);
      const end = new Date(recurringEndDate);
      const numDays = differenceInCalendarDays(end, start);
      const newRecurrenceId = recurrenceId ?? crypto.randomUUID();

      const promises: Promise<DateCarBooking>[] = [];

      for (let dayOffset = 0; dayOffset <= numDays; dayOffset++) {
        const currentDate = addDays(start, dayOffset);
        if (isMultiDay || recurringDays.includes(dayToIndex(currentDate))) {
          let startTime = bookingStartTime;
          let endTime = bookingEndTime;
          let dist = distance;

          if (isMultiDay) {
            if (dayOffset === 0) { endTime = "24:00"; dist = ''; }
            else if (dayOffset === numDays) { startTime = "00:00"; }
            else { startTime = "00:00"; endTime = "24:00"; dist = ''; }
          }

          const dateStr = format(currentDate, 'yyyy-MM-dd');
          const dateCarBooking = bookings.find(b => b.car.id === selectedCar && b.date === dateStr);
          const existingOnDate = dateCarBooking?.bookings.find(b => b.recurrenceId === newRecurrenceId);

          // Validate overlap client-side before sending
          if (dateCarBooking) {
            const others = dateCarBooking.bookings.filter(b => b.recurrenceId !== newRecurrenceId);
            checkBookingOverlapping(others, { startTime: timeToNumber(startTime), endTime: timeToNumber(endTime) }, existingBooking ?? undefined, newRecurrenceId, dateStr);
          }

          promises.push(bookingsApi.save({
            date: dateStr,
            carId: selectedCar,
            startTime: timeToNumber(startTime),
            endTime: timeToNumber(endTime),
            distance: Number(dist) || 0,
            destinationId: destination || undefined,
            comment: comment || undefined,
            recurrenceId: newRecurrenceId,
            userIds: selectedUsers,
            existingBookingId: existingOnDate?.id,
            existingParentId: dateCarBooking?.id,
          }));
        }
      }

      // Delete recurring bookings outside the new range (if editing)
      if (recurrenceId) {
        const targetDates = new Set<string>();
        for (let d = 0; d <= numDays; d++) {
          const cd = addDays(start, d);
          if (isMultiDay || recurringDays.includes(dayToIndex(cd))) {
            targetDates.add(format(cd, 'yyyy-MM-dd'));
          }
        }
        const toDelete = bookings.filter(b =>
          b.car.id === selectedCar && !targetDates.has(b.date) &&
          b.bookings.some(b2 => b2.recurrenceId === recurrenceId)
        );
        for (const dcb of toDelete) {
          const bookingToDelete = dcb.bookings.find(b2 => b2.recurrenceId === recurrenceId);
          if (bookingToDelete) {
            promises.push(bookingsApi.delete(dcb.id, bookingToDelete.id).then(() => dcb));
          }
        }
      }

      await Promise.all(promises);
      return true;
    } catch (error) {
      console.error('Booking failed:', error);
      setAlerts([{type: 'error', message: (error as Error).message}]);
      return false;
    }
  };

  const createSingleBooking = async (startTime: string, endTime: string, dist: string): Promise<boolean> => {
    try {
      const targetDateBooking = bookings.find(dcb =>
        dcb.car.id === selectedCar && dcb.date === bookingDate
      );

      // Client-side overlap check
      if (targetDateBooking) {
        const others = targetDateBooking.bookings.filter(b => b.id !== existingBooking);
        if (bookingToSwap) {
          // Remove the swap-target from overlap check
          const withoutSwap = others.filter(b => b.id !== bookingToSwap.id);
          checkBookingOverlapping(withoutSwap, { startTime: timeToNumber(startTime), endTime: timeToNumber(endTime) }, existingBooking ?? undefined, undefined);
        } else {
          checkBookingOverlapping(others, { startTime: timeToNumber(startTime), endTime: timeToNumber(endTime) }, existingBooking ?? undefined, undefined);
        }
      }

      // Handle swap: move bookingToSwap to the source car before creating new booking
      if (bookingToSwap && storedDateCarBooking) {
        await bookingsApi.save({
          date: bookingDate,
          carId: storedDateCarBooking.car.id,
          startTime: bookingToSwap.startTime,
          endTime: bookingToSwap.endTime,
          distance: bookingToSwap.distance,
          destinationId: bookingToSwap.destination || undefined,
          comment: bookingToSwap.comment,
          userIds: bookingToSwap.users.map(u => u.id),
          existingBookingId: bookingToSwap.id,
          existingParentId: storedDateCarBooking.id,
        });
      }

      await bookingsApi.save({
        date: bookingDate,
        carId: selectedCar,
        startTime: timeToNumber(startTime),
        endTime: timeToNumber(endTime),
        distance: Number(dist) || 0,
        destinationId: destination || undefined,
        comment: comment || undefined,
        userIds: selectedUsers,
        existingBookingId: existingBooking ?? undefined,
        existingParentId: storedDateCarBooking?.id,
      });

      return true;
    } catch (error) {
      console.error('Booking failed:', error);
      setAlerts([{type: 'error', message: (error as Error).message}]);
      return false;
    }
  };

  const deleteBooking = async (single: boolean = false) => {
    try {
      setIsComitting(true);
      if (!isEditing || (!recurrenceId && !existingBooking)) return;
      if (!await confirmChangeByOther("delete")) return;

      if (recurrenceId && !single) {
        // Delete all future bookings with this recurrenceId
        const today = format(new Date(), 'yyyy-MM-dd');
        const toDelete = bookings.filter(b =>
          b.car.id === selectedCar && b.date >= today &&
          b.bookings.some(b2 => b2.recurrenceId === recurrenceId)
        );
        await Promise.all(toDelete.map(dcb => {
          const b2 = dcb.bookings.find(b => b.recurrenceId === recurrenceId);
          return b2 ? bookingsApi.delete(dcb.id, b2.id) : Promise.resolve();
        }));
      } else if (existingBooking && storedDateCarBooking) {
        await bookingsApi.delete(storedDateCarBooking.id, existingBooking);
      }

      navigate('/booking-overview');
    } catch (error) {
      console.error('Delete failed:', error);
      setAlerts([{ type: 'error', message: 'Ett fel uppstod när bokningen skulle tas bort' }]);
    } finally {
      setIsComitting(false);
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
    let otherUser: string;
    let action: string;
    if (bookingData.byUser.id !== user.user_id) {
      otherUser = bookingData.byUser.id;
      action = type === "delete" ? "Raderar" : "Ändrar";
    } else if (bookingToSwap && bookingToSwap.byUser.id !== user.user_id) {
      otherUser = bookingToSwap.byUser.id;
      action = "Flyttar";
    } else {
      return true;
    }
    const name = users.find(u => u.id === otherUser)?.shortName || otherUser;
    return await showConfirmDialog(
        `${action} bokning av ${name}`,
        `Har du bekräftat med ${name} att du kan göra denna åtgärd?`
    );
  }

  const validateAllFields = async () => {
    let validations = [];
    const distanceReq = isDistanceRequired();
    if (!selectedCar || selectedUsers.length === 0 || !bookingDate || !bookingStartTime || !bookingEndTime || (!distance && distanceReq)) {
      validations.push({ type: 'error', message: `Vänligen fyll i alla obligatoriska fält: bil, användare, datum, start- och sluttid${distanceReq?", samt distans":""}.` });
    } else if (!isMultiDay && bookingStartTime >= bookingEndTime) {
      validations.push({ type: 'error', message: 'Sluttid måste vara större än starttid' });
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
      // If changing car selection again, we need to reset the swapping setting.
      setBookingToSwap(null);
      if (isRecurring || isMultiDay) {
        // Currently not supported, complex scenario
        setAlerts([{ type: 'info', message: 'Byte av bil på en upprepande bokning stöds ej' }]);
        return false;
      }
      // Note that "swap" scenario is (of course) only possible for the same date, if the
      // date has been changed before the car-change, then we should just accept here.
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
        // Overlap found - check if it would be possible to swap bookings
        // swap is only possible if
        // - the newCar booking fits without overlaps in the currentCar
        // - the newCar booking is not multi-day (if it is recurring it must be disconnected)
        // - there is only a single overlapping booking in newCar
        if (type === "multiple") {
          setAlerts([{type: 'info', message: 'Byte av bil krockar med flera bokningar'}]);
          return false;
        } else if (type !== "none") {
          if (booking.recurrenceId) {
            // Should check if the recurrence is multi-day, we can support moving a normal recurring booking.
            setAlerts([{type: 'info', message: 'Byte av bil krockar med upprepande bokning'}]);
            return false;
          }
          // Check if the booking would fit if moved.
          const currentDateBooking = bookings.find(dcb =>
              dcb.car.id === currentCar && dcb.date === bookingDate
          );
          const {type: type2} = findOverlappingBooking(currentDateBooking.bookings, booking, existingBooking);
          if (type2 === "none") {
            setAlerts([{type: 'info', message: 'Byte av bil innebär att bokningar byter plats'}]);
            setBookingToSwap(booking);
          } else {
            setAlerts([{type: 'info', message: 'Byte av bil krockar med bokning som inte får plats'}]);
            return false;
          }
        }
      }
    }
    // If not editing it should always be OK to change
    return true;
  }

  function isDistanceRequired(): boolean {
    const range = cars.find(c => c.id == selectedCar)?.range;
    return range && range > 0 && !comment;
  }

  function updateBookingStartTime(value: string) {
    setBookingStartTime(value);
    if (!isMultiDay && (!bookingEndTime || (timeToNumber(bookingEndTime) < timeToNumber(value)))) {
      setBookingEndTime(value);
    }
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

        <div className="space-y-3">
        <CarSelector acceptChange={acceptCarChange} disabled={(isEditing && isRecurring) || isComitting}/>
        {bookingToSwap && (
            <Label className="indent-9 flex">Växlar bil på bokning {timeToString(bookingToSwap.startTime)}-{timeToString(bookingToSwap.endTime)} av {bookingToSwap.byUser.id}</Label>
        )}
        </div>
        <UserSelector disabled={isEditing && isRecurring}/>

        <div className="flex gap-2">
          <div className="space-y-2 flex-1 min-w-[10rem]">
            <Label>{isMultiDay ? 'Startdatum' : 'Datum'}</Label>
            <Input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                min={getBookingDate()}
                max={getBookingDate(undefined, 96)}
                disabled={isEditing && isRecurring}
                className="px-1.5 w-full appearance-none"
            />
          </div>
          <div className="flex-1 min-w-0">
            <TimeSelector
                label="Starttid"
                value={bookingStartTime}
                onChange={updateBookingStartTime}
                disabled={isEditing && isRecurring}
            />
          </div>
          {!isMultiDay && (
            <div className="flex-1 min-w-0">
              <TimeSelector
                  label="Sluttid"
                  value={bookingEndTime}
                  onChange={setBookingEndTime}
                  disabled={isEditing && isRecurring}
                  hourCount={25}
              />
            </div>
          )}
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

                {!isMultiDay && (
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
                )}

                {isMultiDay && (
                  <div className="flex gap-2 items-end">
                    <div className="space-y-2">
                      <Label>Slutdatum</Label>
                      <Input
                          type="date"
                          value={recurringEndDate}
                          onChange={(e) => setRecurringEndDate(e.target.value)}
                          min={getBookingDate(bookingDate, 1)}
                          max={getBookingDate(undefined, 96)}
                      />
                    </div>
                    <TimeSelector
                        label="Sluttid"
                        value={bookingEndTime}
                        onChange={setBookingEndTime}
                        hourCount={25}
                    />
                  </div>
                )}
              </div>
          )}

          <div className="flex gap-2">
            <DestinationSelector
                value={destination}
                onChange={setDestination}
                onDistanceChange={setDistance}
                disabled={isEditing && isRecurring}
            />

            <div className="flex flex-col space-y-2">
              <Label>Distans(km)</Label>
              <Input
                  type="number"
                  value={distance}
                  disabled={isEditing && isRecurring}
                  onChange={(e) => setDistance(e.target.value)}
                  required={isDistanceRequired()}
                  className="w-20"
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

          <div className="space-y-2">
            <Label>Kommentar</Label>
            <Input
                value={comment}
                disabled={isEditing && isRecurring}
                onChange={e => setComment(e.target.value)}
                className="w-full"
            />
          </div>

          <Button
              className="w-full"
              onClick={handleBooking}
              disabled={isComitting || !selectedCar || selectedUsers.length === 0 || !bookingStartTime || !bookingEndTime || (!distance && isDistanceRequired())}
          >
            {isEditing ? 'Spara ändringar' : 'Boka resa'}
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
