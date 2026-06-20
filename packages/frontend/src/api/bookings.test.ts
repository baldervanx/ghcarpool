/**
 * Testar api/bookings.ts:
 *   bookingsApi.list   → GET /bookings (med/utan datumfilter)
 *   bookingsApi.save   → POST /bookings
 *   bookingsApi.delete → DELETE /bookings/:parentId/:bookingId
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { TEST_BOOKINGS_RESPONSE } from '@/test/handlers';
import { bookingsApi } from './bookings';

describe('bookingsApi', () => {
  describe('list()', () => {
    it('hämtar bokningar utan datumfilter', async () => {
      const result = await bookingsApi.list();
      expect(result).toEqual(TEST_BOOKINGS_RESPONSE);
    });

    it('skickar startDate och endDate som query-parametrar', async () => {
      let capturedUrl = '';
      server.use(
        http.get('/api/v1/bookings', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(TEST_BOOKINGS_RESPONSE);
        }),
      );
      await bookingsApi.list('2026-06-01', '2026-06-30');
      expect(capturedUrl).toContain('startDate=2026-06-01');
      expect(capturedUrl).toContain('endDate=2026-06-30');
    });

    it('hanterar 401 med ApiError', async () => {
      server.use(
        http.get('/api/v1/bookings', () =>
          HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        ),
      );
      await expect(bookingsApi.list()).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('save()', () => {
    const payload = {
      date: '2026-06-25',
      carId: 'c1',
      startTime: 480,
      endTime: 540,
      distance: 20,
      userIds: ['u1'],
    };

    it('skapar en bokning och returnerar skapad DateCarBooking', async () => {
      const result = await bookingsApi.save(payload);
      expect(result.id).toBe('new-booking');
    });

    it('skickar korrekt payload i request-body', async () => {
      let captured: unknown;
      server.use(
        http.post('/api/v1/bookings', async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({ id: 'check', ...(captured as object) }, { status: 201 });
        }),
      );
      await bookingsApi.save(payload);
      expect(captured).toMatchObject(payload);
    });
  });

  describe('delete()', () => {
    it('DELETE /bookings/:parentId/:bookingId returnerar undefined (204)', async () => {
      const result = await bookingsApi.delete('dcb1', 'b1');
      expect(result).toBeUndefined();
    });

    it('sätter rätt URL-parametrar', async () => {
      let capturedUrl = '';
      server.use(
        http.delete('/api/v1/bookings/:parentId/:bookingId', ({ request }) => {
          capturedUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      await bookingsApi.delete('parent-99', 'booking-42');
      expect(capturedUrl).toContain('/bookings/parent-99/booking-42');
    });
  });
});
