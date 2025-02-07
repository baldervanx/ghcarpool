import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
} from '@tanstack/react-table';
import { format, addDays, isWeekend, isSameDay } from 'date-fns';
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
import BookingCell from "@/components/booking-cell"

const BookingOverview = () => {
  const navigate = useNavigate();
  const { cars } = useSelector(state => state.car);
  const { destinations } = useSelector(state => state.destination);
  const { bookings, loading } = useSelector(state => state.booking)
  const accessibleCn = useAccessibleCn();
  const daysPerPage = 14;
  const pageCount = 8;

  const [pagination, setPagination] = useState({
    pageIndex: 1, //initial page index
    pageSize: daysPerPage, //default page size
  });

  const dates = useMemo(() =>
          Array.from({ length: pagination.pageSize }, (_, i) =>
              addDays(new Date(), i + ((pagination.pageIndex - 1) * pagination.pageSize) - 1)
          ),
      [pagination]
  );

  const handleBookingClick = (booking) => {
    if (booking.id && booking.parent_id) {
      navigate('/book-trip', {state: {parent_id: booking.parent_id, booking_id: booking.id}});
    } else if (booking.car && booking.date) {
      navigate('/book-trip', {state: booking});
    }
  };

  const columns = useMemo(() => [
    {
      header: 'Datum',
      accessorKey: 'date',
      cell: ({ row }) => {
        const todayStyle = isSameDay(new Date(), row.original) ? 'darkorange' : undefined;
        return (
          <div className="font-medium whitespace-nowrap"
               style={{
                 backgroundColor: todayStyle
               }}
            >
            {format(row.original, 'dd/MM E', {locale: sv})}
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
            readOnly={pagination.pageIndex < 1}
            accessibleCn={accessibleCn}
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
    manualPagination: true,
    pageCount: pageCount, //One with past 2 weeks and 3 future months
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
  });

  if (loading) {
    return (
        <div className="w-full h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
    );
  }

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
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft className="h-4 w-4" />
          Föregående
        </Button>
        <Button
            variant="outline"
            size="sm"
            onClick={() => table.setPageIndex(1)}
        >
          <ChevronDown className="h-4 w-4" />
          Idag
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Nästa
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default BookingOverview;
