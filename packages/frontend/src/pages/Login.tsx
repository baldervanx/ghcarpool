import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { AppDispatch } from '../store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAuthState } from '../store';
import { api, ApiError } from '@/api/client';

interface AuthConfig {
  local: boolean;
  google: boolean;
  oidc: boolean;
}

function localReturnTo(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/home';
  const url = new URL(value, 'https://return.invalid');
  if (url.origin !== 'https://return.invalid' || url.pathname.startsWith('//') ||
      url.pathname === '/login' || url.pathname === '/api' ||
      url.pathname.startsWith('/api/') || url.pathname === '/health') return '/home';
  return `${url.pathname}${url.search}${url.hash}`;
}

export function Login() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(
    new URLSearchParams(window.location.search).get('error') === 'oidc'
      ? 'SSO-inloggning misslyckades. Kontot måste redan finnas och ha verifierad e-post vid första inloggningen.'
      : '',
  );
  const [loading, setLoading] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    let active = true;
    api.get<AuthConfig>('/auth/config')
      .then((config) => { if (active) setAuthConfig(config); })
      .catch(() => {
        if (active) setConfigError('Kunde inte hämta tillgängliga SSO-inloggningar. Ladda om sidan för att försöka igen.');
      });
    return () => { active = false; };
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/login', { email, password });
      // Rensa localStorage-cachen så att fetchAuthState alltid hämtar
      // en färsk användarlista från backend efter inloggning. Utan detta
      // kan en gammal/ogiltig cache göra att isMember=false och man
      // hamnar tillbaka på inloggningssidan trots lyckad autentisering.
      localStorage.removeItem('user');
      // Navigate before the auth refresh can unmount the login router.
      navigate(localReturnTo(returnTo), { replace: true });
      dispatch(fetchAuthState());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunde inte ansluta. Försök igen.');
    } finally {
      setLoading(false);
    }
  };

  const authBase = `${import.meta.env.VITE_API_URL ?? '/api/v1'}/auth`;
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');
  const oidcUrl = `${authBase}/oidc${returnTo ? `?${new URLSearchParams({ returnTo })}` : ''}`;

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
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? 'Loggar in...' : 'Logga in'}
          </Button>
        </form>
        {configError && <p role="alert" className="text-red-500 text-sm mt-3">{configError}</p>}
        {authConfig?.oidc && (
          <Button asChild variant="outline" className="mt-3 w-full">
            <a href={oidcUrl} onClick={() => localStorage.removeItem('user')}>Logga in med SSO</a>
          </Button>
        )}
        {authConfig?.google && (
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => {
              localStorage.removeItem('user');
              window.location.href = `${authBase}/google`;
            }}
          >
            Logga in med Google
          </Button>
        )}
      </Card>
    </div>
  );
}
