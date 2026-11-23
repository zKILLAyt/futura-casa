import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { runSeed } from '../prisma/seed.js';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function memoryPrisma() {
  const tables: Tables = {
    households: [], users: [], householdMembers: [], categories: [], incomes: [], expenses: [],
    recurrences: [], properties: [], shopping: [], goals: [],
  };
  let sequence = 1;
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) return matches(row, value as Row);
    return row[key] === value;
  });
  const findFirst = (table: string) => async ({ where }: { where: Row }) => tables[table].find(row => matches(row, where)) ?? null;
  const findUnique = findFirst;
  const create = (table: string) => async ({ data }: { data: Row }) => {
    const row = { id: `${table}-${sequence++}`, ...data };
    tables[table].push(row);
    return row;
  };
  const update = (table: string) => async ({ where, data }: { where: Row; data: Row }) => {
    const row = tables[table].find(item => matches(item, where));
    if (!row) throw new Error(`Missing row in ${table}`);
    return Object.assign(row, data);
  };
  const upsert = (table: string) => async ({ where, update: changes, create: data }: { where: Row; update: Row; create: Row }) => {
    const row = tables[table].find(item => matches(item, where));
    return row ? Object.assign(row, changes) : create(table)({ data });
  };
  const client = {
    household: { upsert: upsert('households') },
    user: { upsert: upsert('users') },
    householdMember: { upsert: upsert('householdMembers') },
    category: { upsert: upsert('categories') },
    income: { findFirst: findFirst('incomes'), findUnique: findUnique('incomes'), update: update('incomes'), upsert: upsert('incomes') },
    expense: { findFirst: findFirst('expenses'), findUnique: findUnique('expenses'), update: update('expenses'), upsert: upsert('expenses') },
    recurringTransaction: {
      findUnique: findUnique('recurrences'), upsert: upsert('recurrences'),
      deleteMany: async ({ where }: { where: Row }) => {
        const count = tables.recurrences.length;
        tables.recurrences = tables.recurrences.filter(row => !matches(row, where));
        return { count: count - tables.recurrences.length };
      },
    },
    property: { findFirst: findFirst('properties'), create: create('properties') },
    shoppingItem: { findFirst: findFirst('shopping'), create: create('shopping') },
    financialGoal: { findFirst: findFirst('goals'), create: create('goals') },
  } as unknown as PrismaClient;
  return { client, tables };
}

const passwords = { SEED_GUSTAVO_PASSWORD: 'test-password-for-gustavo', SEED_DANI_PASSWORD: 'test-password-for-dani' };

test('runs twice, including concurrently, without duplicating seed income or expenses', async () => {
  const { client, tables } = memoryPrisma();
  await runSeed(client, passwords);
  const originalIncomeAmounts = tables.incomes.map(row => row.amount);
  const originalExpenseAmounts = tables.expenses.map(row => row.amount);
  const categoryIds = new Map(tables.categories.map(row => [`${row.type}:${row.name}`, row.id]));
  await Promise.all([runSeed(client, passwords), runSeed(client, passwords)]);
  assert.equal(tables.households.length, 1);
  assert.equal(tables.users.length, 2);
  assert.equal(tables.householdMembers.length, 2);
  assert.equal(tables.categories.length, 13);
  assert.equal(tables.incomes.length, 4);
  assert.equal(tables.expenses.length, 4);
  assert.equal(new Set(tables.incomes.map(row => row.seedKey)).size, 4);
  assert.equal(new Set(tables.expenses.map(row => row.seedKey)).size, 4);
  assert.deepEqual(tables.incomes.map(row => row.categoryId), [
    categoryIds.get('INCOME:Salário'), categoryIds.get('INCOME:Benefícios'),
    categoryIds.get('INCOME:Salário'), categoryIds.get('INCOME:Benefícios'),
  ]);
  assert.deepEqual(tables.expenses.map(row => row.categoryId), [
    categoryIds.get('EXPENSE:Transporte'), categoryIds.get('EXPENSE:Faculdade'),
    categoryIds.get('EXPENSE:Saúde'), categoryIds.get('EXPENSE:Internet e telefone'),
  ]);
  assert.ok([...tables.incomes, ...tables.expenses].every(row => !('category' in row)));
  assert.deepEqual(tables.incomes.map(row => row.amount), originalIncomeAmounts);
  assert.deepEqual(tables.expenses.map(row => row.amount), originalExpenseAmounts);
});

test('adopts matching unkeyed transactions without changing their amounts', async () => {
  const { client, tables } = memoryPrisma();
  await runSeed(client, passwords);
  const income = tables.incomes[0];
  const expense = tables.expenses[0];
  income.seedKey = null;
  income.amount = '2750.00';
  expense.seedKey = null;
  expense.amount = '725.00';

  await runSeed(client, passwords);

  assert.equal(tables.incomes.length, 4);
  assert.equal(tables.expenses.length, 4);
  assert.equal(income.seedKey, 'futura-casa:initial-income:gross-gustavo:v1');
  assert.equal(expense.seedKey, 'futura-casa:initial-expense:moto-gustavo:v1');
  assert.equal(income.amount, '2750.00');
  assert.equal(expense.amount, '725.00');
});

test('rejects equal passwords before creating seed data', async () => {
  const { client, tables } = memoryPrisma();
  await assert.rejects(runSeed(client, { SEED_GUSTAVO_PASSWORD: 'same-test-password', SEED_DANI_PASSWORD: 'same-test-password' }), /devem ser diferentes/);
  assert.equal(tables.households.length, 0);
});

test('still rejects seed passwords shorter than twelve characters', async () => {
  const { client, tables } = memoryPrisma();
  await assert.rejects(runSeed(client, { SEED_GUSTAVO_PASSWORD: 'short-pass', SEED_DANI_PASSWORD: 'different-long-password' }), /pelo menos 12 caracteres/);
  assert.equal(tables.households.length, 0);
});

test('does not replace existing user password hashes on later seed runs', async () => {
  const { client, tables } = memoryPrisma();
  await runSeed(client, passwords);
  const gus = tables.users.find(row => row.email === 'gustavo@futuracasa.local')!;
  const dani = tables.users.find(row => row.email === 'dani@futuracasa.local')!;
  gus.passwordHash = 'existing-gustavo-hash';
  dani.passwordHash = 'existing-dani-hash';
  await runSeed(client, { SEED_GUSTAVO_PASSWORD: 'another-test-password-for-g', SEED_DANI_PASSWORD: 'another-test-password-for-d' });
  assert.equal(gus.passwordHash, 'existing-gustavo-hash');
  assert.equal(dani.passwordHash, 'existing-dani-hash');
});
