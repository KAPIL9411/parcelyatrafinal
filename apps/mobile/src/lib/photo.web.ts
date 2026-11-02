/**
 * Photo capture for the browser build.
 *
 * `expo-image-picker` opens a native controller and needs camera and photo permissions the user can
 * later revoke in Settings. In Safari the equivalent is a file input: tapping it presents the same
 * iOS sheet with "Take Photo or Video / Photo Library / Browse", so the camera path is real rather
 * than simulated, and the browser's own consent replaces the permission request.
 *
 * The shape returned is the native module's, so every call site — sealed-parcel photos, handover
 * evidence, KYC documents, the profile selfie — uploads exactly as it does on Android. The `uri` is
 * a `blob:` URL, which `filesApi.upload` already knows how to read on web.
 */

// Type-only and explicitly `.ts`: this variant must borrow the declaration from the native module it
// replaces, and an extensionless specifier would resolve straight back to this file.
import type { PickedPhoto } from './photo.ts';

export type { PickedPhoto } from './photo.ts';

/** The API accepts `image/jpeg` and `image/png` and refuses anything larger than 10 MB. */
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png';

type Capture = 'environment' | 'user' | 'camera' | undefined;

function chooseImage(capture: Capture): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    // `capture` asks Safari for the camera directly. `environment` is the rear lens — a parcel or a
    // document; `user` is the front lens, which is what a selfie has to be. Omitting it lets the
    // browser offer the library as well, matching the native "pick from library" path.
    if (capture) input.setAttribute('capture', capture);
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.opacity = '0';

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      if (!file) return finish(null);
      if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
        finish(null);
        reject(new Error('That file is not a photo. Choose a JPEG or PNG image.'));
        return;
      }
      if (file.size > MAX_BYTES) {
        finish(null);
        reject(new Error('That photo is larger than 10 MB. Try a smaller one.'));
        return;
      }
      finish(file);
    };

    // Cancelling the picker fires `cancel` in Safari 16.4+/Chrome 102+ and nothing at all in older
    // engines. There is no reliable "dialog closed" signal in a browser, so the promise simply stays
    // pending there — harmless, because every call site awaits it to continue an upload.
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}

async function toPhoto(file: File | null): Promise<PickedPhoto | null> {
  if (!file) return null;
  return {
    uri: URL.createObjectURL(file),
    contentType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
  };
}

/** From the library or the camera — whichever the visitor chooses. */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  return toPhoto(await chooseImage(undefined));
}

/** The rear camera, for photographing a parcel or a document now. */
export async function capturePhoto(): Promise<PickedPhoto | null> {
  return toPhoto(await chooseImage('environment'));
}

/** The front camera only. A profile photo is a person claiming a face, not an album pick. */
export async function captureSelfie(): Promise<PickedPhoto | null> {
  return toPhoto(await chooseImage('user'));
}
