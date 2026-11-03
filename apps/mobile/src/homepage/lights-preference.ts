/**
 * The device's own answer to the light string.
 *
 * This is a display preference, not a secret and not account data, so it lives in the same documents
 * directory as the homepage cache instead of the keychain. The rules match that cache: a missing or
 * unreadable file is simply "no choice yet", and a failed write costs a remembered toggle, never the
 * screen.
 */
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

const FOLDER = 'homepage';
const FILE = 'lights.v1.json';

let memory: boolean | null = null;

function preferenceFile(): File {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return new File(directory, FILE);
}

export async function readLightsPreference(): Promise<boolean | null> {
  if (Platform.OS === 'web') return memory;
  try {
    const file = preferenceFile();
    if (!file.exists) return null;
    const parsed: unknown = JSON.parse(await file.text());
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = (parsed as { lights?: unknown }).lights;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

export async function writeLightsPreference(lights: boolean): Promise<void> {
  if (Platform.OS === 'web') {
    memory = lights;
    return;
  }
  try {
    const file = preferenceFile();
    file.create({ intermediates: true, overwrite: true });
    await file.write(JSON.stringify({ lights }));
  } catch {
    // A read-only or full filesystem must not stop the toggle from working for this session.
  }
}
