import * as ImagePicker from 'expo-image-picker';

export interface PickedPhoto {
  uri: string;
  contentType: 'image/jpeg' | 'image/png';
}

/**
 * One photo from the library. Used where either source is legitimate — an identity document that
 * was photographed earlier, or evidence attached after the fact.
 */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo access is off. Turn it on in Settings, then choose the photo again.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsMultipleSelection: false,
    exif: false,
  });

  return toPhoto(result);
}

/**
 * One photo taken with the camera. The camera opens directly, because a sealed-parcel photo is
 * evidence of the parcel as it is being handed over and must be taken now, not picked from the
 * library.
 */
export async function capturePhoto(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera access is off. Turn it on in Settings, then take the photo again.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    exif: false,
  });

  return toPhoto(result);
}

function toPhoto(result: ImagePicker.ImagePickerResult): PickedPhoto | null {
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const contentType =
    asset.mimeType === 'image/png' || asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { uri: asset.uri, contentType };
}
