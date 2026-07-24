import type {
  PhotoPickerAdapter,
  PhotoPickerCopy,
  PickedPhoto,
} from './photo-picker-adapter';

const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 0.75;

export function resolveCompressedPhotoSize(
  photo: PickedPhoto
): Pick<PickedPhoto, 'width' | 'height'> {
  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(photo.width, photo.height));
  return {
    width: Math.round(photo.width * scale),
    height: Math.round(photo.height * scale),
  };
}

export async function resolveBrowserPhoto(
  file: File | undefined,
  deps: {
    createObjectUrl: (file: File) => string;
    readDimensions: (uri: string) => Promise<{ width: number; height: number }>;
    revokeObjectUrl: (uri: string) => void;
  }
): Promise<PickedPhoto | null> {
  if (!file) return null;
  const uri = deps.createObjectUrl(file);
  try {
    const dimensions = await deps.readDimensions(uri);
    return { uri, ...dimensions };
  } catch {
    deps.revokeObjectUrl(uri);
    return null;
  }
}

function pickPhoto(_copy: PhotoPickerCopy): Promise<PickedPhoto | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    let settled = false;
    let focusTimer: number | undefined;
    const settle = (photo: PickedPhoto | null) => {
      if (settled) return;
      settled = true;
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
      window.removeEventListener('focus', onWindowFocus);
      resolve(photo);
    };
    const resolveSelection = async () => {
      settle(
        await resolveBrowserPhoto(input.files?.[0], {
          createObjectUrl: (file) => URL.createObjectURL(file),
          readDimensions: (uri) =>
            new Promise((resolveDimensions, rejectDimensions) => {
              const image = new Image();
              image.onload = () =>
                resolveDimensions({ width: image.naturalWidth, height: image.naturalHeight });
              image.onerror = rejectDimensions;
              image.src = uri;
            }),
          revokeObjectUrl: (uri) => URL.revokeObjectURL(uri),
        })
      );
    };
    const onWindowFocus = () => {
      focusTimer = window.setTimeout(() => {
        if (!input.files?.length) settle(null);
      }, 100);
    };
    input.addEventListener('change', () => void resolveSelection(), { once: true });
    input.addEventListener('cancel', () => settle(null), { once: true });
    window.addEventListener('focus', onWindowFocus, { once: true });
    input.click();
  });
}

async function compress(photo: PickedPhoto): Promise<Blob> {
  try {
    const image = new Image();
    image.src = photo.uri;
    await image.decode();
    const size = resolveCompressedPhotoSize(photo);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas_unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) throw new Error('image_compression_failed');
    return blob;
  } finally {
    URL.revokeObjectURL(photo.uri);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'));
    reader.readAsDataURL(blob);
  });
}

export const photoPickerAdapter: PhotoPickerAdapter = {
  pickPhoto,
  compressToBlob: compress,
  compressToBase64: async (photo) => blobToBase64(await compress(photo)),
};
