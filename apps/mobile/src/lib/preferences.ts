/**
 * Small, non-secret preferences that should survive a restart.
 *
 * `expo-secure-store` is for tokens, and putting a city name in the platform keystore would be both
 * slower and misleading about what is sensitive. `expo-file-system` is already a dependency, so this
 * uses the same storage shape as the homepage cache: a JSON file on native, memory on the web preview
 * (the web shim has no `File` implementation).
 *
 * Every failure is swallowed. A preference that cannot be read is a default; a preference that cannot
 * be written is a slower next launch, never an error the user sees.
 */
import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

const FOLDER = 'prefs';
const FILE = 'prefs.v1.json';

type Bag = Record<string, string>;

let memory: Bag = {};

function prefFile(): File {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return new File(directory, FILE);
}

async function readBag(): Promise<Bag> {
  if (Platform.OS === 'web') return memory;
  try {
    const file = prefFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(await file.text()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const bag: Bag = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') bag[key] = value;
    }
    return bag;
  } catch {
    return {};
  }
}

async function writeBag(bag: Bag): Promise<void> {
  if (Platform.OS === 'web') {
    memory = bag;
    return;
  }
  try {
    const file = prefFile();
    file.create({ intermediates: true, overwrite: true });
    await file.write(JSON.stringify(bag));
  } catch {
    // Read-only or full storage: the app still works, it just forgets.
  }
}

export async function readPreference(key: string): Promise<string | null> {
  const bag = await readBag();
  return bag[key] ?? null;
}

export async function writePreference(key: string, value: string | null): Promise<void> {
  const bag = await readBag();
  if (value === null || value === '') {
    if (!(key in bag)) return;
    delete bag[key];
  } else {
    bag[key] = value;
  }
  await writeBag(bag);
}
