import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAuthState } from '../store';

export function Login() {
  const dispatch = useDispatch<AppDispatch>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Inloggning misslyckades');
        return;
      }
      dispatch(fetchAuthState());
    } finally {
      setLoading(false);
    }
  };

  const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true';

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <Card className="p-6 w-80">
        <h1 className="text-2xl font-bold mb-6">Goda Händer Bilpool</h1>
        <form onSubmit={signIn} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="email">E-post</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Lösenord</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? 'Loggar in...' : 'Logga in'}
          </Button>
        </form>
        {googleEnabled && (
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => { window.location.href = '/api/v1/auth/google'; }}
          >
            Logga in med Google
          </Button>
        )}
      </Card>
    </div>
  );
}
