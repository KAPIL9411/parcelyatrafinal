/**
 * Secret storage for the browser build.
 *
 * The native module behind this maps to the Keychain, which a browser does not have. The two keys
 * this app stores are not the same kind of thing, so they are not treated the same way here:
 *
 *  - `py.device_id` is a random label the server uses to list and revoke sessions for this install.
 *    It is not a credential — knowing it authorises nothing — but it must survive a reload, or every
 *    launch adds a phantom device to the user's session list and a restored cookie cannot be
 *    attributed to a device. It goes in `localStorage`.
 *  - `py.refresh_token` never reaches persistent storage. Writing a 30-day bearer-equivalent into a
 *    store that any script on the page can read is exactly the trade-off the HttpOnly `py_refresh`
 *    cookie exists to avoid, so the browser build keeps the cookie instead. `client-transport.web.ts`
 *    is what makes that sufficient: boot restores the session by asking `/v1/auth/refresh`, which
 *    the browser sends the cookie to on its own.
 *  - `py.profile` is the cached profile used to reopen the app offline. It is personal data, so it
 *    stays in memory for the tab and is gone on reload — the same rule the web preview has always
 *    held, and the reason a shared iPhone cannot read the previous user's name out of storage.
 */

const DEVICE_KEY = 'py.device_id';

/** Survives a launch; everything else this module is handed stays in memory. */
function isInstallIdentifier(key: string): boolean {
  return key === DEVICE_KEY;
}

const memory = new Map<string, string>();

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Safari in private mode throws on access rather than failing the write.
    return null;
  }
}

export async function readSecret(key: string): Promise<string | null> {
  if (isInstallIdentifier(key)) return store()?.getItem(key) ?? null;
  return memory.get(key) ?? null;
}

export async function writeSecret(key: string, value: string): Promise<void> {
  if (!isInstallIdentifier(key)) {
    memory.set(key, value);
    return;
  }
  try {
    store()?.setItem(key, value);
  } catch {
    // Quota or private mode: the install simply looks new again next launch.
  }
}

export async function deleteSecret(key: string): Promise<void> {
  if (!isInstallIdentifier(key)) {
    memory.delete(key);
    return;
  }
  store()?.removeItem(key);
}
