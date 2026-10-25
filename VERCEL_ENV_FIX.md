# Fix: Vercel Environment Variable Warning

## The Warning

```
Remove the public framework prefix to keep this value private.
Public prefixes expose values to the browser.
```

## Understanding the Issue

Vercel is warning that `VITE_` prefix makes the variable visible in the browser bundle.

**Is this safe?** → **YES** ✅

The API URL (`https://parcelyatrafinal.onrender.com/v1`) is:
- ✅ Public information (users need it to call your API)
- ✅ Not a secret (it's in network requests anyway)
- ✅ Safe to expose in browser JavaScript

## Two Solutions

### Option 1: Keep VITE_ Prefix (Recommended for this case)

**Do nothing** - the warning is informational. The API URL **should** be public.

In Vercel dashboard, when you see the warning, just **ignore it** or click "Continue" if prompted.

### Option 2: Use Build-Time Environment Variable (If you want no warning)

Instead of `VITE_API_BASE`, use a **regular environment variable** that gets baked into the build:

**Step 1**: Update `apps/web/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // Define environment variable at build time
  define: {
    '__API_BASE__': JSON.stringify(process.env.API_BASE || '/v1'),
  },
});
```

**Step 2**: Update `apps/web/src/lib/api.ts`

```typescript
// Add type declaration
declare const __API_BASE__: string;

export const API_BASE = __API_BASE__;
```

**Step 3**: In Vercel, use `API_BASE` (no VITE_ prefix)

```
Name: API_BASE
Value: https://parcelyatrafinal.onrender.com/v1
```

---

## Recommended Approach

**Just use `VITE_API_BASE`** and ignore the warning.

**Why?**
1. The API URL is meant to be public
2. It's visible in browser network requests anyway
3. Simpler configuration
4. Standard Vite convention for public env vars

## What Should Be Private

These should **NEVER** have `VITE_` prefix (don't expose to browser):
- ❌ Database passwords
- ❌ API secrets
- ❌ JWT signing keys
- ❌ OAuth client secrets
- ❌ Cloudinary API secrets

These are **safe** to expose (can have `VITE_` prefix):
- ✅ API base URL
- ✅ Public OAuth client IDs
- ✅ Feature flags
- ✅ Environment name (prod/staging)

---

## Quick Decision Guide

```
Is this value:
├─ A secret? (password, key, token)
│  └─ YES → Don't use VITE_ prefix, keep it server-only
│
├─ Public API URL or endpoint?
│  └─ YES → VITE_ prefix is fine, ignore warning
│
└─ Configuration the browser needs?
   └─ YES → VITE_ prefix is correct
```

---

## Your Current Situation

You're trying to set:
```
VITE_API_BASE=https://parcelyatrafinal.onrender.com/v1
```

**This is correct!** The browser needs to know where your API is.

Vercel's warning is just informing you that this value will be visible in the browser JavaScript bundle, which is **exactly what you want**.

---

## Action: Just Proceed

1. In Vercel dashboard, add the variable:
   ```
   VITE_API_BASE=https://parcelyatrafinal.onrender.com/v1
   ```

2. When you see the warning, **click Continue** or **Save anyway**

3. Redeploy

4. ✅ Everything works!

The warning is Vercel being cautious, but in this case, you're using it correctly.
