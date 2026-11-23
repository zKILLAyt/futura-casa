import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpenseNature, ExpenseStatus, IncomeKind } from '@prisma/client';
import { buildDashboardFinances } from '../server/dashboard-finances.js';

test('does not invent an available balance and keeps salary and benefits separate', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  const finance = buildDashboardFinances([
    { amount: 2500, kind: IncomeKind.GROSS_SALARY, occurredAt: new Date('2026-11-01T09:00:00.000Z') },
    { amount: 1800, kind: IncomeKind.NET_SALARY, occurredAt: new Date('2026-11-01T09:00:00.000Z') },
    { amount: 400, kind: IncomeKind.BENEFIT, occurredAt: new Date('2026-11-01T09:00:00.000Z') },
    { amount: 100, kind: IncomeKind.EXTRA, occurredAt: new Date('2026-11-12T09:00:00.000Z') },
  ], [
    { amount: 500, nature: ExpenseNature.FIXED, status: ExpenseStatus.PAID, dueAt: new Date('2026-11-05T09:00:00.000Z'), category: { name: 'Moradia' } },
    { amount: 200, nature: ExpenseNature.VARIABLE, status: ExpenseStatus.PENDING, dueAt: new Date('2026-11-15T09:00:00.000Z'), category: { name: 'Alimentação' } },
  ], [{ amount: 75, contributedAt: new Date('2026-11-20T09:00:00.000Z') }], now);

  assert.equal(finance.availableBalance, null);
  assert.equal(finance.balanceNote, 'Saldo disponível: a apurar. Ainda faltam salários líquidos e despesas confirmados.');
  assert.deepEqual(finance.income, { gross: 2500, netConfirmed: 1800, benefits: 400, extra: 100 });
  assert.equal(finance.expenses.paid, 500);
  assert.equal(finance.expenses.pending, 200);
  const currentMonth = finance.chart.at(-1)!;
  assert.equal(currentMonth.availableIncome, 1900);
  assert.equal(currentMonth.paidExpenses, 500);
  assert.equal(currentMonth.goalContributions, 75);
});
