import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getAuth, signOut } from 'firebase/auth';

export function Navbar() {
  const location = useLocation();
  const auth = getAuth();

  return (
    <nav className="border-b">
      <div className="container mx-auto px-2">
        <div className="flex items-center justify-between h-12">
          <div className="flex space-x-2">
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
          <Button className="h-8"
            variant="outline"
            onClick={() => signOut(auth)}
          >
            Logga ut
          </Button>
        </div>
      </div>
    </nav>
  );
}
