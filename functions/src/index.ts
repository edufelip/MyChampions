/**
 * Firebase Cloud Functions (Gen 2) — MyChampions backend proxy layer.
 *
 * Functions exported:
 *  - analyzeMealPhoto : OpenAI GPT-4o Vision meal macro analysis proxy (D-106–D-110, BL-108)
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
