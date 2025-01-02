import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { House, Calendar, CalendarPlus, FileText, FilePlus } from 'lucide-react';

export function Navbar() {
  const location = useLocation();

  return (
    <nav className="border-b">
      <div className="container mx-auto px-2">
        <div className="flex items-center justify-between h-12">
          <div className="flex space-x-1">
            <Link to="/home">
              <Button className="flex items-center h-8 px-2"
                      variant={location.pathname === '/home' ? 'default' : 'ghost'}
              >
                <House size={32}/>
                {/*<span className="hidden md:inline">Hem</span>*/}
              </Button>
            </Link>
            <Link to="/book-trip">
              <Button className="flex items-center h-8 px-2"
                  variant={location.pathname === '/book-trip' ? 'default' : 'ghost'}
              >
                <CalendarPlus size={32}/>
                <span className="hidden md:inline">Boka</span>
              </Button>
            </Link>
            <Link to="/booking-overview">
              <Button className="flex items-center h-8 px-2"
                      variant={location.pathname === '/book-overview' ? 'default' : 'ghost'}
              >
                <Calendar size={32}/>
                <span className="hidden md:inline">Bokningar</span>
              </Button>
            </Link>
            <Link to="/register-trip">
              <Button className="flex items-center h-8 px-2"
                variant={location.pathname === '/register-trip' ? 'default' : 'ghost'}
              >
                <FilePlus size={32}/>
                <span className="hidden md:inline">Logga</span>
              </Button>
            </Link>
            <Link to="/trip-log">
              <Button className="flex items-center h-8 px-2"
                variant={location.pathname === '/trip-log' ? 'default' : 'ghost'}
              >
                <FileText size={32}/>
                <span className="hidden md:inline">Journal</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

