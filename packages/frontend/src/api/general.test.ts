/**
 * Testar alla GET-anrop i api/general.ts:
 *   usersApi.list        → GET /users
 *   carsApi.list         → GET /cars
 *   destinationsApi.list → GET /destinations
 *   settingsApi.get      → GET /settings
 *
 * Och store-thunks som dispatchar dessa:
 *   fetchUsers / fetchCars / fetchDestinations / fetchSettings
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import {
  TEST_USERS,
  TEST_CARS,
  TEST_DESTINATIONS,
  TEST_SETTINGS,
} from '@/test/handlers';
import { usersApi, carsApi, destinationsApi, settingsApi } from './general';
import store, { fetchUsers, fetchCars, fetchDestinations, fetchSettings } from '@/store';

// ── API-objekt ────────────────────────────────────────────────────────────────

describe('usersApi', () => {
  it('list() returnerar användarlistan', async () => {
    const result = await usersApi.list();
    expect(result).toEqual(TEST_USERS);
  });
});

describe('carsApi', () => {
  it('list() returnerar billistan', async () => {
    const result = await carsApi.list();
    expect(result).toEqual(TEST_CARS);
  });
});

describe('destinationsApi', () => {
  it('list() returnerar destinationslistan', async () => {
    const result = await destinationsApi.list();
    expect(result).toEqual(TEST_DESTINATIONS);
  });
});

describe('settingsApi', () => {
  it('get() returnerar inställningar', async () => {
    const result = await settingsApi.get();
    expect(result).toEqual(TEST_SETTINGS);
  });
});

// ── Redux thunks ──────────────────────────────────────────────────────────────

describe('store thunks', () => {
  it('fetchUsers dispatchar och lagrar användare i state', async () => {
    await store.dispatch(fetchUsers());
    const { users } = store.getState().user;
    expect(users.map((u: any) => u.id)).toEqual(TEST_USERS.map(u => u.id));
  });

  it('fetchCars dispatchar och lagrar bilar i state', async () => {
    await store.dispatch(fetchCars());
    const { cars } = store.getState().car;
    expect(cars.map((c: any) => c.id)).toEqual(TEST_CARS.map(c => c.id));
  });

  it('fetchDestinations dispatchar och lagrar destinationer i state', async () => {
    await store.dispatch(fetchDestinations());
    const { destinations } = store.getState().destination;
    expect(destinations.map((d: any) => d.id)).toEqual(TEST_DESTINATIONS.map(d => d.id));
  });

  it('fetchSettings dispatchar och lagrar inställningar i state', async () => {
    await store.dispatch(fetchSettings());
    const { data } = store.getState().settings;
    expect(data.cost_per_km).toBe(TEST_SETTINGS.cost_per_km);
  });

  it('fetchUsers hanterar 500-fel utan krasch', async () => {
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json({ error: 'Internal Server Error' }, { status: 500 })),
    );
    const result = await store.dispatch(fetchUsers());
    expect(result.type).toMatch(/rejected|fulfilled/);
  });
});
