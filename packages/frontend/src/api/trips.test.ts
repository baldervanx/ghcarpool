/**
 * Testar api/trips.ts:
 *   tripsApi.list   → GET /trips
 *   tripsApi.create → POST /trips
 *   tripsApi.update → PUT /trips/:id
 *   tripsApi.delete → DELETE /trips/:id
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { TEST_TRIPS } from '@/test/handlers';
import { tripsApi } from './trips';

describe('tripsApi', () => {
  describe('list()', () => {
    it('returnerar trippar från GET /trips', async () => {
      const result = await tripsApi.list();
      expect(result).toEqual(TEST_TRIPS);
    });
  });

  describe('create()', () => {
    const payload = {
      carId: 'c1',
      odo: 87300,
      distance: 100,
      cost: 150,
      comment: 'Testresa',
      userIds: ['u1', 'u2'],
    };

    it('skapar en resa och returnerar TripDto', async () => {
      const result = await tripsApi.create(payload);
      expect(result.id).toBe('new-trip');
    });

    it('skickar korrekt payload i POST-body', async () => {
      let captured: unknown;
      server.use(
        http.post('/api/v1/trips', async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ id: 'new-trip', ...(captured as object) }, { status: 201 });
        }),
      );
      await tripsApi.create(payload);
      expect(captured).toMatchObject(payload);
    });

    it('skickar bookingId och parentId när resa kopplas till bokning', async () => {
      let captured: unknown;
      server.use(
        http.post('/api/v1/trips', async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ id: 'new-trip', ...(captured as object) }, { status: 201 });
        }),
      );
      await tripsApi.create({ ...payload, bookingId: 'b1', parentId: 'dcb1' });
      expect(captured).toMatchObject({ bookingId: 'b1', parentId: 'dcb1' });
    });
  });

  describe('update()', () => {
    const updatePayload = {
      odo: 87400,
      distance: 50,
      cost: 75,
      comment: 'Rättad resa',
      userIds: ['u1'],
    };

    it('uppdaterar en resa och returnerar uppdaterad TripDto', async () => {
      const result = await tripsApi.update('t1', updatePayload);
      expect((result as any).id).toBe('t1');
    });

    it('skickar korrekt id i URL och payload i body', async () => {
      let capturedUrl = '';
      let capturedBody: unknown;
      server.use(
        http.put('/api/v1/trips/:id', async ({ request, params }) => {
          capturedUrl = request.url;
          capturedBody = await request.json();
          return HttpResponse.json({ id: params.id, ...(capturedBody as object) });
        }),
      );
      await tripsApi.update('t1', updatePayload);
      expect(capturedUrl).toContain('/trips/t1');
      expect(capturedBody).toMatchObject(updatePayload);
    });
  });

  describe('delete()', () => {
    it('DELETE /trips/:id returnerar undefined (204)', async () => {
      const result = await tripsApi.delete('t1');
      expect(result).toBeUndefined();
    });

    it('sätter rätt id i URL', async () => {
      let capturedUrl = '';
      server.use(
        http.delete('/api/v1/trips/:id', ({ request }) => {
          capturedUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      await tripsApi.delete('trip-xyz');
      expect(capturedUrl).toContain('/trips/trip-xyz');
    });
  });
});
