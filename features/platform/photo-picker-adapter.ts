import { Alert } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PickedPhoto = { uri: string; width: number; height: number };

export type PhotoPickerCopy = {
  title: string;
  body: string;
  takePhoto: string;
  chooseFromLibrary: string;
  cancel: string;
};

export type PhotoPickerAdapter = {
  pickPhoto: (copy: PhotoPickerCopy) => Promise<PickedPhoto | null>;
  compressToBlob: (photo: PickedPhoto) => Promise<Blob>;
  compressToBase64: (photo: PickedPhoto) => Promise<string>;
};

export class PhotoPickerPermissionDeniedError extends Error {
  readonly code = 'photo_permission_denied';

  constructor(readonly source: 'camera' | 'library') {
    super(`Photo permission denied for ${source}`);
    this.name = 'PhotoPickerPermissionDeniedError';
  }
}

const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 0.75;
const MAX_COMPRESSED_PHOTO_BYTES = 1_500_000;
const COMPRESSION_ATTEMPTS = [
  { quality: JPEG_QUALITY, scale: 1 },
  { quality: 0.65, scale: 0.9 },
  { quality: 0.55, scale: 0.8 },
  { quality: 0.45, scale: 0.7 },
  { quality: 0.35, scale: 0.6 },
] as const;

class PhotoCompressionTooLargeError extends Error {
  readonly code = 'file_too_large';

  constructor() {
    super('Compressed photo exceeds 1.5 MB');
    this.name = 'PhotoCompressionTooLargeError';
  }
}

async function selectPhoto(source: 'camera' | 'library'): Promise<PickedPhoto | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PhotoPickerPermissionDeniedError(source);
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  return asset
    ? {
        uri: asset.uri,
        width: asset.width ?? MAX_DIMENSION_PX,
        height: asset.height ?? MAX_DIMENSION_PX,
      }
    : null;
}

function pickPhoto(copy: PhotoPickerCopy): Promise<PickedPhoto | null> {
  return new Promise((resolve, reject) => {
    Alert.alert(
      copy.title,
      copy.body,
      [
        {
          text: copy.takePhoto,
          onPress: () => void selectPhoto('camera').then(resolve, reject),
        },
        {
          text: copy.chooseFromLibrary,
          onPress: () => void selectPhoto('library').then(resolve, reject),
        },
        { text: copy.cancel, style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

async function compressToBlob(photo: PickedPhoto): Promise<Blob> {
  const longestSide = Math.max(photo.width, photo.height);
  const baseScale = Math.min(1, MAX_DIMENSION_PX / longestSide);
  for (const attempt of COMPRESSION_ATTEMPTS) {
    const scale = baseScale * attempt.scale;
    const result = await ImageManipulator.manipulateAsync(
      photo.uri,
      [
        {
          resize: {
            width: Math.max(1, Math.round(photo.width * scale)),
            height: Math.max(1, Math.round(photo.height * scale)),
          },
        },
      ],
      {
        base64: false,
        compress: attempt.quality,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
    const blob = await (await fetch(result.uri)).blob();
    if (blob.size <= MAX_COMPRESSED_PHOTO_BYTES) return blob;
  }
  throw new PhotoCompressionTooLargeError();
}

async function compressToBase64(photo: PickedPhoto): Promise<string> {
  const longestSide = Math.max(photo.width, photo.height);
  const baseScale = Math.min(1, MAX_DIMENSION_PX / longestSide);
  for (const attempt of COMPRESSION_ATTEMPTS) {
    const scale = baseScale * attempt.scale;
    const result = await ImageManipulator.manipulateAsync(
      photo.uri,
      [
        {
          resize: {
            width: Math.max(1, Math.round(photo.width * scale)),
            height: Math.max(1, Math.round(photo.height * scale)),
          },
        },
      ],
      {
        base64: true,
        compress: attempt.quality,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
    if (!result.base64) throw new Error('image_compression_failed');
    if (decodedBase64ByteLength(result.base64) <= MAX_COMPRESSED_PHOTO_BYTES) {
      return result.base64;
    }
  }
  throw new PhotoCompressionTooLargeError();
}

export const photoPickerAdapter: PhotoPickerAdapter = {
  pickPhoto,
  compressToBlob,
  compressToBase64,
};
