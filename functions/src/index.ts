/**
 * Firebase Cloud Functions (Gen 2) — MyChampions backend proxy layer.
 *
 * Functions exported:
 *  - analyzeMealPhoto : OpenAI GPT-4o Vision meal macro analysis proxy (D-106–D-110, BL-108)
 *  - submitInviteCode : governed invite submission and pending Connection creation
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

function buildConnectionFromInvite(input: {
  connectionId: string;
  studentUid: string;
  professionalUid: string;
  specialty: 'nutritionist' | 'fitness_coach';
  codeValue: string;
  timestamp: string;
}) {
  return {
    id: input.connectionId,
    studentAuthUid: input.studentUid,
    professionalAuthUid: input.professionalUid,
    specialty: input.specialty,
    status: 'pending_confirmation',
    canceledReason: null,
    sourceInviteCodeId: input.specialty,
    sourceInviteCodeValue: input.codeValue,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    endedAt: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// submitInviteCode — governed pending connection creation
// ═══════════════════════════════════════════════════════════════════════════════

export const submitInviteCode = onRequest(
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

    const { code } = req.body as { code?: unknown };
    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ error: 'not_found' });
      return;
    }

    const trimmedCode = code.trim();
    const db = admin.firestore();

    try {
      const connectionId = await db.runTransaction(async (tx) => {
        const lookupRef = db.collection('inviteCodeLookups').doc(trimmedCode);
        const lookupSnap = await tx.get(lookupRef);
        if (!lookupSnap.exists) throw new Error('not_found');

        const lookup = lookupSnap.data() as {
          scope?: unknown;
          codeValue?: unknown;
          professionalAuthUid?: unknown;
          specialty?: unknown;
          inviteCodeId?: unknown;
          status?: unknown;
        };
        if (
          lookup.scope !== 'invite_code_lookup' ||
          lookup.codeValue !== trimmedCode ||
          lookup.status !== 'active' ||
          typeof lookup.professionalAuthUid !== 'string' ||
          !isSupportedSpecialty(lookup.specialty) ||
          lookup.inviteCodeId !== lookup.specialty
        ) {
          throw new Error('not_found');
        }

        const professionalUid = lookup.professionalAuthUid;
        const specialty = lookup.specialty;
        const inviteRef = db.collection('professionals').doc(professionalUid).collection('inviteCodes').doc(specialty);
        const specialtyRef = db.collection('specialties').doc(`${professionalUid}_${specialty}`);
        const [inviteSnap, specialtySnap] = await Promise.all([
          tx.get(inviteRef),
          tx.get(specialtyRef),
        ]);

        if (!inviteSnap.exists || !specialtySnap.exists || specialtySnap.get('isActive') !== true) {
          throw new Error('not_found');
        }

        const invite = inviteSnap.data() as {
          scope?: unknown;
          professionalAuthUid?: unknown;
          specialty?: unknown;
          codeValue?: unknown;
          status?: unknown;
        };
        if (
          invite.scope !== 'professional_specialty' ||
          invite.professionalAuthUid !== professionalUid ||
          invite.specialty !== specialty ||
          invite.codeValue !== trimmedCode ||
          invite.status !== 'active'
        ) {
          throw new Error('not_found');
        }

        const existingConnections = await tx.get(db.collection('connections')
          .where('studentAuthUid', '==', decoded.uid)
          .where('professionalAuthUid', '==', professionalUid)
          .where('specialty', '==', specialty));
        const hasActive = existingConnections.docs.some((docSnap) => docSnap.get('status') === 'active');
        const hasPending = existingConnections.docs.some((docSnap) => docSnap.get('status') === 'pending_confirmation');
        if (hasActive) throw new Error('already_connected');
        if (hasPending) throw new Error('pending_already_exists');

        const pendingConnections = await tx.get(db.collection('connections')
          .where('professionalAuthUid', '==', professionalUid)
          .where('status', '==', 'pending_confirmation'));
        const pendingStudentUids = new Set(
          pendingConnections.docs
            .map((docSnap) => docSnap.get('studentAuthUid'))
            .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
        );
        pendingStudentUids.add(decoded.uid);
        if (pendingStudentUids.size > 10) {
          throw new Error('pending_cap_reached');
        }

        const connectionRef = db.collection('connections').doc();
        tx.set(connectionRef, buildConnectionFromInvite({
          connectionId: connectionRef.id,
          studentUid: decoded.uid,
          professionalUid,
          specialty,
          codeValue: trimmedCode,
          timestamp: new Date().toISOString(),
        }));

        return connectionRef.id;
      });

      res.status(200).json({ connectionId, status: 'pending_confirmation' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'not_found') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (message === 'already_connected') {
        res.status(409).json({ error: 'already_connected' });
        return;
      }
      if (message === 'pending_already_exists') {
        res.status(409).json({ error: 'pending_already_exists' });
        return;
      }
      if (message === 'pending_cap_reached') {
        res.status(409).json({ error: 'pending_cap_reached' });
        return;
      }
      res.status(500).json({ error: message });
    }
  }
);

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
