import test from 'node:test';
import assert from 'node:assert';

// 1. Setup dynamic variables that the test mock will use
let currentSpecialty: 'nutritionist' | 'fitness_coach' = 'nutritionist';
let currentStatus = 'pending_confirmation';
let queriedCollection: string | null = null;
let queryClauses: any[] = [];
let planQueryCalls: Array<{ collection: string; clauses: any[] }> = [];
let txUpdates: Array<{ ref: any; data: any }> = [];
let txSets: Array<{ ref: any; data: any; options?: any }> = [];

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
    planQueryCalls.push({ collection: q.colRef.path, clauses: q.clauses });
    const sourceKind = q.clauses.find((clause: any) => clause.field === 'sourceKind')?.value;
    const isArchived = q.clauses.find((clause: any) => clause.field === 'isArchived')?.value;

    if (sourceKind === 'assigned' && isArchived === false) {
      return {
        empty: false,
        docs: [
          {
            id: 'assigned-plan-123',
            ref: { type: 'doc_ref', path: `${q.colRef.path}/assigned-plan-123` },
            data: () => ({
              id: 'assigned-plan-123',
              sourceKind: 'assigned',
              isArchived: false,
              studentAuthUid: 'student-456',
              ownerProfessionalUid: 'prof-789'
            })
          }
        ],
        forEach(cb: any) {
          this.docs.forEach(cb);
        }
      } as any;
    }

    if (sourceKind === 'self_managed' && isArchived === true) {
      return {
        empty: false,
        docs: [
          {
            id: 'self-managed-plan-123',
            ref: { type: 'doc_ref', path: `${q.colRef.path}/self-managed-plan-123` },
            data: () => ({
              id: 'self-managed-plan-123',
              sourceKind: 'self_managed',
              isArchived: true,
              studentAuthUid: 'student-456',
              lifecycleConnectionId: 'other-conn',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-03-01T00:00:00.000Z'
            })
          },
          {
            id: 'older-self-managed-plan-123',
            ref: { type: 'doc_ref', path: `${q.colRef.path}/older-self-managed-plan-123` },
            data: () => ({
              id: 'older-self-managed-plan-123',
              sourceKind: 'self_managed',
              isArchived: true,
              studentAuthUid: 'student-456',
              lifecycleConnectionId: 'conn-123',
              createdAt: '2026-01-15T00:00:00.000Z',
              updatedAt: '2026-01-20T00:00:00.000Z'
            })
          }
        ],
        forEach(cb: any) {
          this.docs.forEach(cb);
        }
      } as any;
    }

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
            status: currentStatus
          })
        } as any;
      }
      throw new Error(`Ref not found in mock: ${ref.path}`);
    },
    update: (ref: any, data: any) => {
      txUpdates.push({ ref, data });
    },
    set: (ref: any, data: any, options?: any) => {
      txSets.push({ ref, data, options });
    },
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
const { confirmPendingConnection, endConnection } = require('./connection-source');

test('TDD: confirmPendingConnection archives self_managed nutrition plans for nutritionist specialty', async (t) => {

  currentSpecialty = 'nutritionist';
  currentStatus = 'pending_confirmation';
  queriedCollection = null;
  queryClauses = [];
  planQueryCalls = [];
  txUpdates = [];
  txSets = [];

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
  assert.equal(planUpdate.data.lifecycleConnectionId, 'conn-123', 'lifecycleConnectionId should be set');

  const accessSet = txSets.find(u => u.ref.path === 'trackingAccess/student-456/nutritionists/prof-789');
  assert.ok(accessSet, 'Should create nutritionist tracking access document');
  assert.equal(accessSet.data.connectionId, 'conn-123');
  assert.equal(accessSet.data.studentAuthUid, 'student-456');
  assert.equal(accessSet.data.professionalAuthUid, 'prof-789');
  assert.equal(accessSet.data.specialty, 'nutritionist');
  assert.equal(accessSet.data.status, 'active');

  const specialtySet = txSets.find(u => u.ref.path === 'trackingAccess/student-456/activeSpecialties/nutritionist');
  assert.ok(specialtySet, 'Should create nutritionist active specialty sentinel');
  assert.equal(specialtySet.data.connectionId, 'conn-123');
  assert.equal(specialtySet.data.studentAuthUid, 'student-456');
  assert.equal(specialtySet.data.professionalAuthUid, 'prof-789');
  assert.equal(specialtySet.data.specialty, 'nutritionist');
  assert.equal(specialtySet.data.status, 'active');
  assert.deepEqual(specialtySet.options, { merge: true });
});

test('TDD: confirmPendingConnection archives self_managed training plans for fitness_coach specialty', async (t) => {

  currentSpecialty = 'fitness_coach';
  currentStatus = 'pending_confirmation';
  queriedCollection = null;
  queryClauses = [];
  planQueryCalls = [];
  txUpdates = [];
  txSets = [];

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
  assert.equal(planUpdate.data.lifecycleConnectionId, 'conn-123', 'lifecycleConnectionId should be set');

  const accessSet = txSets.find(u => u.ref.path === 'trackingAccess/student-456/fitnessCoaches/prof-789');
  assert.ok(accessSet, 'Should create fitness coach tracking access document');
  assert.equal(accessSet.data.connectionId, 'conn-123');
  assert.equal(accessSet.data.studentAuthUid, 'student-456');
  assert.equal(accessSet.data.professionalAuthUid, 'prof-789');
  assert.equal(accessSet.data.specialty, 'fitness_coach');
  assert.equal(accessSet.data.status, 'active');

  const specialtySet = txSets.find(u => u.ref.path === 'trackingAccess/student-456/activeSpecialties/fitness_coach');
  assert.ok(specialtySet, 'Should create fitness coach active specialty sentinel');
  assert.equal(specialtySet.data.connectionId, 'conn-123');
  assert.equal(specialtySet.data.studentAuthUid, 'student-456');
  assert.equal(specialtySet.data.professionalAuthUid, 'prof-789');
  assert.equal(specialtySet.data.specialty, 'fitness_coach');
  assert.equal(specialtySet.data.status, 'active');
  assert.deepEqual(specialtySet.options, { merge: true });
});

test('TDD: endConnection marks tracking access ended for connection specialty', async (t) => {
  currentSpecialty = 'nutritionist';
  currentStatus = 'active';
  planQueryCalls = [];
  txUpdates = [];
  txSets = [];

  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'student-456',
  };

  await endConnection('conn-123', mockDeps);

  const connUpdate = txUpdates.find(u => u.ref.path === 'connections/conn-123');
  assert.ok(connUpdate, 'Connection update should be called');
  assert.equal(connUpdate.data.status, 'ended');

  const accessSet = txSets.find(u => u.ref.path === 'trackingAccess/student-456/nutritionists/prof-789');
  assert.ok(accessSet, 'Should mark nutritionist tracking access ended');
  assert.equal(accessSet.data.connectionId, 'conn-123');
  assert.equal(accessSet.data.status, 'ended');
  assert.deepEqual(accessSet.options, { merge: true });

  const specialtySet = txSets.find(u => u.ref.path === 'trackingAccess/student-456/activeSpecialties/nutritionist');
  assert.ok(specialtySet, 'Should mark nutritionist active specialty sentinel ended');
  assert.equal(specialtySet.data.connectionId, 'conn-123');
  assert.equal(specialtySet.data.studentAuthUid, 'student-456');
  assert.equal(specialtySet.data.professionalAuthUid, 'prof-789');
  assert.equal(specialtySet.data.specialty, 'nutritionist');
  assert.equal(specialtySet.data.status, 'ended');
  assert.deepEqual(specialtySet.options, { merge: true });
});

test('TDD: endConnection archives assigned training plan and restores self-managed training plan for fitness_coach', async (t) => {
  currentSpecialty = 'fitness_coach';
  currentStatus = 'active';
  queriedCollection = null;
  queryClauses = [];
  planQueryCalls = [];
  txUpdates = [];
  txSets = [];

  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'student-456',
  };

  await endConnection('conn-123', mockDeps);

  assert.equal(planQueryCalls.length, 2, 'Should query assigned and self-managed training plans');
  assert.ok(
    planQueryCalls.every((call) => call.collection === 'trainingPlans'),
    'Should query trainingPlans for fitness coach connections'
  );

  const assignedQuery = planQueryCalls.find((call) => (
    call.clauses.some((clause) => clause.field === 'sourceKind' && clause.value === 'assigned')
  ));
  assert.ok(assignedQuery, 'Should query active assigned training plans');
  assert.ok(assignedQuery.clauses.some((clause) => clause.field === 'studentAuthUid' && clause.value === 'student-456'));
  assert.ok(assignedQuery.clauses.some((clause) => clause.field === 'ownerProfessionalUid' && clause.value === 'prof-789'));
  assert.ok(assignedQuery.clauses.some((clause) => clause.field === 'isArchived' && clause.value === false));

  const selfManagedQuery = planQueryCalls.find((call) => (
    call.clauses.some((clause) => clause.field === 'sourceKind' && clause.value === 'self_managed')
  ));
  assert.ok(selfManagedQuery, 'Should query archived self-managed training plans');
  assert.ok(selfManagedQuery.clauses.some((clause) => clause.field === 'studentAuthUid' && clause.value === 'student-456'));
  assert.ok(selfManagedQuery.clauses.some((clause) => clause.field === 'isArchived' && clause.value === true));

  const assignedUpdate = txUpdates.find((u) => u.ref.path === 'trainingPlans/assigned-plan-123');
  assert.ok(assignedUpdate, 'Should archive assigned training plan');
  assert.equal(assignedUpdate.data.isArchived, true);
  assert.ok(assignedUpdate.data.updatedAt, 'Assigned plan updatedAt should be set');
  assert.equal(assignedUpdate.data.lifecycleConnectionId, 'conn-123');

  const selfManagedUpdate = txUpdates.find((u) => u.ref.path === 'trainingPlans/older-self-managed-plan-123');
  assert.ok(selfManagedUpdate, 'Should restore archived self-managed training plan');
  assert.equal(selfManagedUpdate.data.isArchived, false);
  assert.ok(selfManagedUpdate.data.updatedAt, 'Self-managed plan updatedAt should be set');
  assert.equal(selfManagedUpdate.data.lifecycleConnectionId, 'conn-123');

  const otherConnectionUpdate = txUpdates.find((u) => u.ref.path === 'trainingPlans/self-managed-plan-123');
  assert.equal(otherConnectionUpdate, undefined, 'Should not restore newer archived self-managed plan from another connection');
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
