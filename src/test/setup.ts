// src/test/setup.ts
//import '@testing-library/jest-dom'
import { vi, beforeAll } from 'vitest'
import { connectFirestoreEmulator } from 'firebase/firestore'
import { db } from '@/db/firebase'

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
})

// Connect to Firebase emulator
beforeAll(() => {
    connectFirestoreEmulator(db, 'localhost', 8080)
})
