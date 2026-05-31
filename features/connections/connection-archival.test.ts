import test from 'node:test';
import assert from 'node:assert';

// 1. Setup dynamic variables that the test mock will use
let currentSpecialty: 'nutritionist' | 'fitness_coach' = 'nutritionist';
let queriedCollection: string | null = null;
let queryClauses: any[] = [];
let txUpdates: Array<{ ref: any; data: any }> = [];

// 2. Define the mock functions
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
  if (q.colRef && (q.colRef.path === 'nutritionPlans' || q.colRef.path === 'trainingPlans')) {
    return {
      empty: false,
      docs: [
        {
          id: 'plan-123',
          ref: { type: 'doc_ref', path: `${q.colRef.path}/plan-123` },
          data: () => ({
            id: 'plan-123',
            sourceKind: 'self_managed',
            isArchived: false,
            studentAuthUid: 'student-456'
          })
        }
      ],
      forEach(cb: any) {
        this.docs.forEach(cb);
      }
    } as any;
  }
  return { empty: true, docs: [], forEach() {} } as any;
};

const mockRunTransaction = async (db: any, updateFunction: any) => {
  txUpdates = [];
  const tx = {
    get: async (ref: any) => {
      if (ref.path === 'connections/conn-123') {
        return {
          exists: () => true,
          data: () => ({
            id: 'conn-123',
            studentAuthUid: 'student-456',
            professionalAuthUid: 'prof-789',
            specialty: currentSpecialty,
            status: 'pending_confirmation'
          })
        } as any;
      }
      throw new Error(`Ref not found in mock: ${ref.path}`);
    },
    update: (ref: any, data: any) => {
      txUpdates.push({ ref, data });
    },
    set: () => {},
    delete: () => {}
  } as any;

  await updateFunction(tx);
  return txUpdates;
};

// 3. Intercept 'firebase/firestore' in require.cache before importing 'connection-source'
const firestorePath = require.resolve('firebase/firestore');
const originalFirestore = require(firestorePath);

const mockedFirestore = {
  ...originalFirestore,
  doc: mockDoc,
  collection: mockCollection,
  where: mockWhere,
  query: mockQuery,
  getDocs: mockGetDocs,
  runTransaction: mockRunTransaction,
};

require.cache[firestorePath] = {
  id: firestorePath,
  filename: firestorePath,
  loaded: true,
  exports: mockedFirestore
} as any;

// 4. NOW import the module under test
const { confirmPendingConnection } = require('./connection-source');

test('TDD: confirmPendingConnection archives self_managed nutrition plans for nutritionist specialty', async (t) => {

  currentSpecialty = 'nutritionist';
  queriedCollection = null;
  queryClauses = [];
  txUpdates = [];

  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'prof-789',
  };

  const result = await confirmPendingConnection('conn-123', mockDeps);

  assert.equal(result.connectionId, 'conn-123');
  assert.equal(result.status, 'active');

  // Verify that the connection was updated to active
  const connUpdate = txUpdates.find(u => u.ref.path === 'connections/conn-123');
  assert.ok(connUpdate, 'Connection update should be called');
  assert.equal(connUpdate.data.status, 'active');

  // Verify that nutritionPlans collection was queried
  assert.equal(queriedCollection, 'nutritionPlans', 'Should query nutritionPlans for nutritionist');

  // Verify clauses
  const studentClause = queryClauses.find(c => c.field === 'studentAuthUid');
  const sourceClause = queryClauses.find(c => c.field === 'sourceKind');
  const archivedClause = queryClauses.find(c => c.field === 'isArchived');
  assert.ok(studentClause && studentClause.value === 'student-456', 'Should query by studentAuthUid');
  assert.ok(sourceClause && sourceClause.value === 'self_managed', 'Should query by sourceKind == self_managed');
  assert.ok(archivedClause && archivedClause.value === false, 'Should query by isArchived == false');

  // Verify that the plan was archived inside the transaction
  const planUpdate = txUpdates.find(u => u.ref.path === 'nutritionPlans/plan-123');
  assert.ok(planUpdate, 'Should update the nutrition plan');
  assert.equal(planUpdate.data.isArchived, true, 'isArchived should be set to true');
  assert.ok(planUpdate.data.updatedAt, 'updatedAt should be set');
});

test('TDD: confirmPendingConnection archives self_managed training plans for fitness_coach specialty', async (t) => {

  currentSpecialty = 'fitness_coach';
  queriedCollection = null;
  queryClauses = [];
  txUpdates = [];

  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'prof-789',
  };

  const result = await confirmPendingConnection('conn-123', mockDeps);

  assert.equal(result.connectionId, 'conn-123');
  assert.equal(result.status, 'active');

  // Verify that the connection was updated to active
  const connUpdate = txUpdates.find(u => u.ref.path === 'connections/conn-123');
  assert.ok(connUpdate, 'Connection update should be called');
  assert.equal(connUpdate.data.status, 'active');

  // Verify that trainingPlans collection was queried
  assert.equal(queriedCollection, 'trainingPlans', 'Should query trainingPlans for fitness_coach');

  // Verify clauses
  const studentClause = queryClauses.find(c => c.field === 'studentAuthUid');
  const sourceClause = queryClauses.find(c => c.field === 'sourceKind');
  const archivedClause = queryClauses.find(c => c.field === 'isArchived');
  assert.ok(studentClause && studentClause.value === 'student-456', 'Should query by studentAuthUid');
  assert.ok(sourceClause && sourceClause.value === 'self_managed', 'Should query by sourceKind == self_managed');
  assert.ok(archivedClause && archivedClause.value === false, 'Should query by isArchived == false');

  // Verify that the plan was archived inside the transaction
  const planUpdate = txUpdates.find(u => u.ref.path === 'trainingPlans/plan-123');
  assert.ok(planUpdate, 'Should update the training plan');
  assert.equal(planUpdate.data.isArchived, true, 'isArchived should be set to true');
  assert.ok(planUpdate.data.updatedAt, 'updatedAt should be set');
});

// Restore original implementations at the end of the test file
test('Restore original firestore exports', () => {
  require.cache[firestorePath] = {
    id: firestorePath,
    filename: firestorePath,
    loaded: true,
    exports: originalFirestore
  } as any;
});
