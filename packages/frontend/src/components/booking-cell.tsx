import React, { useState, useRef, useCallback, useEffect } from 'react';
import {Repeat, Check} from 'lucide-react';
import type { Booking, Destination } from '@/store';

export interface CarDate {
  car: string, date: Date
}

export interface BookingCellParam {
  bookings: Booking[],
  car: string,
  date: Date,
  destinations: Destination[],
  onClick: ({}: Booking | CarDate) => void,
  readOnly: boolean,
  accessibleCn: any //TODO: Type
}

const BookingCell = ({ bookings, car, date, destinations, onClick, readOnly, accessibleCn}: BookingCellParam) => {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const maxDrag = 60; // pixels

  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins != 0) return `${hours}:${mins.toString().padStart(2, '0')}`;
    return hours.toString();
  }


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventScroll = (e: TouchEvent) => {
      if (isDragging) {
        e.stopPropagation();
        e.preventDefault();
        const currentX = e.touches[0].clientX;
        const diff = startX.current - currentX;

        const offset = Math.min(Math.max(diff, 0), maxDrag);
        setDragOffset(offset);
      }
    };

    container.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      container.removeEventListener('touchmove', preventScroll);
    };
  }, [isDragging]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (readOnly) return;
    startX.current = e.touches[0].clientX;
    setIsDragging(true);
  }, [readOnly]);

  const handleTouchEnd = useCallback(() => {
    if (readOnly) return;
    setIsDragging(false);
    // If dragOffset after breakpoint then complete the drag automatically
    // If it is less, then let it slide back
    const breakpoint = maxDrag * 0.4;
    if (dragOffset > breakpoint) {
      setDragOffset(maxDrag);
    } else {
      setDragOffset(0);
    }
  }, [dragOffset, onClick, car, date, readOnly]);

  if (!bookings || bookings.length === 0) {
    return (
      <div
        onClick={() => !readOnly && onClick({car, date})}
        className={accessibleCn("min-w-[14ch] bg-opacity-100 p-1 rounded cursor-pointer hover:bg-primary/10 dark:hover:bg-primary/10 transition-colors")}
      >
        &nbsp;
      </div>
    );
  }

  const timesToString = (booking: Booking) => {
    const result = timeToString(booking.startTime) + '-' + timeToString(booking.endTime);
    return result === '0-24' ? '' : result;
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative overflow-hidden"
    >
      {!readOnly && (
        <div
          className="absolute right-0 top-0 bottom-0 flex items-center z-0 bg-primary/20"
          style={{ width: '60px' }}
        >
          <div onClick={() => !readOnly && onClick({car, date})}
               className="mx-auto text-primary/50 text-xl">+</div>
        </div>
      )}
      <div
        className="relative z-10 transition-transform duration-500 bg-white dark:bg-gray-800"
        style={{ transform: `translateX(-${dragOffset}px)` }}
      >
        <div className="space-y-0.5">
          {bookings.map((booking) => (
            <div
              key={booking.id}
              onClick={() => !readOnly && !booking.logged && onClick(booking)}
              className={accessibleCn(`min-w-[14ch] bg-gray-100 dark:bg-gray-700 p-1 text-xs ${!readOnly && !booking.logged ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600' : 'cursor-default opacity-70'} transition-colors flex justify-between items-center`)}
            >
              <div className="flex flex-col">
                <span>
                {`${booking.users.filter(u => u.id != 'NO').map(u => u.id).join(', ')} ${timesToString(booking)}` +
                  (booking.distance ? ` (${Math.round(booking.distance / 10)})` : ``) +
                  `${booking.destination ? ' ' + (destinations.find(d => d.id === booking.destination)?.shortName ?? booking.destination) : ''}`
                }
                </span>
                {booking.comment && (<span className="italic">{booking.comment}</span>)}
              </div>
              {(booking.recurrenceId || booking.logged) && (
                <div className="flex items-center">
                  {(booking.recurrenceId && !booking.logged) && (
                      <Repeat size={12}/>
                  ) || (
                      <Check size={12}/>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BookingCell;
