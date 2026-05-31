import test from 'node:test';
import assert from 'node:assert';

let loggedDocs: Array<{ path: string; data: any }> = [];
let queriedCollection: string | null = null;
let queryClauses: any[] = [];

const mockDoc = (db: any, path: string, ...segments: string[]) => {
  return { type: 'doc_ref', path: `${path}/${segments.join('/')}` };
};

const mockCollection = (db: any, path: string) => {
  queriedCollection = path;
  return { type: 'collection_ref', path };
};

const mockWhere = (field: string, op: string, value: any) => {
  return { type: 'where_clause', field, op, value };
};

const mockQuery = (colRef: any, ...clauses: any[]) => {
  queryClauses = clauses;
  return { type: 'query', colRef, clauses };
};

const mockGetDocs = async (q: any) => {
  if (q.colRef && q.colRef.path === 'workoutLogs') {
    return {
      empty: false,
      docs: [
        {
          id: 'wlog-123',
          ref: { type: 'doc_ref', path: `workoutLogs/wlog-123` },
          data: () => ({
            id: 'wlog-123',
            ownerUid: 'student-456',
            sessionId: 'sess-789',
            sessionName: 'Chest Day',
            createdAt: '2026-05-31T16:00:00Z',
          }),
        },
      ],
    } as any;
  }
  return { empty: true, docs: [] } as any;
};

const mockSetDoc = async (docRef: any, data: any) => {
  loggedDocs.push({ path: docRef.path, data });
};

const firestorePath = require.resolve('firebase/firestore');
const originalFirestore = require(firestorePath);

const mockedFirestore = {
  ...originalFirestore,
  doc: mockDoc,
  collection: mockCollection,
  where: mockWhere,
  query: mockQuery,
  getDocs: mockGetDocs,
  setDoc: mockSetDoc,
};

require.cache[firestorePath] = {
  id: firestorePath,
  filename: firestorePath,
  loaded: true,
  exports: mockedFirestore,
} as any;

const { logWorkoutSession, getTodayWorkoutLogs } = require('./workout-log-source');

test('TDD: logWorkoutSession writes correct workoutLog document', async (t) => {
  loggedDocs = [];
  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'student-456',
  };

  await logWorkoutSession('sess-789', 'Chest Day', mockDeps);

  assert.equal(loggedDocs.length, 1);
  const log = loggedDocs[0];
  assert.match(log.path, /^workoutLogs\/.+/);
  assert.equal(log.data.ownerUid, 'student-456');
  assert.equal(log.data.sessionId, 'sess-789');
  assert.equal(log.data.sessionName, 'Chest Day');
  assert.ok(log.data.createdAt);
});

test('TDD: getTodayWorkoutLogs queries today workout logs for current student', async (t) => {
  queriedCollection = null;
  queryClauses = [];

  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'student-456',
  };

  const logs = await getTodayWorkoutLogs(mockDeps);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].id, 'wlog-123');
  assert.equal(logs[0].sessionName, 'Chest Day');

  assert.equal(queriedCollection, 'workoutLogs');
  const ownerClause = queryClauses.find(c => c.field === 'ownerUid');
  const dateClause = queryClauses.find(c => c.field === 'createdAt');

  assert.ok(ownerClause && ownerClause.value === 'student-456');
  assert.ok(dateClause && dateClause.op === '>=');
});

test('Restore original firestore exports for other tests', () => {
  require.cache[firestorePath] = {
    id: firestorePath,
    filename: firestorePath,
    loaded: true,
    exports: originalFirestore,
  } as any;
});
