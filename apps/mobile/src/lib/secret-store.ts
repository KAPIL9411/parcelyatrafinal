import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * The browser preview has no platform keystore. Rather than fall back to a script-readable store,
 * secrets stay in memory there, so a reload signs the user out. Nothing is written to localStorage
 * or sessionStorage, which is the rule the app has held since the first screen.
 */
const memory = new Map<string, string>();

export async function readSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return memory.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function writeSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    memory.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteSecret(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    memory.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
