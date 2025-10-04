import React, {useEffect, useState} from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useAccessibility } from '@/lib/utils';
import type { TextSize } from "@/lib/utils";
import { useTheme } from '@/components/theme-context';
import { Sun, Moon } from 'lucide-react';
import CarPoolCSVExporter from "@/components/ui/car-pool-csv-export";
import HelpDialog from '@/components/help-dialog';
import {useSelector} from "react-redux";
import {format} from "date-fns";
import {useNavigate} from "react-router-dom";
import type {AppStore, Booking, Car} from '@/store';

interface BookingCar extends Booking {
  car: Car
}

export const HomePage = () => {
  const { settings, updateSettings } = useAccessibility();
  const navigate = useNavigate();
  const { cars } = useSelector((state: AppStore) => state.car);
  const { darkMode, toggleDarkMode } = useTheme();
  //const { trips, loading: tripsLoading } = useSelector((state: AppStore) => state.trip);
  const { bookings, loading: bookingsLoading } = useSelector((state: AppStore) => state.booking);
  const { user, loading: userLoading } = useSelector((state: AppStore) => state.auth);
  const [ activeBookings, setActiveBookings ] = useState<BookingCar[]>([]);
  const auth = getAuth();

  useEffect(() => {
    // Find all bookings for today
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const currentDayBookings = bookings.filter(b => b.date === dateStr);
    const currentUser = user.user_id;
    // Find bookings where current user is booked
    const flatBookings = currentDayBookings
        .flatMap(dayBooking =>
            dayBooking.bookings.map(booking => ({
              ...booking,
              // Would be a bit more efficient to do this later.
              car: cars.find(c => c.id === dayBooking.car.id)
            }))
        ).filter(booking =>
            booking.users.some(user => user.id === currentUser)
        );
    const sortedBookings = flatBookings.sort((a, b) => {
      if (a.logged && !b.logged) return 1;
      if (!a.logged && b.logged) return -1;
      return a.startTime - b.startTime;
    });
    setActiveBookings(sortedBookings);
  }, [bookings, user]);

  // FIXME: Move duplicated code to utility
  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }

  function logBooking(booking: BookingCar) {
    navigate('/register-trip', { state: { booking: booking } });
  }

  function changeBooking(booking: BookingCar) {
    navigate('/book-trip', { state: { parent_id: booking.parent_id, booking_id: booking.id } });
  }

  function bookingStatus(booking: BookingCar): string {
    // Can perhaps use time to give more details in the title.
    return booking.logged ? "Kört" : "Bokat";
  }

  // TODO: Must check if the booking is multi-day and then display that properly,
  //  also see if the booking is past, ongoing or in the future.
  //  The bookings should be sorted:
  //      1. past booking that hasn't been logged at the top (include such bookings from yesterday)
  //      2. ongoing booking that will need to be logged soon
  //      3. coming bookings later the same day
  //      4. past bookings that has been logged, just remaining there to confirm that it was booked.
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-4">

        {!userLoading && !bookingsLoading && (
            activeBookings.map((booking) => (
                <Card key={booking.id}>
                  <CardHeader className="py-4">
                    <CardTitle className="text-xl">{`${bookingStatus(booking)} ${booking.car.name}`}</CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{`Tid: ${timeToString(booking.startTime)}-${timeToString(booking.endTime)}`}</span>
                    </div>
                    {!booking.logged && (
                          <div className="flex items-center justify-between">
                          {(booking.car.hasLog ?? true) && (
                            <Button variant="outline"
                              onClick={() => logBooking(booking)}
                            >
                              Logga
                            </Button>
                          )}
                          <Button variant="outline"
                            onClick={() => changeBooking(booking)}
                          >
                            Ändra
                          </Button>
                          </div>
                    ) || (
                        <span className="font-bold">Loggad</span>
                    )}
                  </CardContent>
                </Card>
          ))
          )}

        {(userLoading || bookingsLoading) && (
            <div className="w-full h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )}

        {/* This card should be collapsed (accordion?) by default, as it is not that frequently used. */}
        <Accordion type="single" collapsible>
          <AccordionItem value="settings">
            <AccordionTrigger className="py-0">
              <CardHeader className="p-3 space-y-3">
                <CardTitle className="text-xl">Inställningar</CardTitle>
              </CardHeader>
            </AccordionTrigger>
            <AccordionContent>
              <CardContent className="p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Hög kontrast</span>
                  <Button
                      variant="outline"
                      onClick={() => updateSettings({isHighContrast: !settings.isHighContrast})}
                  >
                    {settings.isHighContrast ? 'På' : 'Av'}
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium">Textstorlek</span>
                  <Select
                      value={settings.textSize}
                      onValueChange={(value) => updateSettings({textSize: value as TextSize})}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Välj textstorlek"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal text</SelectItem>
                      <SelectItem value="large">Stor text</SelectItem>
                      <SelectItem value="larger">Större text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium">Mörkt/Ljust läge</span>
                  <Button
                      variant="outline"
                      onClick={toggleDarkMode}
                      size="icon"
                  >
                    {darkMode ? <Sun size={20}/> : <Moon size={20}/>}
                  </Button>
                </div>
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-4 mb-8">
          <Button
              variant="outline"
              onClick={() => signOut(auth)}
          >
            Logga ut
          </Button>
        </div>

        {(user.isAdmin) && (
            <CarPoolCSVExporter/>
        )}

        <HelpDialog />
      </div>
    </div>
  );
};
