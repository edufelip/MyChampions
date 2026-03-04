#!/usr/bin/env node

/**
 * Validates Data Connect runtime env wiring for the selected APP_VARIANT.
 *
 * Required:
 * - APP_VARIANT=dev|prod
 * - EXPO_PUBLIC_DATA_CONNECT_CONNECTOR_ID
 * - EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_DEV / PROD
 * - EXPO_PUBLIC_DATA_CONNECT_LOCATION_DEV / PROD
 */

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[check-dataconnect-runtime-config] ${message}`);
}

const variant = process.env.APP_VARIANT === 'prod' ? 'prod' : 'dev';
const connector = process.env.EXPO_PUBLIC_DATA_CONNECT_CONNECTOR_ID ?? '';

const service =
  variant === 'prod'
    ? process.env.EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_PROD ?? ''
    : process.env.EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_DEV ?? '';

const location =
  variant === 'prod'
    ? process.env.EXPO_PUBLIC_DATA_CONNECT_LOCATION_PROD ?? ''
    : process.env.EXPO_PUBLIC_DATA_CONNECT_LOCATION_DEV ?? '';

if (!connector.trim()) {
  fail('EXPO_PUBLIC_DATA_CONNECT_CONNECTOR_ID is missing.');
}

if (!service.trim()) {
  fail(
    variant === 'prod'
      ? 'EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_PROD is missing.'
      : 'EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_DEV is missing.'
  );
}

if (!location.trim()) {
  fail(
    variant === 'prod'
      ? 'EXPO_PUBLIC_DATA_CONNECT_LOCATION_PROD is missing.'
      : 'EXPO_PUBLIC_DATA_CONNECT_LOCATION_DEV is missing.'
  );
}

info(`variant=${variant}`);
info(`connector=${connector}`);
info(`service=${service}`);
info(`location=${location}`);
