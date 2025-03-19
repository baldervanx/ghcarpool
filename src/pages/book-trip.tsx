import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {db} from '@/db/firebase';
import {
  collection,
  doc,
  DocumentReference,
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
import {CarSelector} from '@/components/CarSelector';
import {useDispatch, useSelector} from 'react-redux';
import UserSelector from '@/components/UserSelector';
import type {AppStore, DateCarBooking, Booking} from '@/store';
import {setSelectedCar, setSelectedUsers} from '@/store';
import {format, isSameDay} from 'date-fns';
import {Info, OctagonAlert, TriangleAlert} from 'lucide-react';
import ConfirmationDialog from '@/components/confirmation-dialog';
import {TimeSelector} from "@/components/time-selector";
import {DestinationSelector} from "@/components/destination-selector";


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
          setComment(bookingData.comment || '');

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

  interface OverlappingBooking {
    type: string;
    booking?: Booking;
  }

  function findOverlappingBooking(bookings:Booking[], newBooking: BookingTimes, existingBookingId?: string, recurrenceId?: string): OverlappingBooking {
    // Filter out any old version of the booking, add the new one and sort.
    const sortedBookings = [...bookings]
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

        overlappingBookings.push({ booking, type });
      }
    }

    // Returnera rätt resultat baserat på antal överlappningar
    if (overlappingBookings.length === 0) {
      return { type: "none" };
    } else if (overlappingBookings.length === 1) {
      return overlappingBookings[0];
    } else {
      return { type: "multiple", booking: overlappingBookings[0].booking };
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
        if (isMultiDay || recurringDays.includes(dayToIndex(currentDate))) {
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
            const dateBookingsDoc = await transaction.get<DateCarBooking, DocumentReference>(validation.docRef);
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
            comment,
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

  const convertBookingBack = (booking: Booking): Booking => {
    const { parent_id, logged, ...rest } = booking; // Exclude parent_id and logged
    return {
      ...rest,
      users: booking.users.map(u => doc(db, 'users', u.id)),
      byUser: doc(db, 'users', booking.byUser.id),
    };
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
        let sourceDateBookingsDoc = (movingBooking || bookingToSwap) ? await transaction.get(doc(db, 'date-car-bookings', sourceDateBooking.id)) : undefined;

        const newBooking = {
          id: existingBooking || doc(collection(db, 'date-car-bookings')).id,
          users: selectedUsers.map(u => doc(db, 'users', u)),
          startTime: timeToNumber(startTime),
          endTime: timeToNumber(endTime),
          distance: Number(dist),
          destination,
          comment,
          byUser: doc(db, 'users', user.user_id)
        };

        if (targetDateBookingsDoc && targetDateBookingsDoc.exists()) {
          let existingBookings: Booking[] = targetDateBookingsDoc.data().bookings;
          // The swapped booking must be removed from target bookings before checking the overlap
          if (bookingToSwap) {
            existingBookings = existingBookings.filter(b => b.id !== bookingToSwap.id);
          }

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
        if (movingBooking || bookingToSwap) {
          let sourceBookings = sourceDateBookingsDoc.data().bookings;
          if (bookingToSwap) {
            sourceBookings.push(convertBookingBack(bookingToSwap));
          }
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

  const getFutureRecurrenceBookings = async (transaction: Transaction): Promise<DateCarBooking[]> => {
    const todayDate= format(new Date(), 'yyyy-MM-dd');
    const relevantBookingIds = bookings
        .filter(b =>
            b.car.id === selectedCar &&
            b.date >= todayDate &&
            b.bookings.some(b2 => b2.recurrenceId === recurrenceId)
        )
        .map(b => b.id);

    if (relevantBookingIds.length === 0) {
      return [];
    }
    const bookingsRef = collection(db, 'date-car-bookings');
    const fetchedBookings: DateCarBooking[] = [];

    for (const bookingId of relevantBookingIds) {
      const bookingDocRef = doc(bookingsRef, bookingId);
      const bookingSnapshot = await transaction.get(bookingDocRef);

      if (bookingSnapshot.exists()) {
        fetchedBookings.push({
          id: bookingSnapshot.id,
          ...bookingSnapshot.data(),
        } as DateCarBooking);
      }
    }
    return fetchedBookings;
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
          // Must fetch all real DateCarBookings before updating/deleting all of them.
          const recurrenceBookings = await getFutureRecurrenceBookings(transaction);
          recurrenceBookings.forEach(book => {
            const bookings = book.bookings;
            updateOrDeleteDateBooking(transaction, doc(db, 'date-car-bookings', book.id), bookings.filter(
                b => b.recurrenceId !== recurrenceId
            ));
          });
          const recurrenceRef = doc(db, 'recurrence', recurrenceId);
          transaction.delete(recurrenceRef);
        } else {
          const dateBooking = bookings.find(dcb =>
              dcb.car.id === selectedCar && dcb.date === bookingDate
          );
          if (dateBooking) {
            const dateBookingsDoc = await transaction.get(doc(db, 'date-car-bookings', dateBooking.id));
            updateOrDeleteDateBooking(transaction, doc(db, 'date-car-bookings', dateBooking.id), dateBookingsDoc.data().bookings.filter(
                b => b.id !== existingBooking
            ));
          }
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
    if (!bookingEndTime || (timeToNumber(bookingEndTime) < timeToNumber(value))) {
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
          <div className="space-y-2">
            <Label>Datum</Label>
            <Input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                min={getBookingDate()}
                max={getBookingDate(undefined, 96)}
                disabled={isEditing && isRecurring}
                className="px-1.5"
            />
          </div>
          <TimeSelector
              label="Starttid"
              value={bookingStartTime}
              onChange={updateBookingStartTime}
              disabled={isEditing && isRecurring}
          />
          <TimeSelector
              label="Sluttid"
              value={bookingEndTime}
              onChange={setBookingEndTime}
              disabled={isEditing && isRecurring}
              hourCount={25}
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
