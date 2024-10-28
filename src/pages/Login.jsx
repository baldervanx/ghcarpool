import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

export function Login() {
  const signIn = async () => {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
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
