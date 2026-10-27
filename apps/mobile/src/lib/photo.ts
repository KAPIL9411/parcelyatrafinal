import * as ImagePicker from 'expo-image-picker';

export interface PickedPhoto {
  uri: string;
  contentType: 'image/jpeg' | 'image/png';
}

/**
 * One photo from the library. The app never asks for camera or location access for this; a photo of
 * a sealed parcel can be taken with the system camera first and picked here.
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

  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const contentType =
    asset.mimeType === 'image/png' || asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { uri: asset.uri, contentType };
}
