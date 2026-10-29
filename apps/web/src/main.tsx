import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import './index.css';

import { App } from './App';
import { SessionProvider } from './lib/session';
import { SyncBridge } from './lib/sync';
import { ApiError } from './lib/api';

/**
 * Query defaults are deliberately conservative: one retry, and never a retry on a 4xx because the
 * request itself was wrong. Refetching on window focus stays off at the default level — the
 * `SyncBridge` below decides what is stale from the server's change feed, which is both narrower
 * (only the families that changed) and safer for a handover screen than a blanket refetch. A
 * screen that must not reload mid-flow can still opt out per query.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <SyncBridge />
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
