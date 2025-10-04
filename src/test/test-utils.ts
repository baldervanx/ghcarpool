// test/test-utils.ts
import { beforeAll } from 'vitest'

beforeAll(() => {
    // Set test environment variables
    process.env.VITE_FIREBASE_API_KEY = 'test-api-key'
    process.env.VITE_FIREBASE_PROJECT_ID = 'test-project'
    // ... other Firebase config variables
})
