import { act } from '@testing-library/react-native';
import { DeviceEventEmitter, type ScrollView, type View } from 'react-native';

type MeasureCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
  pageX: number,
  pageY: number,
) => void;

/** Every mocked host view of `type` measures as `[pageY, pageY + height]` on the page. */
export function measureHostViewsAs(
  type: typeof View | typeof ScrollView,
  pageY: number,
  height: number,
) {
  return jest
    .spyOn(type.prototype as { measure: (callback: MeasureCallback) => void }, 'measure')
    .mockImplementation((callback: MeasureCallback) => callback(0, 0, 390, height, 0, pageY));
}

// The component-test platform is iOS, where the keyboard announces itself with
// will-show / will-hide. A zero duration skips the layout animation.
export async function showKeyboard(screenY: number, height: number) {
  await act(() => {
    DeviceEventEmitter.emit('keyboardWillShow', {
      duration: 0,
      easing: 'keyboard',
      endCoordinates: { screenX: 0, screenY, width: 390, height },
    });
  });
}

export async function hideKeyboard() {
  await act(() => {
    DeviceEventEmitter.emit('keyboardWillHide', {
      duration: 0,
      easing: 'keyboard',
      endCoordinates: { screenX: 0, screenY: 844, width: 390, height: 0 },
    });
  });
}
