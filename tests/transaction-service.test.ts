import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpenseNature, ExpenseStatus, IncomeKind, PrismaClient, TransactionFrequency } from '@prisma/client';
import { createExpenseTransaction, createIncomeTransaction, IdempotencyConflictError } from '../server/transaction-service.js';

type StoredRow = Record<string, any>;
type Store = { incomes: StoredRow[]; expenses: StoredRow[]; recurrences: StoredRow[]; activities: StoredRow[] };

function memoryPrisma(options: { failRecurrence?: boolean } = {}) {
  const state: Store = { incomes: [], expenses: [], recurrences: [], activities: [] };
  let nextId = 1;
  const uniqueError = () => Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });
  const tx = {
    income: {
      create: async ({ data }: { data: StoredRow }) => {
        if (state.incomes.some(row => row.householdId === data.householdId && row.idempotencyKey === data.idempotencyKey)) throw uniqueError();
        const row = { id: `income-${nextId++}`, ...data };
        state.incomes.push(row);
        return row;
      },
    },
    expense: {
      create: async ({ data }: { data: StoredRow }) => {
        if (state.expenses.some(row => row.householdId === data.householdId && row.idempotencyKey === data.idempotencyKey)) throw uniqueError();
        const row = { id: `expense-${nextId++}`, ...data };
        state.expenses.push(row);
        return row;
      },
    },
    recurringTransaction: {
      upsert: async ({ where, create, update }: { where: StoredRow; create: StoredRow; update: StoredRow }) => {
        if (options.failRecurrence) throw new Error('recurrence write failed');
        const row = state.recurrences.find(entry => Object.entries(where).every(([key, value]) => entry[key] === value));
        if (row) return Object.assign(row, update);
        const created = { id: `recurrence-${nextId++}`, ...create };
        state.recurrences.push(created);
        return created;
      },
      deleteMany: async ({ where }: { where: StoredRow }) => {
        const before = state.recurrences.length;
        state.recurrences = state.recurrences.filter(entry => !Object.entries(where).every(([key, value]) => entry[key] === value));
        return { count: before - state.recurrences.length };
      },
    },
    activityLog: {
      create: async ({ data }: { data: StoredRow }) => {
        const row = { id: `activity-${nextId++}`, ...data };
        state.activities.push(row);
        return row;
      },
    },
  };
  const client = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const snapshot = structuredClone(state);
      try { return await callback(tx); }
      catch (error) {
        state.incomes = snapshot.incomes;
        state.expenses = snapshot.expenses;
        state.recurrences = snapshot.recurrences;
        state.activities = snapshot.activities;
        throw error;
      }
    },
    income: {
      findUnique: async ({ where }: { where: { householdId_idempotencyKey: { householdId: string; idempotencyKey: string } } }) => state.incomes.find(row => row.householdId === where.householdId_idempotencyKey.householdId && row.idempotencyKey === where.householdId_idempotencyKey.idempotencyKey) ?? null,
    },
    expense: {
      findUnique: async ({ where }: { where: { householdId_idempotencyKey: { householdId: string; idempotencyKey: string } } }) => state.expenses.find(row => row.householdId === where.householdId_idempotencyKey.householdId && row.idempotencyKey === where.householdId_idempotencyKey.idempotencyKey) ?? null,
    },
  } as unknown as PrismaClient;
  return { client, state };
}

const incomeData = { description: 'Salário líquido', amount: 2000, categoryId: 'income-category', kind: IncomeKind.NET_SALARY, frequency: TransactionFrequency.MONTHLY, occurredAt: new Date('2026-11-05T12:00:00.000Z') };
const expenseData = { description: 'Conta de luz', amount: 180, categoryId: 'expense-category', frequency: TransactionFrequency.MONTHLY, dueAt: new Date('2026-11-10T12:00:00.000Z'), status: ExpenseStatus.PAID, nature: ExpenseNature.VARIABLE };

test('creates income and expense with recurrence and activity', async () => {
  const { client, state } = memoryPrisma();
  const context = { householdId: 'family-1', actorId: 'user-1' };
  const income = await createIncomeTransaction(client, context, incomeData, 'income-key-001');
  const expense = await createExpenseTransaction(client, context, expenseData, 'expense-key-001');
  assert.equal(income.status, 201);
  assert.equal(expense.status, 201);
  assert.equal('requestHash' in (income.row as StoredRow), false);
  assert.equal('idempotencyKey' in (expense.row as StoredRow), false);
  assert.equal(state.incomes.length, 1);
  assert.equal(state.expenses.length, 1);
  assert.equal(state.recurrences.length, 2);
  assert.equal(state.activities.length, 2);
});

test('rolls back an expense when recurrence creation fails', async () => {
  const { client, state } = memoryPrisma({ failRecurrence: true });
  await assert.rejects(createExpenseTransaction(client, { householdId: 'family-1', actorId: 'user-1' }, expenseData, 'expense-key-002'), /recurrence write failed/);
  assert.equal(state.expenses.length, 0);
  assert.equal(state.recurrences.length, 0);
  assert.equal(state.activities.length, 0);
});

test('replaying the same request returns the original row without duplicating side effects', async () => {
  const { client, state } = memoryPrisma();
  const context = { householdId: 'family-1', actorId: 'user-1' };
  const first = await createIncomeTransaction(client, context, incomeData, 'income-key-003');
  const replay = await createIncomeTransaction(client, context, { ...incomeData }, 'income-key-003');
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal((replay.row as StoredRow).id, (first.row as StoredRow).id);
  assert.equal(state.incomes.length, 1);
  assert.equal(state.recurrences.length, 1);
  assert.equal(state.activities.length, 1);
});

test('replaying an expense request also avoids duplicate transactions and activity', async () => {
  const { client, state } = memoryPrisma();
  const context = { householdId: 'family-1', actorId: 'user-1' };
  const first = await createExpenseTransaction(client, context, expenseData, 'expense-key-006');
  const replay = await createExpenseTransaction(client, context, { ...expenseData }, 'expense-key-006');
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal((replay.row as StoredRow).id, (first.row as StoredRow).id);
  assert.equal(state.expenses.length, 1);
  assert.equal(state.recurrences.length, 1);
  assert.equal(state.activities.length, 1);
});

test('rejects an idempotency key reused with a different payload', async () => {
  const { client } = memoryPrisma();
  const context = { householdId: 'family-1', actorId: 'user-1' };
  await createExpenseTransaction(client, context, expenseData, 'expense-key-004');
  await assert.rejects(
    createExpenseTransaction(client, context, { ...expenseData, amount: 999 }, 'expense-key-004'),
    IdempotencyConflictError,
  );
});

test('keeps identical keys isolated between households', async () => {
  const { client, state } = memoryPrisma();
  const first = await createIncomeTransaction(client, { householdId: 'family-a', actorId: 'user-a' }, incomeData, 'shared-key-005');
  const second = await createIncomeTransaction(client, { householdId: 'family-b', actorId: 'user-b' }, incomeData, 'shared-key-005');
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(state.incomes.length, 2);
  assert.deepEqual(state.incomes.map(row => row.householdId).sort(), ['family-a', 'family-b']);
});
