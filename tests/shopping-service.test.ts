import assert from 'node:assert/strict';
import test from 'node:test';
import { ItemStatus, PrismaClient } from '@prisma/client';
import { updateShoppingItemStatus } from '../server/shopping-service.js';

type Row = Record<string, any>;

function memoryPrisma(options: { failUpdate?: boolean; failActivity?: boolean } = {}) {
  const state = {
    items: [
      { id: 'item-1', householdId: 'family-a', name: 'Geladeira', status: ItemStatus.PLANNED, responsible: null },
      { id: 'item-2', householdId: 'family-b', name: 'Fogão', status: ItemStatus.PLANNED, responsible: null },
    ] as Row[],
    activities: [] as Row[],
  };
  const transaction = {
    shoppingItem: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (options.failUpdate) throw new Error('database write failed');
        const row = state.items.find(item => item.id === where.id && item.householdId === where.householdId);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findFirst: async ({ where }: { where: Row }) => state.items.find(item => item.id === where.id && item.householdId === where.householdId) ?? null,
    },
    activityLog: {
      create: async ({ data }: { data: Row }) => {
        if (options.failActivity) throw new Error('activity write failed');
        const row = { id: `activity-${state.activities.length + 1}`, ...data };
        state.activities.push(row);
        return row;
      },
    },
  };
  const client = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) => {
      const snapshot = structuredClone(state);
      try { return await callback(transaction); }
      catch (error) {
        state.items = snapshot.items;
        state.activities = snapshot.activities;
        throw error;
      }
    },
  } as unknown as PrismaClient;
  return { client, state };
}

test('persists all four shopping statuses for members of the same household', async () => {
  const { client, state } = memoryPrisma();
  const statuses = [ItemStatus.PLANNED, ItemStatus.IN_PROGRESS, ItemStatus.PURCHASED, ItemStatus.RECEIVED];
  for (const status of statuses) {
    const saved = await updateShoppingItemStatus(client, 'family-a', 'gustavo', 'item-1', status);
    assert.equal(saved?.status, status);
    const reloadedForDani = state.items.find(item => item.id === 'item-1' && item.householdId === 'family-a');
    assert.equal(reloadedForDani?.status, status);
  }
  assert.deepEqual(state.activities.map(activity => activity.actorId), ['gustavo', 'gustavo', 'gustavo', 'gustavo']);
});

test('does not change an item owned by another household', async () => {
  const { client, state } = memoryPrisma();
  const result = await updateShoppingItemStatus(client, 'family-a', 'gustavo', 'item-2', ItemStatus.PURCHASED);
  assert.equal(result, null);
  assert.equal(state.items.find(item => item.id === 'item-2')?.status, ItemStatus.PLANNED);
  assert.equal(state.activities.length, 0);
});

test('propagates database failures so the API can return an error', async () => {
  const { client, state } = memoryPrisma({ failUpdate: true });
  await assert.rejects(updateShoppingItemStatus(client, 'family-a', 'gustavo', 'item-1', ItemStatus.RECEIVED), /database write failed/);
  assert.equal(state.items.find(item => item.id === 'item-1')?.status, ItemStatus.PLANNED);
});

test('rolls back the status change when activity logging fails', async () => {
  const { client, state } = memoryPrisma({ failActivity: true });
  await assert.rejects(updateShoppingItemStatus(client, 'family-a', 'gustavo', 'item-1', ItemStatus.IN_PROGRESS), /activity write failed/);
  assert.equal(state.items.find(item => item.id === 'item-1')?.status, ItemStatus.PLANNED);
  assert.equal(state.activities.length, 0);
});
