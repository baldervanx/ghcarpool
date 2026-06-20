// Login.jsx
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useDispatch } from 'react-redux';
import { fetchAuthState, setAuthState } from '../store';

export function Login() {
  const dispatch = useDispatch();

  const signIn = async () => {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      dispatch(fetchAuthState());
    } catch (error) {
      console.error('Login error:', error);
      dispatch(setAuthState({ user: null, isMember: false, loading: false }));
    }
  };

  return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <Card className="p-6">
          <h1 className="text-2xl font-bold mb-6">Goda Händer Bilpool</h1>
          <Button onClick={signIn}>
            Logga in med Google
          </Button>
        </Card>
      </div>
  );
}
