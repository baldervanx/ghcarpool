import React, {useState, useMemo, useEffect, useRef} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
} from '@tanstack/react-table';
import {
  format,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isWeekend,
  isSameDay,
  startOfDay,
  differenceInMonths,
  isSameMonth,
  subMonths, isToday
} from 'date-fns';
import { sv } from 'date-fns/locale';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {ChevronDown, ChevronLeft, ChevronRight} from "lucide-react";
import {cn, useAccessibleCn} from "@/lib/utils";
import {useSelector} from "react-redux";
import BookingCell, {CarDate} from "@/components/booking-cell"
import type {AppStore, Booking} from '@/store';

const BookingOverview = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { cars } = useSelector((state: AppStore) => state.car);
  const { destinations } = useSelector((state: AppStore) => state.destination);
  const { bookings, loading } = useSelector((state: AppStore) => state.booking);
  const accessibleCn = useAccessibleCn();
  const tableRef = useRef(null);
  const todayRowRef = useRef(null);
  const pageCount = 6; // Visa 6 månader
  const [pagination, setPagination] = useState({
    pageIndex: 1, // 1 = nuvarande månad (0 = föregående månad)
    pageSize: 1, // 1 månad per sida
  });

  // Bestäm den aktuella månaden baserat på sidnumret
  const currentMonth = useMemo(() =>
          addMonths(startOfMonth(new Date()), pagination.pageIndex - 1),
      [pagination.pageIndex]
  );

  // Beräkna föregående och nästa månad för knapparna
  const prevMonth = useMemo(() => subMonths(currentMonth, 1), [currentMonth]);
  const nextMonth = useMemo(() => addMonths(currentMonth, 1), [currentMonth]);

  // Använd location.state för att navigera till specifikt datum
  useEffect(() => {
    if (location.state && location.state.date) {
      const selectedDate = new Date(location.state.date);
      const monthDiff = differenceInMonths(selectedDate, startOfMonth(new Date()));
      setPagination({pageIndex: monthDiff + 1, pageSize: 1}); // +1 eftersom nuvarande månad är index 1
    }
  }, [location.state]);

  // Skapa datumlista för hela aktuella månaden
  const dates = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [currentMonth]);

  // Funktion för att scrolla till dagens datum
  const scrollToToday = () => {
    if (!tableRef.current) return;
    const scrollContainer = tableRef.current.parentElement;

    if (todayRowRef.current && isSameMonth(new Date(), currentMonth)) {
      const todayRow = todayRowRef.current;

      const tableElement: Element = tableRef.current;

      if (scrollContainer) {
        // Beräkna positionen för att rada 2 (efter header) ska vara dagens datum
        const tableHeader = tableElement.firstChild;
        // @ts-ignore
        const headerHeight = tableHeader ? tableHeader.offsetHeight : 0;
        //const rowHeight = todayRow.offsetHeight;

        const todayRowTop = todayRow.getBoundingClientRect().top;
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const relativeTop = todayRowTop - containerTop;

        // Scrolla så att dagens datum hamnar på andra raden (efter tabellhuvudet)
        scrollContainer.scrollTop = scrollContainer.scrollTop + relativeTop - headerHeight;
      }
    } else {
      scrollContainer.scrollTop = 0;
    }
  };

  // Scrolla till dagens datum när data laddats
  useEffect(() => {
    if (!loading && isSameMonth(new Date(), currentMonth)) {
      setTimeout(scrollToToday, 100);
    }
  }, [loading, dates, currentMonth]);

  const handleBookingClick = (booking: Booking | CarDate) => {
    if ("id" in booking && booking.id && "parent_id" in booking && booking.parent_id) {
      navigate('/book-trip', {state: {parent_id: booking.parent_id, booking_id: booking.id}});
    } else if ("car" in booking && booking.car && booking.date) {
      navigate('/book-trip', {state: booking});
    }
  };

  const today = startOfDay(new Date());

  const columns = useMemo(() => [
    {
      header: () => (
          <div className="font-semibold items-center capitalize">
            {format(currentMonth, 'MMM', {locale: sv})}
          </div>
      ),
      accessorKey: 'date',
      cell: ({ row }) => {
        return (
            <div className="font-medium whitespace-nowrap">
              {format(row.original, 'dd E', {locale: sv})}
            </div>
        );
      },
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
        ).flatMap(b => b.bookings).sort((a, b) => a.startTime - b.startTime);
        return (
            <BookingCell
                bookings={dateBookings}
                car={car.id}
                date={row.original}
                destinations={destinations}
                onClick={handleBookingClick}
                readOnly={row.original < addDays(today, -14)}
                accessibleCn={accessibleCn}
            />
        );
      }
    }))
  ], [cars, bookings, currentMonth]);

  const table = useReactTable({
    data: dates,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
    pageCount: pageCount,
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
  });

  // Hantera klick på "Idag"-knappen
  const handleTodayClick = () => {
    setPagination({pageIndex: 1, pageSize: 1});
    // Vänta tills state uppdaterats innan scrollning
    setTimeout(scrollToToday, 100);
  };

  const handleNextClick = () => {
    table.nextPage();
    // Vänta tills state uppdaterats innan scrollning
    setTimeout(scrollToToday, 100);
  };

  const handlePrevClick = () => {
    table.previousPage();
    // Vänta tills state uppdaterats innan scrollning
    setTimeout(scrollToToday, 100);
  };

  if (loading) {
    return (
        <div className="w-full h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
    );
  }

  function calcCellBg(isSticky: boolean | undefined, date: Date): string | undefined {
    if (isSticky) {
      if (isToday(date)) {
        return "darkorange";
      }
      return isWeekend(date) ? 'hsl(var(--muted))' : 'hsl(var(--background))';
    }
    return undefined;
  }

  return (
      <div className="flex flex-col w-full max-h-[calc(100vh-80px)]">
        <Table ref={tableRef} className="[&_tr_td]:p-1 [&_tr_th]:p-1">
          <TableHeader className="sticky text-base top-0 bg-background z-40">
            <TableRow>
              {table.getFlatHeaders().map(header => (
                  <TableHead
                      key={header.id}
                      className={cn(
                          "h-auto",
                          "bg-background",
                          header.column.columnDef.meta?.isSticky && "sticky left-0 z-30"
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
                    ref={isToday(row.original) ? todayRowRef : null}
                >
                  {row.getVisibleCells().map(cell => (
                      <TableCell
                          key={cell.id}
                          className={cn(
                              cell.column.columnDef.meta?.isSticky ? "sticky left-0 z-30" : "min-w-[16ch]"
                          )}
                          style={{
                            left: cell.column.columnDef.meta?.isSticky ? 0 : undefined,
                            width: cell.column.columnDef.meta?.width,
                            background: calcCellBg(cell.column.columnDef.meta?.isSticky, row.original)
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

        {/* Navigationsknappar separerade från tabellen så de alltid syns */}
        <div className="flex items-center justify-end space-x-2 py-4 mt-auto">
          <Button
              variant="outline"
              size="sm"
              onClick={handlePrevClick}
              disabled={!table.getCanPreviousPage()}
              className="capitalize"
          >
            <ChevronLeft className="h-4 w-4" />
            {format(prevMonth, 'MMMM', {locale: sv})}
          </Button>
          <Button
              variant="outline"
              size="sm"
              onClick={handleTodayClick}
          >
            <ChevronDown className="h-4 w-4" />
            Idag
          </Button>
          <Button
              variant="outline"
              size="sm"
              onClick={handleNextClick}
              disabled={!table.getCanNextPage()}
              className="capitalize"
          >
            {format(nextMonth, 'MMMM', {locale: sv})}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
  );
};

export default BookingOverview;
