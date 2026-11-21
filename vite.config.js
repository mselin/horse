// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Mika Selin
import { defineConfig } from 'vite';


export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: import.meta.dirname + '/index.html',
      },
    },
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
});
