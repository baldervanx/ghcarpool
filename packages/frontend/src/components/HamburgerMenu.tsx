import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, AlertTriangle, Receipt, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Stäng vid klick utanför
  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        className="[&_svg]:size-8 h-12 px-1"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Stäng meny' : 'Öppna meny'}
      >
        {open ? <X size={32} /> : <Menu size={32} />}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-background shadow-lg z-50">
          <Link
            to="/error-log"
            className="flex items-center gap-2 px-4 py-3 hover:bg-muted text-sm"
            onClick={() => setOpen(false)}
          >
            <AlertTriangle size={18} /> Fellogg
          </Link>
          <Link
            to="/expenses"
            className="flex items-center gap-2 px-4 py-3 hover:bg-muted text-sm"
            onClick={() => setOpen(false)}
          >
            <Receipt size={18} /> Utlägg
          </Link>
          <Link
            to="/car-info"
            className="flex items-center gap-2 px-4 py-3 hover:bg-muted text-sm"
            onClick={() => setOpen(false)}
          >
            <Car size={18} /> Bilinfo
          </Link>
        </div>
      )}
    </div>
  );
}
