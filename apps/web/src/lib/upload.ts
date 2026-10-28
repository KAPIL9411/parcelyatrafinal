import { api, type UploadTicket } from './api';

export type UploadPurpose =
  | 'kyc_id'
  | 'kyc_selfie'
  | 'parcel_sealed'
  | 'parcel_delivery'
  | 'dispute_evidence'
  | 'campaign_art';

/**
 * Two-step upload: ask the API to authorise an object key, then write the bytes to the URL it
 * returns. The ticket is the contract — the client follows it instead of guessing the sink path,
 * so the storage provider can change without a web redeploy.
 */
export async function uploadPhoto(file: File, purpose: UploadPurpose): Promise<string> {
  const ticket = await api.post<UploadTicket>('/files/upload-url', {
    purpose,
    content_type: file.type,
    byte_size: file.size,
  });
  // The ticket URL is absolute (it names the API origin); the request helper joins paths onto
  // API_BASE, so keep only the path part after the `/files/` marker.
  const sinkPath = ticket.upload_url.slice(ticket.upload_url.indexOf('/files/'));
  await api.put(sinkPath, file, file.type);
  return ticket.object_key;
}

/** A 1x1 PNG. Used only by development builds to exercise the upload path without a camera. */
const SAMPLE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function sampleImage(name = 'sample.png'): File {
  const binary = atob(SAMPLE_PNG);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
}
