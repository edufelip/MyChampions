import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  requireIosCameraFrameAuthRequestId,
  selectIosCameraObservationMode,
  shouldAttachIosCameraFrameSource,
} from '../../scripts/testing/capture-native-testability';

void test('generic camera auth observations stay UI-only before the verified boundary', async () => {
  assert.equal(
    shouldAttachIosCameraFrameSource({ charter: 'camera-denied', mode: 'generic' }),
    false,
  );
  assert.equal(
    requireIosCameraFrameAuthRequestId({ mode: 'generic', authRequestId: undefined }),
    undefined,
  );

  const source = await readFile(
    path.resolve(__dirname, '../../scripts/testing/capture-native-testability.ts'),
    'utf8',
  );
  const passwordPrelude = source.indexOf("'password-save-prompt'");
  const initialAuth = source.indexOf('report.cameraInitialAuth');
  const explicitGate = source.indexOf('const cameraFrameSource = shouldAttachIosCameraFrameSource');
  assert.ok(passwordPrelude >= 0);
  assert.ok(initialAuth > passwordPrelude);
  assert.ok(explicitGate >= 0);
  assert.match(source, /const observeCamera = async/);
  assert.match(source, /observe: observeCamera/);
});

void test('camera denial wiring keeps capture-only generic and integrated strict', async () => {
  const captureOnlyMode = selectIosCameraObservationMode(false);
  assert.equal(captureOnlyMode, 'generic');
  assert.equal(
    shouldAttachIosCameraFrameSource({ charter: 'camera-denied', mode: captureOnlyMode }),
    false,
  );
  assert.equal(
    requireIosCameraFrameAuthRequestId({ mode: captureOnlyMode, authRequestId: undefined }),
    undefined,
  );

  const integratedMode = selectIosCameraObservationMode(true);
  assert.equal(integratedMode, 'authenticated-camera');
  assert.equal(
    shouldAttachIosCameraFrameSource({ charter: 'camera-denied', mode: integratedMode }),
    true,
  );
  assert.equal(requireIosCameraFrameAuthRequestId({ mode: integratedMode, authRequestId: 17 }), 17);

  const source = await readFile(
    path.resolve(__dirname, '../../scripts/testing/capture-native-testability.ts'),
    'utf8',
  );
  assert.match(
    source,
    /const cameraObservationMode = selectIosCameraObservationMode\(cameraIntegration\)/,
  );
  assert.match(source, /observe: cameraObserver/);
});

void test('only an explicitly authenticated camera observation may carry auth provenance', () => {
  assert.equal(
    shouldAttachIosCameraFrameSource({ charter: 'camera-denied', mode: 'authenticated-camera' }),
    true,
  );
  assert.equal(
    requireIosCameraFrameAuthRequestId({ mode: 'authenticated-camera', authRequestId: 42 }),
    42,
  );
  assert.throws(
    () =>
      requireIosCameraFrameAuthRequestId({
        mode: 'authenticated-camera',
        authRequestId: undefined,
      }),
    /Camera frame source identity is unavailable/,
  );
  assert.throws(
    () => requireIosCameraFrameAuthRequestId({ mode: 'authenticated-camera', authRequestId: 0 }),
    /Camera frame source identity is unavailable/,
  );
});

void test('camera account switching keeps generic observations until the new boundary is recorded', async () => {
  const source = await readFile(
    path.resolve(__dirname, '../../scripts/testing/capture-native-testability.ts'),
    'utf8',
  );
  const cameraBranch = source.indexOf('if (options.executeCamera)');
  const context = source.indexOf(
    'const context = buildIosConnectionRuntimeContext({',
    cameraBranch,
  );
  const cameraContext = source.indexOf('observe: observeCamera', context);
  const genericContext = source.indexOf('observe,', context);
  const buildContext = source.indexOf('const buildIosConnectionRuntimeContext =');
  const switchUpdate = source.indexOf(
    'cameraActiveAuthRequestId = boundary.authRequestId',
    buildContext,
  );
  assert.ok(cameraBranch >= 0);
  assert.ok(context > cameraBranch);
  assert.ok(genericContext > context && genericContext < cameraContext);
  assert.ok(cameraContext > context);
  assert.ok(switchUpdate > buildContext && switchUpdate < context);
});
