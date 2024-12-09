import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
} from '@tanstack/react-table';
import { format, addDays, isWeekend, startOfDay, isSameDay } from 'date-fns';
import { sv } from 'date-fns/locale';
import { collection, query, getDocs, where, orderBy } from 'firebase/firestore';
import { db } from '@/db/firebase';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {useSelector} from "react-redux";

// TODO: Add short-name of destination, when the destinations are cached in store.
const BookingCell = ({ bookings, onClick }) => {
  if (!bookings || bookings.length === 0) return null;

  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins != 0) return `${hours}:${mins.toString().padStart(2, '0')}`;
    return hours.toString();
  }

  return (
    <div className="space-y-0.5">
      {bookings.map((booking) => (
        <div
          key={booking.id}
          onClick={() => onClick(booking)}
          className="min-w-[16ch] bg-primary/10 dark:bg-primary/20 p-1 rounded text-xs cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors"
        >
          {`${booking.users.map(u => u.id).join(', ')} ${timeToString(booking.startTime)}-${timeToString(booking.endTime)}` +
              (booking.distance ? ` (${Math.round(booking.distance/10)})` : ``) +
              (booking.destination ? ` ${booking.destination}` : ``)
          }
        </div>
      ))}
    </div>
  );
};

// TODO: It should be possible to show past bookings. But then as read-only.
const BookingOverview = ({ onEditBooking }) => {
  const navigate = useNavigate();
  const { cars } = useSelector(state => state.car);
  const [bookings, setBookings] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const daysPerPage = 14;

  useEffect(() => {
    const fetchBookings = async () => {
      const startDate = startOfDay(new Date());
      const endDate = addDays(startDate, daysPerPage);

      const q = query(
          collection(db, 'date-car-bookings'),
          where('date', '>=', format(startDate, 'yyyy-MM-dd')),
          where('date', '<', format(endDate, 'yyyy-MM-dd'))
      );

      const snapshot = await getDocs(q);
      const bookingsData = snapshot.docs.flatMap(doc => {
        const { date, car, bookings } = doc.data();
        return bookings.map(booking => ({
          ...booking,
          date,
          car,
          parent_id: doc.id
        }));
      }).sort((a, b) => a.startTime - b.startTime);

      setBookings(bookingsData);
    };
    fetchBookings();
  }, [currentPage]);

  const dates = useMemo(() =>
    Array.from({ length: daysPerPage }, (_, i) =>
      addDays(new Date(), i + (currentPage * daysPerPage))
    ),
    [currentPage, daysPerPage]
  );

  const handleBookingClick = (booking) => {
    navigate('/book-trip', { state: { parent_id: booking.parent_id, booking_id: booking.id } });
  };

  const columns = useMemo(() => [
    {
      header: 'Datum',
      accessorKey: 'date',
      cell: ({ row }) => (
        <div className="font-medium whitespace-nowrap">
          {format(row.original, 'dd/MM E',  {locale: sv})}
        </div>
      ),
      meta: {
        isSticky: true,
        width: '10ch'
      }
    },
    ...cars.map(car => ({
      header: car.name,
      accessorKey: car.id,
      cell: ({ row }) => {
        const dateBookings = bookings.filter(booking =>
          booking.car.id === car.id &&
          isSameDay(new Date(booking.date), row.original)
        );
        return (
          <BookingCell
            bookings={dateBookings}
            onClick={handleBookingClick}
          />
        );
      }
    }))
  ], [cars, bookings]);

  const table = useReactTable({
    data: dates,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="w-full">
      <div className="rounded-md border">
        <div className="overflow-x-auto relative">
          <Table className="[&_tr_td]:p-1 [&_tr_th]:p-1">
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {table.getFlatHeaders().map(header => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "bg-background",
                      header.column.columnDef.meta?.isSticky && "sticky left-0 z-20"
                    )}
                    style={{
                      left: header.column.columnDef.meta?.isSticky ? 0 : undefined,
                      width: header.column.columnDef.meta?.width,
                      background: header.column.columnDef.meta?.isSticky ? 'hsl(var(--background))' : undefined
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map(row => (
                <TableRow
                  key={row.id}
                  className={cn(
                    isWeekend(row.original) && "bg-muted/50"
                  )}
                >
                  {row.getVisibleCells().map(cell => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        cell.column.columnDef.meta?.isSticky ? "sticky left-0" : "min-w-[16ch]"
                      )}
                      style={{
                        left: cell.column.columnDef.meta?.isSticky ? 0 : undefined,
                        width: cell.column.columnDef.meta?.width,
                        background: cell.column.columnDef.meta?.isSticky ?
                          isWeekend(row.original) ? 'hsl(var(--muted))' : 'hsl(var(--background))'
                          : undefined
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
          disabled={currentPage === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          Föregående
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(p => p + 1)}
        >
          Nästa
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default BookingOverview;
