import React, { useState, useRef, useCallback, useEffect } from 'react';

const BookingCell = ({ bookings, car, date, destinations, onClick, readOnly, accessibleCn}) => {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

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

        const maxDrag = 60; // pixels
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
  }, [dragOffset, onClick, car, date, readOnly]);

  if (!bookings || bookings.length === 0) {
    return (
      <div
        onClick={() => !readOnly && onClick({car, date})}
        className={accessibleCn("min-w-[16ch] bg-opacity-100 p-1 rounded cursor-pointer hover:bg-primary/10 dark:hover:bg-primary/10 transition-colors")}
      >
        &nbsp;
      </div>
    );
  }

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
        className="relative z-10 transition-transform duration-300 bg-white dark:bg-gray-800"
        style={{ transform: `translateX(-${dragOffset}px)` }}
      >
        <div className="space-y-0.5">
          {bookings.map((booking) => (
            <div
              key={booking.id}
              onClick={() => !readOnly && onClick(booking)}
              className={accessibleCn("min-w-[16ch] bg-gray-100 dark:bg-gray-700 p-1 text-xs cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors")}
            >
              {`${booking.users.map(u => u.id).join(', ')} ${timeToString(booking.startTime)}-${timeToString(booking.endTime)}` +
                (booking.distance ? ` (${Math.round(booking.distance / 10)})` : ``) +
                ` ${booking.destination ? (destinations.find(d => d.id === booking.destination)?.shortName || booking.destination) : ''}`
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BookingCell;
