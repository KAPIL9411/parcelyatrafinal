import { api, type UploadTicket } from './api';

export type UploadPurpose = 'kyc_id' | 'kyc_selfie' | 'parcel_sealed' | 'parcel_delivery' | 'dispute_evidence';

/**
 * Two-step upload: ask the API to authorise an object key, then write the bytes to the URL it
 * returns. In this build that URL is a local, authenticated sink (docs/BUILD_NOTES.md DEFECT-007);
 * the client does not need to know that.
 */
export async function uploadPhoto(file: File, purpose: UploadPurpose): Promise<string> {
  const ticket = await api.post<UploadTicket>('/files/upload-url', {
    purpose,
    content_type: file.type,
    byte_size: file.size,
  });
  await api.put(`/files/local-upload/${ticket.object_key}`, file, file.type);
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
