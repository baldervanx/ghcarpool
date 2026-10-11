import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { Login } from './Login';

const { dispatch, fetchAuthState, navigate } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  fetchAuthState: vi.fn(() => ({ type: 'test/auth' })),
  navigate: vi.fn(),
}));
vi.mock('react-redux', () => ({ useDispatch: () => dispatch }));
vi.mock('../store', () => ({ fetchAuthState }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/login');
});
afterEach(() => cleanup());

describe('Login providers', () => {
  it('keeps local login and hides unconfigured providers', async () => {
    render(<Login />);
    expect(screen.getByLabelText('E-post')).toBeInTheDocument();
    expect(screen.getByLabelText('Lösenord')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByText('Logga in med SSO')).not.toBeInTheDocument();
    expect(screen.queryByText('Logga in med Google')).not.toBeInTheDocument();
  });

  it('shows configured providers at runtime and carries the deep-link target', async () => {
    server.use(http.get('/api/v1/auth/config', () =>
      HttpResponse.json({ local: true, google: true, oidc: true })));
    window.history.replaceState({}, '', '/login?returnTo=%2Fbook-trip%3Fcar%3DABC');
    render(<Login />);
    const sso = await screen.findByRole('link', { name: 'Logga in med SSO' });
    expect(sso).toHaveAttribute('href', '/api/v1/auth/oidc?returnTo=%2Fbook-trip%3Fcar%3DABC');
    expect(screen.getByRole('button', { name: 'Logga in med Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logga in' })).toBeInTheDocument();
  });

  it('shows a generic callback failure, not provider-controlled error text', () => {
    window.history.replaceState({}, '', '/login?error=oidc&error_description=secret');
    render(<Login />);
    expect(screen.getByRole('alert')).toHaveTextContent('SSO-inloggning misslyckades');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('reports provider configuration failure without disabling local login', async () => {
    server.use(http.get('/api/v1/auth/config', () => new HttpResponse(null, { status: 503 })));
    render(<Login />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Kunde inte hämta');
    expect(screen.getByRole('button', { name: 'Logga in' })).toBeEnabled();
  });

  it('retains local login, clears membership cache and refreshes auth state', async () => {
    let credentials: unknown;
    server.use(http.post('/api/v1/auth/login', async ({ request }) => {
      credentials = await request.json();
      return HttpResponse.json({ id: 'LOCAL', email: 'local@example.com', isAdmin: false });
    }));
    localStorage.setItem('user', 'stale-membership');
    render(<Login />);
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'local@example.com' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'test/auth' }));
    expect(credentials).toEqual({ email: 'local@example.com', password: 'password' });
    expect(localStorage.getItem('user')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/home', { replace: true });
  });

  it('restores the local-login pathname, query and hash before refreshing auth', async () => {
    server.use(http.post('/api/v1/auth/login', () =>
      HttpResponse.json({ id: 'LOCAL', email: 'local@example.com', isAdmin: false })));
    window.history.replaceState({}, '', `/login?${new URLSearchParams({
      returnTo: '/register-trip?car=ABC#details',
    })}`);
    render(<Login />);
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'local@example.com' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith('/register-trip?car=ABC#details', { replace: true });
    expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(dispatch.mock.invocationCallOrder[0]);
  });

  it.each([
    'https://evil.example/register-trip', '//evil.example/register-trip', '/\\evil.example',
    '/a/..//evil.example', '/a/%2e%2e//evil.example', '/login?returnTo=/register-trip',
    '/api/v1/auth/logout', '/health',
  ])('falls back to home after local login for unsafe returnTo %s', async (returnTo) => {
    server.use(http.post('/api/v1/auth/login', () =>
      HttpResponse.json({ id: 'LOCAL', email: 'local@example.com', isAdmin: false })));
    window.history.replaceState({}, '', `/login?${new URLSearchParams({ returnTo })}`);
    render(<Login />);
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'local@example.com' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home', { replace: true }));
  });

  it('displays local login rejection without refreshing auth state', async () => {
    server.use(http.post('/api/v1/auth/login', () =>
      HttpResponse.json({ error: 'Fel e-post eller lösenord' }, { status: 401 })));
    render(<Login />);
    fireEvent.change(screen.getByLabelText('E-post'), { target: { value: 'local@example.com' } });
    fireEvent.change(screen.getByLabelText('Lösenord'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Logga in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fel e-post eller lösenord');
    expect(dispatch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
