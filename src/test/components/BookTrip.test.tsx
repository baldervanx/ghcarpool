// src/components/BookTrip.test.tsx

// Example test file using the page object
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createStore } from '@/store';
import BookTrip from '@/pages/book-trip';

import { describe, beforeAll, beforeEach, afterAll, it, expect } from 'vitest'
import { setupTestEnvironment } from '@/test/firebase-setup'
import { BookTripPage } from './BookTrip.page'

describe('BookTrip Integration Tests', () => {
    let testEnv;
    let initialState;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'my-test-project',
            firestore: {
                host: 'localhost',
                port: 8080
            }
        });

        // Prepare initial state with test data
        initialState = {
            auth: {
                user: { user_id: 'test-user-123' }
            },
            car: {
                selectedCar: 'test-car-001'
            },
            user: {
                selectedUsers: ['test-user-123']
            },
            destination: {
                destinations: [
                    {
                        id: 'test-destination-001',
                        name: 'Test Destination',
                        shortName: 'TD',
                        distance: 50
                    }
                ]
            }
        };
    });

    afterAll(async () => {
        await testEnv.cleanup();
    });

    // Wrapper component to provide context
    const TestWrapper = ({ children, initialState }) => {
        //FIXME: This is not how it's done.
        const store = createStore(initialState);

        return (
            <Provider store={store}>
                <MemoryRouter>
                    {children}
                </MemoryRouter>
            </Provider>
        );
    };

    it('creates a single booking successfully', async () => {
        const page = BookTripPage.render(
            <TestWrapper initialState={initialState}>
                <BookTrip />
            </TestWrapper>,
            initialState
        );

        await page
            .setDate('2024-03-01')
            .setStartTime('10', '00')
            .setEndTime('12', '00')
            .setDestination('Test Destination')
            .setDistance('50')
            .submitBooking()
            .expectSuccessfulBooking();
    });

    it('prevents overlapping bookings', async () => {
        const page = BookTripPage.render(
            <TestWrapper initialState={initialState}>
                <BookTrip />
            </TestWrapper>,
            initialState
        );

        await page
            .setDate('2024-03-01')
            .setStartTime('11', '00')
            .setEndTime('13', '00')
            .setDestination('Test Destination')
            .setDistance('50')
            .submitBooking()
            .expectBookingError('krockar med annan bokning');
    });

    it('creates a recurring booking', async () => {
        const page = BookTripPage.render(
            <TestWrapper initialState={initialState}>
                <BookTrip />
            </TestWrapper>,
            initialState
        );

        await page
            .setDate('2024-03-05')
            .setStartTime('10', '00')
            .setEndTime('12', '00')
            .setDestination('Test Destination')
            .setDistance('50')
            .enableRecurringBooking()
            .selectRecurringDays(['Tis', 'Tor'])
            .setRecurringEndDate('2024-03-31')
            .submitBooking()
            .expectSuccessfulBooking();
    });
});
