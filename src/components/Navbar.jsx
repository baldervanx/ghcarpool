import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getAuth, signOut } from 'firebase/auth';

export function Navbar() {
  const location = useLocation();
  const auth = getAuth();

  return (
    <nav className="border-b">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex space-x-4">
            <Link to="/register-trip">
              <Button 
                variant={location.pathname === '/register-trip' ? 'default' : 'ghost'}
              >
                Registrera resa
              </Button>
            </Link>
            <Link to="/trip-log">
              <Button 
                variant={location.pathname === '/trip-log' ? 'default' : 'ghost'}
              >
                Körjournal
              </Button>
            </Link>
          </div>
          <Button 
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