/**
 * Firebase Cloud Functions (Gen 2) — MyChampions backend proxy layer.
 *
 * Functions exported:
 *  - analyzeMealPhoto : OpenAI GPT-4o Vision meal macro analysis proxy (D-106–D-110, BL-108)
 *  - removeProfessionalSpecialty : governed Professional Specialty removal with invite cleanup
 *
 * Security model (both functions):
 *  - Caller must supply a valid Firebase Auth ID token: Authorization: Bearer <token>.
 *  - Third-party API credentials are stored as Cloud Function secrets only — never in the binary.
 *
 * Refs: D-106–D-110, BL-108, FR-229–FR-248, BR-287–BR-296
 */

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

import { callOpenAIVision, OpenAIHelperError } from './openai-helpers';

// ─── Firebase Admin init ──────────────────────────────────────────────────────

if (admin.apps.length === 0) {
  admin.initializeApp();
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

// ─── Shared auth helper ───────────────────────────────────────────────────────

/**
 * Extracts and verifies the Firebase Auth ID token from the Authorization header.
 * Returns the decoded token on success or null if missing/invalid.
 */
async function verifyAuthHeader(
  authHeader: string
): Promise<admin.auth.DecodedIdToken | null> {
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7);
  if (!idToken) return null;
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// analyzeMealPhoto — OpenAI GPT-4o Vision proxy
// ═══════════════════════════════════════════════════════════════════════════════

export const analyzeMealPhoto = onRequest(
  {
    secrets: [OPENAI_API_KEY],
    cors: false,
    region: 'us-central1',
    timeoutSeconds: 60, // Vision calls can be slower than text
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    // ── Verify Firebase Auth ID token ──────────────────────────────────────────
    const decoded = await verifyAuthHeader(req.headers['authorization'] ?? '');
    if (!decoded) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    // ── Validate request body ──────────────────────────────────────────────────
    const { image, mimeType } = req.body as { image?: unknown; mimeType?: unknown };

    if (!image || typeof image !== 'string' || !image.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'image (base64) is required' });
      return;
    }

    if (mimeType !== 'image/jpeg') {
      res.status(400).json({ error: 'bad_request', message: 'mimeType must be image/jpeg' });
      return;
    }

    // ── Call OpenAI ────────────────────────────────────────────────────────────
    try {
      const estimate = await callOpenAIVision(OPENAI_API_KEY.value(), image.trim());
      res.status(200).json(estimate);
    } catch (err) {
      if (err instanceof OpenAIHelperError) {
        if (err.kind === 'unrecognizable_image') {
          res.status(400).json({ error: 'unrecognizable_image' });
          return;
        }
        if (err.kind === 'quota_exceeded') {
          res.status(429).json({ error: 'quota_exceeded' });
          return;
        }
        // invalid_response or unknown → 500
        res.status(500).json({ error: err.kind });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// removeProfessionalSpecialty — governed specialty removal
// ═══════════════════════════════════════════════════════════════════════════════

function isSupportedSpecialty(value: unknown): value is 'nutritionist' | 'fitness_coach' {
  return value === 'nutritionist' || value === 'fitness_coach';
}

export const removeProfessionalSpecialty = onRequest(
  {
    cors: false,
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const decoded = await verifyAuthHeader(req.headers['authorization'] ?? '');
    if (!decoded) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const { specialtyId } = req.body as { specialtyId?: unknown };
    if (typeof specialtyId !== 'string' || !specialtyId.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'specialtyId is required' });
      return;
    }

    const db = admin.firestore();
    const specialtyRef = db.collection('specialties').doc(specialtyId.trim());

    try {
      await db.runTransaction(async (tx) => {
        const specialtySnap = await tx.get(specialtyRef);
        if (!specialtySnap.exists) {
          throw new Error('not_found');
        }

        const specialty = specialtySnap.data() as {
          professionalAuthUid?: unknown;
          specialty?: unknown;
        };
        if (specialty.professionalAuthUid !== decoded.uid) {
          throw new Error('forbidden');
        }
        if (!isSupportedSpecialty(specialty.specialty)) {
          throw new Error('invalid_specialty');
        }

        const activeSpecialties = await tx.get(db.collection('specialties')
          .where('professionalAuthUid', '==', decoded.uid)
          .where('isActive', '==', true)
          .limit(2));
        if (specialtySnap.get('isActive') === true && activeSpecialties.size <= 1) {
          throw new Error('last_specialty');
        }

        const activeConnections = await tx.get(db.collection('connections')
          .where('professionalAuthUid', '==', decoded.uid)
          .where('specialty', '==', specialty.specialty)
          .where('status', '==', 'active')
          .limit(1));
        const pendingConnections = await tx.get(db.collection('connections')
          .where('professionalAuthUid', '==', decoded.uid)
          .where('specialty', '==', specialty.specialty)
          .where('status', '==', 'pending_confirmation')
          .limit(1));

        if (!activeConnections.empty || !pendingConnections.empty) {
          throw new Error('removal_blocked');
        }

        const inviteRef = db.collection('professionals')
          .doc(decoded.uid)
          .collection('inviteCodes')
          .doc(specialty.specialty);
        const inviteSnap = await tx.get(inviteRef);

        if (inviteSnap.exists) {
          const invite = inviteSnap.data() as { codeValue?: unknown };
          if (typeof invite.codeValue === 'string' && invite.codeValue) {
            tx.delete(db.collection('inviteCodeLookups').doc(invite.codeValue));
          }
          tx.delete(inviteRef);
        }

        tx.delete(specialtyRef);
      });

      res.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'not_found') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (message === 'forbidden') {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (message === 'removal_blocked') {
        res.status(409).json({ error: 'removal_blocked' });
        return;
      }
      if (message === 'last_specialty') {
        res.status(409).json({ error: 'last_specialty' });
        return;
      }
      if (message === 'invalid_specialty') {
        res.status(500).json({ error: 'invalid_specialty' });
        return;
      }
      res.status(500).json({ error: message });
    }
  }
);
