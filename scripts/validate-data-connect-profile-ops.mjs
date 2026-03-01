#!/usr/bin/env node

/**
 * Validates Firebase Data Connect profile operations against a live endpoint.
 *
 * Required env:
 * - EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT
 * - DATA_CONNECT_ID_TOKEN
 *
 * Optional env:
 * - EXPO_PUBLIC_DATA_CONNECT_API_KEY
 * - DATA_CONNECT_TEST_UID
 * - DATA_CONNECT_TEST_DISPLAY_NAME
 * - DATA_CONNECT_TEST_EMAIL
 * - DATA_CONNECT_TEST_SET_ROLE (student|professional)  // optional mutation
 */

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[validate-data-connect] ${message}`);
}

function usage() {
  console.log(`
Usage:
  node scripts/validate-data-connect-profile-ops.mjs

Required env:
  EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT
  DATA_CONNECT_ID_TOKEN

Optional env:
  EXPO_PUBLIC_DATA_CONNECT_API_KEY
  DATA_CONNECT_TEST_UID
  DATA_CONNECT_TEST_DISPLAY_NAME
  DATA_CONNECT_TEST_EMAIL
  DATA_CONNECT_TEST_SET_ROLE=student|professional
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  usage();
  process.exit(0);
}

const endpoint = process.env.EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT;
const apiKey = process.env.EXPO_PUBLIC_DATA_CONNECT_API_KEY;
const idToken = process.env.DATA_CONNECT_ID_TOKEN;

if (!endpoint) {
  fail('EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT is missing.');
}

if (!idToken) {
  fail('DATA_CONNECT_ID_TOKEN is missing.');
}

async function callGraphQL(query, variables) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };

  if (apiKey) {
    headers['x-goog-api-key'] = apiKey;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    fail(`HTTP ${response.status} from Data Connect endpoint: ${text}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    fail(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

const upsertUserProfileMutation = `
  mutation UpsertUserProfile($input: UpsertUserProfileInput!) {
    upsertUserProfile(input: $input) {
      auth_uid
    }
  }
`;

const getMyProfileQuery = `
  query GetMyProfile {
    getMyProfile {
      locked_role
    }
  }
`;

const setLockedRoleMutation = `
  mutation SetLockedRole($role: String!) {
    setLockedRole(role: $role) {
      locked_role
    }
  }
`;

const testUid = process.env.DATA_CONNECT_TEST_UID ?? 'test-validation-uid';
const testDisplayName = process.env.DATA_CONNECT_TEST_DISPLAY_NAME ?? 'Data Connect Validation';
const testEmail = process.env.DATA_CONNECT_TEST_EMAIL ?? 'validation@example.com';
const testSetRole = process.env.DATA_CONNECT_TEST_SET_ROLE;

info(`Endpoint: ${endpoint}`);
info('Running upsertUserProfile...');
const upsertData = await callGraphQL(upsertUserProfileMutation, {
  input: {
    auth_uid: testUid,
    display_name: testDisplayName,
    email_normalized: testEmail.toLowerCase(),
  },
});

const upsertUid = upsertData?.upsertUserProfile?.auth_uid;
if (!upsertUid) {
  fail('upsertUserProfile returned no auth_uid.');
}
info(`upsertUserProfile OK (auth_uid=${upsertUid})`);

info('Running getMyProfile...');
const profileData = await callGraphQL(getMyProfileQuery);
const lockedRole = profileData?.getMyProfile?.locked_role ?? null;
if (lockedRole !== null && lockedRole !== 'student' && lockedRole !== 'professional') {
  fail(`getMyProfile returned invalid locked_role value: ${lockedRole}`);
}
info(`getMyProfile OK (locked_role=${lockedRole ?? 'null'})`);

if (testSetRole) {
  if (testSetRole !== 'student' && testSetRole !== 'professional') {
    fail('DATA_CONNECT_TEST_SET_ROLE must be "student" or "professional".');
  }

  info(`Running setLockedRole(${testSetRole})...`);
  const setRoleData = await callGraphQL(setLockedRoleMutation, { role: testSetRole });
  const returnedRole = setRoleData?.setLockedRole?.locked_role;
  if (returnedRole !== 'student' && returnedRole !== 'professional') {
    fail(`setLockedRole returned invalid locked_role value: ${returnedRole}`);
  }
  info(`setLockedRole OK (locked_role=${returnedRole})`);
} else {
  info('Skipping setLockedRole mutation (set DATA_CONNECT_TEST_SET_ROLE to enable).');
}

info('Validation completed successfully.');
