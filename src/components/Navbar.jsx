import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { House } from 'lucide-react';

export function Navbar() {
  const location = useLocation();

  return (
    <nav className="border-b">
      <div className="container mx-auto px-2">
        <div className="flex items-center justify-between h-12">
          <div className="flex space-x-2">
            <Link to="/home">
              <Button className="h-8"
                variant={location.pathname === '/home' ? 'default' : 'ghost'}
              >
                <House/>
              </Button>
            </Link>
            <Link to="/register-trip">
              <Button className="h-8"
                variant={location.pathname === '/register-trip' ? 'default' : 'ghost'}
              >
                Logga
              </Button>
            </Link>
            <Link to="/trip-log">
              <Button className="h-8"
                variant={location.pathname === '/trip-log' ? 'default' : 'ghost'}
              >
                Journal
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
