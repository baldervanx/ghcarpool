import React, { useState } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch
} from 'firebase/firestore';
import { db } from '@/db/firebase';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, RefreshCw, Wrench } from 'lucide-react';
import { format } from 'date-fns';

type AffectedBooking = {
  bookingDocumentId: string;
  bookingId: string;
  date: string;
  carName: string;
  bookedBy: string;
};

const getReferenceId = (reference: unknown): string | undefined => {
  if (typeof reference === 'string') return reference;
  if (reference && typeof reference === 'object' && 'id' in reference) {
    return (reference as { id?: string }).id;
  }
  return undefined;
};

const AdminTrips = () => {
  const [affectedBookings, setAffectedBookings] = useState<AffectedBooking[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const findAffectedBookings = async (): Promise<AffectedBooking[]> => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const [bookingSnapshot, recurrenceSnapshot, carSnapshot, userSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'date-car-bookings'), where('date', '>=', today))),
      getDocs(collection(db, 'recurrence')),
      getDocs(collection(db, 'cars')),
      getDocs(collection(db, 'users'))
    ]);

    const recurrenceIsMultiDay = new Map(
      recurrenceSnapshot.docs.map(recurrenceDoc => [
        recurrenceDoc.id,
        recurrenceDoc.data().isMultiDay
      ])
    );
    const carNames = new Map(
      carSnapshot.docs.map(carDoc => [carDoc.id, carDoc.data().name || carDoc.id])
    );
    const userNames = new Map(
      userSnapshot.docs.map(userDoc => [
        userDoc.id,
        userDoc.data().shortName || userDoc.data().email || userDoc.id
      ])
    );

    return bookingSnapshot.docs.flatMap(bookingDoc => {
        const data = bookingDoc.data();
        const carId = getReferenceId(data.car);
        const carName = carNames.get(carId) || carId || 'Okänd bil';

        return data.bookings
          .filter(booking =>
            booking.recurrenceId &&
            booking.logged &&
            recurrenceIsMultiDay.get(booking.recurrenceId) === false
          )
          .map(booking => {
            const userId = getReferenceId(booking.byUser);
            return {
              bookingDocumentId: bookingDoc.id,
              bookingId: booking.id,
              date: data.date,
              carName,
              bookedBy: userNames.get(userId) || userId || 'Okänd användare'
            };
          });
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.carName.localeCompare(b.carName));
  };

  const scanBookings = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setAffectedBookings(await findAffectedBookings());
      setHasScanned(true);
    } catch (error) {
      console.error('Error scanning recurring bookings:', error);
      setErrorMessage('Kunde inte läsa framtida återkommande bokningar.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRepairBookings = async () => {
    setIsRepairing(true);
    setErrorMessage(null);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const [bookingSnapshot, recurrenceSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'date-car-bookings'), where('date', '>=', today))),
        getDocs(collection(db, 'recurrence'))
      ]);
      const recurringIds = new Set(
        recurrenceSnapshot.docs
          .filter(recurrenceDoc => recurrenceDoc.data().isMultiDay === false)
          .map(recurrenceDoc => recurrenceDoc.id)
      );

      const updates = bookingSnapshot.docs
        .map(bookingDoc => {
          const data = bookingDoc.data();
          const updatedBookings = data.bookings.map(booking => {
            const shouldClearLogged =
              booking.recurrenceId &&
              recurringIds.has(booking.recurrenceId) &&
              booking.logged;

            if (!shouldClearLogged) return booking;

            const { logged, ...bookingWithoutLogged } = booking;
            return bookingWithoutLogged;
          });

          return {
            ref: doc(db, 'date-car-bookings', bookingDoc.id),
            bookings: updatedBookings,
            changed: updatedBookings.some((booking, index) => booking !== data.bookings[index])
          };
        })
        .filter(update => update.changed);

      for (let index = 0; index < updates.length; index += 500) {
        const batch = writeBatch(db);
        updates.slice(index, index + 500).forEach(update => {
          batch.update(update.ref, { bookings: update.bookings });
        });
        await batch.commit();
      }

      setAffectedBookings([]);
      setHasScanned(true);
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Error repairing recurring bookings:', error);
      setErrorMessage('Kunde inte reparera de återkommande bokningarna.');
    } finally {
      setIsRepairing(false);
    }
  };

  const affectedBookingCount = affectedBookings.length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Reparera återkommande bokningar</h2>
          <p className="text-sm text-muted-foreground">
            Tar bort felaktig loggning från framtida recurring-bokningar.
          </p>
        </div>
        <Button onClick={scanBookings} disabled={isLoading || isRepairing} variant="outline">
          <RefreshCw className="mr-2" />
          {isLoading ? 'Söker ...' : 'Sök igen'}
        </Button>
      </div>

      <Alert variant="warning">
        <AlertTriangle size={16} />
        <AlertDescription>
          Verktyget ändrar alla framtida bokningar som tillhör en recurrence med
          <code className="mx-1">isMultiDay=false</code> och har ett
          <code className="mx-1">logged</code>-fält. Multi-day-bokningar påverkas inte.
        </AlertDescription>
      </Alert>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {hasScanned && (
        <div className="border border-amber-700 bg-amber-50 text-amber-950 p-4 rounded space-y-3">
          {affectedBookingCount === 0
            ? 'Inga felaktigt loggade framtida recurring-bokningar hittades.'
            : <>
                <p className="font-semibold">
                  {affectedBookingCount} bokning{affectedBookingCount === 1 ? '' : 'ar'} hittades.
                </p>
                <div className="overflow-x-auto rounded border border-amber-700 bg-white text-gray-950">
                  <table className="w-full text-sm">
                    <thead className="bg-amber-100 text-left text-amber-950">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Bil</th>
                        <th className="px-3 py-2 font-semibold">Datum</th>
                        <th className="px-3 py-2 font-semibold">Bokad av</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affectedBookings.map(booking => (
                        <tr
                          key={`${booking.bookingDocumentId}-${booking.bookingId}`}
                          className="border-t border-gray-200"
                        >
                          <td className="px-3 py-2">{booking.carName}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{booking.date}</td>
                          <td className="px-3 py-2">{booking.bookedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>}
        </div>
      )}

      <div className="flex justify-end">
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              onClick={scanBookings}
              disabled={isLoading || isRepairing}
            >
              <Wrench className="mr-2" /> Reparera hittade bokningar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reparera recurring-bokningar?</AlertDialogTitle>
              <AlertDialogDescription>
                Detta tar bort logged från {affectedBookingCount} framtida recurring-bokningar.
                Åtgärden kan inte ångras.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRepairBookings}
                disabled={isRepairing || isLoading || affectedBookingCount === 0}
              >
                {isRepairing ? 'Reparerar ...' : 'Reparera'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default AdminTrips;
