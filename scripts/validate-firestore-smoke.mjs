#!/usr/bin/env node

/**
 * Firestore smoke validation for profile/connection/plan collections.
 *
 * Required env:
 * - APP_VARIANT=dev|prod
 * - FIRESTORE_ID_TOKEN
 * - FIREBASE_DEV_PROJECT_ID / FIREBASE_PROD_PROJECT_ID
 */

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[validate-firestore-smoke] ${message}`);
}

const variant = process.env.APP_VARIANT === 'prod' ? 'prod' : 'dev';
const projectId =
  variant === 'prod'
    ? process.env.FIREBASE_PROD_PROJECT_ID?.trim()
    : process.env.FIREBASE_DEV_PROJECT_ID?.trim();
const idToken = process.env.FIRESTORE_ID_TOKEN?.trim();

if (!projectId) fail(`Missing Firebase project id for variant=${variant}.`);
if (!idToken) fail('Missing FIRESTORE_ID_TOKEN.');

const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const testId = `smoke_${Date.now()}`;
const createdAtIso = new Date().toISOString();
const cleanupPaths = [];

function decodeJwtPayload(token) {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const actorUid = (() => {
  const payload = decodeJwtPayload(idToken);
  const uid = payload?.user_id ?? payload?.sub ?? null;
  if (!uid || typeof uid !== 'string') {
    fail('Could not extract auth uid from FIRESTORE_ID_TOKEN (missing sub/user_id claim).');
  }
  return uid;
})();

async function call(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    fail(`HTTP ${response.status} ${method} ${url}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

const docPath = `${base}/smokeChecks/${testId}`;
const connectionPath = `${base}/connections/${testId}`;
const nutritionPlanPath = `${base}/nutritionPlans/${testId}`;

info(`project=${projectId} variant=${variant}`);
info(`actorUid=${actorUid}`);

try {
  info('step 1/8: create smoke profile document');
  await call(docPath, {
    method: 'PATCH',
    body: {
      fields: {
        ownerUid: { stringValue: actorUid },
        kind: { stringValue: 'profile' },
        createdAt: { stringValue: createdAtIso },
      },
    },
  });
  cleanupPaths.push(docPath);

  info('step 2/8: read smoke profile document');
  await call(docPath);

  info('step 3/8: create smoke connection (pending_confirmation)');
  await call(connectionPath, {
    method: 'PATCH',
    body: {
      fields: {
        id: { stringValue: testId },
        status: { stringValue: 'pending_confirmation' },
        specialty: { stringValue: 'nutritionist' },
        professionalAuthUid: { stringValue: actorUid },
        studentAuthUid: { stringValue: actorUid },
        createdAt: { stringValue: createdAtIso },
        updatedAt: { stringValue: new Date().toISOString() },
      },
    },
  });
  cleanupPaths.push(connectionPath);

  info('step 4/8: transition connection -> active');
  await call(`${connectionPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH',
    body: {
      fields: {
        status: { stringValue: 'active' },
        updatedAt: { stringValue: new Date().toISOString() },
      },
    },
  });

  info('step 5/8: transition connection -> ended');
  await call(
    `${connectionPath}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=canceledReason`,
    {
      method: 'PATCH',
      body: {
        fields: {
          status: { stringValue: 'ended' },
          canceledReason: { stringValue: 'smoke_cleanup' },
          updatedAt: { stringValue: new Date().toISOString() },
        },
      },
    }
  );

  info('step 6/8: create smoke nutrition plan document');
  await call(nutritionPlanPath, {
    method: 'PATCH',
    body: {
      fields: {
        id: { stringValue: testId },
        ownerProfessionalUid: { stringValue: actorUid },
        studentAuthUid: { stringValue: actorUid },
        sourceKind: { stringValue: 'predefined' },
        isArchived: { booleanValue: false },
        isDraft: { booleanValue: false },
        name: { stringValue: 'Smoke Plan' },
        caloriesTarget: { integerValue: '2000' },
        carbsTarget: { integerValue: '220' },
        proteinsTarget: { integerValue: '140' },
        fatsTarget: { integerValue: '70' },
        createdAt: { stringValue: createdAtIso },
        updatedAt: { stringValue: new Date().toISOString() },
      },
    },
  });
  cleanupPaths.push(nutritionPlanPath);

  info('step 7/8: read smoke nutrition plan document');
  await call(nutritionPlanPath);

  info('step 8/8: cleanup smoke documents');
} finally {
  for (const path of cleanupPaths.reverse()) {
    try {
      await call(path, { method: 'DELETE' });
    } catch (error) {
      info(`cleanup warning for ${path}: ${(error && error.message) || String(error)}`);
    }
  }
}

info('Firestore smoke validation completed successfully.');
