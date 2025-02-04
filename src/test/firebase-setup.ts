// test/firebase-setup.ts
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { vi } from 'vitest'

export async function setupTestEnvironment() {
    const testEnv = await initializeTestEnvironment({
        projectId: 'test-project',
        firestore: {
            host: 'localhost',
            port: 8080,
        }
    })

    // Mock Firebase Auth
    vi.mock('firebase/auth', () => ({
        getAuth: () => ({
            currentUser: { uid: 'test-user-123' }
        }),
        signInWithEmailAndPassword: vi.fn()
    }))

    return testEnv
}
