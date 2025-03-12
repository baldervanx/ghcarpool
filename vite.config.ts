import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [react(), visualizer({ filename: 'bundle-stats.json', template: "raw-data", gzipSize: true })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Introduces error, need further analysis.
  // build: {
  //   rollupOptions: {
  //     output: {
  //       manualChunks(id) {
  //         // External dependencies in separate files.
  //         if (id.includes('node_modules')) {
  //           if (id.includes('react')) return 'react';
  //           if (id.includes('firebase/auth')) return 'fire-auth';
  //           if (id.includes('firebase/firestore')) return 'firestore';
  //           return 'vendor';
  //         }
  //       }
  //     }
  //   }
  // }
})

