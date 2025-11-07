// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.ts',
        // Handle path aliases that match your vite.config.ts
        alias: {
            '@': resolve(__dirname, './src')
        },
        // Needed for Firebase SDK
        deps: {
            inline: ['@firebase/rules-unit-testing']
        }
    }
})
