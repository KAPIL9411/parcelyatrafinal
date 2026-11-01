/**
 * Keep-alive ping to prevent backend cold starts on Render/Cloudflare Workers.
 * Pings the health endpoint every 10 minutes when app is active.
 */

import { API_BASE } from '../api/client.ts';

let keepAliveTimer: NodeJS.Timeout | null = null;
let isActive = false;

async function ping() {
  if (!isActive) return;
  
  try {
    // Ping health endpoint to keep server warm
    await fetch(`${API_BASE}/health`, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
    });
    console.log('[KeepAlive] Server pinged successfully');
  } catch (err) {
    console.warn('[KeepAlive] Ping failed:', err);
  }
}

/**
 * Start keep-alive pings when app becomes active.
 * Call this in your root layout when app mounts.
 */
export function startKeepAlive() {
  if (keepAliveTimer) return; // Already running
  
  isActive = true;
  
  // Initial ping
  void ping();
  
  // Ping every 10 minutes (600,000 ms)
  keepAliveTimer = setInterval(() => {
    void ping();
  }, 10 * 60 * 1000);
  
  console.log('[KeepAlive] Started');
}

/**
 * Stop keep-alive pings when app is backgrounded or closed.
 */
export function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  isActive = false;
  console.log('[KeepAlive] Stopped');
}

/**
 * Perform a one-time warm-up ping at app startup.
 * This ensures the server is ready before the user tries to sign in.
 */
export async function warmupServer(): Promise<void> {
  try {
    console.log('[KeepAlive] Warming up server...');
    await fetch(`${API_BASE}/health`, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
      signal: AbortSignal.timeout(15000), // 15s timeout for warmup
    });
    console.log('[KeepAlive] Server is warm');
  } catch (err) {
    console.warn('[KeepAlive] Warmup failed, server may be cold:', err);
  }
}
