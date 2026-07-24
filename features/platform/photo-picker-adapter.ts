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

const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 0.75;

async function selectPhoto(source: 'camera' | 'library'): Promise<PickedPhoto | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
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
  return new Promise((resolve) => {
    Alert.alert(
      copy.title,
      copy.body,
      [
        { text: copy.takePhoto, onPress: () => void selectPhoto('camera').then(resolve) },
        {
          text: copy.chooseFromLibrary,
          onPress: () => void selectPhoto('library').then(resolve),
        },
        { text: copy.cancel, style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

async function manipulate(photo: PickedPhoto, base64: boolean) {
  const longestSide = Math.max(photo.width, photo.height);
  const actions: ImageManipulator.Action[] = [];
  if (longestSide > MAX_DIMENSION_PX) {
    const scale = MAX_DIMENSION_PX / longestSide;
    actions.push({
      resize: {
        width: Math.round(photo.width * scale),
        height: Math.round(photo.height * scale),
      },
    });
  }
  return ImageManipulator.manipulateAsync(photo.uri, actions, {
    base64,
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
}

export const photoPickerAdapter: PhotoPickerAdapter = {
  pickPhoto,
  compressToBlob: async (photo) => {
    const result = await manipulate(photo, false);
    return (await fetch(result.uri)).blob();
  },
  compressToBase64: async (photo) => {
    const result = await manipulate(photo, true);
    if (!result.base64) throw new Error('image_compression_failed');
    return result.base64;
  },
};
