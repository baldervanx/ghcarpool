import React, {useEffect, useState} from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccessibility } from '@/lib/utils';
import { useTheme } from '@/components/theme-context';
import { Sun, Moon } from 'lucide-react';
import CarPoolCSVExporter from "@/components/ui/car-pool-csv-export";
import {useDispatch, useSelector} from "react-redux";
import {format} from "date-fns";
import {useNavigate} from "react-router-dom";
import { setSelectedCar } from '../store';

export const HomePage = () => {
  const { settings, updateSettings } = useAccessibility();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  useSelector(state => state.car);
  const { darkMode, toggleDarkMode } = useTheme();
  //const { trips, loading: tripsLoading } = useSelector(state => state.trip);
  const { bookings, loading: bookingsLoading } = useSelector(state => state.booking);
  const { user, loading: userLoading } = useSelector(state => state.auth);
  const [ activeBookings, setActiveBookings ] = useState([]);
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
              carId: dayBooking.car.id
            }))
        );
    const currentUserBookings = flatBookings
        .filter(booking =>
            booking.users.some(user => user.id === currentUser)
        );
    setActiveBookings(currentUserBookings);
  }, [bookings, user]);

  // FIXME: Move duplicated code to utility
  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins != 0) return `${hours}:${mins.toString().padStart(2, '0')}`;
    return hours.toString();
  }

  function logBooking(booking) {
    dispatch(setSelectedCar(booking.carId));
    navigate('/register-trip');
  }

  //FIXME: Non-unique key on booking cards
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">

        {!userLoading && !bookingsLoading && (
            activeBookings.map((booking) => (
                <Card key={booking.carId}>
                  <CardHeader>
                    <CardTitle>Bokat {booking.carId}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <span>{`Tid: ${timeToString(booking.startTime)}-${timeToString(booking.endTime)}`}</span>
                    <Button
                        variant="outline"
                        onClick={() => logBooking(booking)}
                    >
                      Logga
                    </Button>
                  </CardContent>
                </Card>
            ))
        )}

        {(userLoading || bookingsLoading) && (
            <div className="flex items-center justify-center min-h-screen">Laddar...</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Inställningar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
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
        </Card>

        <div className="flex gap-4 mb-8">
          <Button
              variant="outline"
              onClick={() => signOut(auth)}
          >
            Logga ut
          </Button>
        </div>

        <CarPoolCSVExporter/>
      </div>
    </div>
  );
};
