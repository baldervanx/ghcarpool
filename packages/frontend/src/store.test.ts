import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import store, { fetchAuthState, setAuthState } from './store';

describe('runtime booking test mode', () => {
  it('loads the flag from the server on every auth initialization, not from cached settings', async () => {
    localStorage.clear();
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({
      id: 'u1', email: 'anna@example.com', isAdmin: false,
    })));
    for (const allowPastBookings of [true, false]) {
      server.use(http.get('/api/v1/config', () => HttpResponse.json({ allowPastBookings })));
      await store.dispatch(fetchAuthState());
      expect(store.getState().auth.allowPastBookings).toBe(allowPastBookings);
      expect(store.getState().auth.isMember).toBe(true);
    }
  });

  it('clears the flag when auth state is reset', () => {
    store.dispatch(setAuthState({ ...store.getState().auth, allowPastBookings: true }));
    store.dispatch(setAuthState({ user: null, isMember: false, loading: false }));
    expect(store.getState().auth.allowPastBookings).toBe(false);
  });
});
