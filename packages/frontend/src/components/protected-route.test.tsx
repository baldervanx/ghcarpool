import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import store, { setAuthState } from '@/store';
import { ProtectedRoute } from './protected-route';

function LoginLocation() {
  const location = useLocation();
  return <div>{new URLSearchParams(location.search).get('returnTo')}</div>;
}

describe('ProtectedRoute', () => {
  it('preserves the entire deep link when authentication is missing or expired', () => {
    store.dispatch(setAuthState({ user: null, isMember: false, loading: false }));
    render(<Provider store={store}><MemoryRouter initialEntries={['/register-trip?car=c1#booking']}>
      <Routes>
        <Route path="/register-trip" element={<ProtectedRoute><div>Protected</div></ProtectedRoute>} />
        <Route path="/login" element={<LoginLocation />} />
      </Routes>
    </MemoryRouter></Provider>);
    expect(screen.getByText('/register-trip?car=c1#booking')).toBeInTheDocument();
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('renders the protected route for authenticated members', () => {
    store.dispatch(setAuthState({
      user: { uid: 'u1', user_id: 'u1', email: 'me@example.com', isAdmin: false },
      isMember: true, loading: false,
    }));
    render(<Provider store={store}><MemoryRouter><ProtectedRoute><div>Protected</div></ProtectedRoute></MemoryRouter></Provider>);
    expect(screen.getByText('Protected')).toBeInTheDocument();
  });
});
