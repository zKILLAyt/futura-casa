import { createHash } from 'node:crypto';
import { Prisma, PrismaClient, TransactionFrequency } from '@prisma/client';
import type { ExpenseNature, ExpenseStatus, IncomeKind } from '@prisma/client';

type RequestContext = { householdId: string; actorId: string };
type IdempotentResult<T> = { row: T; status: 200 | 201 };
type IncomeData = { description: string; amount: number; categoryId: string; responsibleId?: string | null; kind: IncomeKind; frequency: TransactionFrequency; occurredAt?: Date; notes?: string | null };
type ExpenseData = { description: string; amount: number; categoryId: string; responsibleId?: string | null; frequency: TransactionFrequency; nature?: ExpenseNature; dueAt?: Date; status?: ExpenseStatus; isShared?: boolean; notes?: string | null };

export class IdempotencyConflictError extends Error {
  constructor() {
    super('A chave de idempotência já foi usada para outro lançamento.');
    this.name = 'IdempotencyConflictError';
  }
}

export function transactionForApi<T extends { idempotencyKey: unknown; requestHash: unknown; seedKey: unknown }>(row: T) {
  const { idempotencyKey, requestHash, seedKey, ...publicRow } = row;
  void idempotencyKey; void requestHash; void seedKey;
  return publicRow;
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function requestHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

async function syncRecurrence(
  tx: Prisma.TransactionClient,
  householdId: string,
  incomeId: string | null,
  expenseId: string | null,
  frequency: TransactionFrequency,
) {
  if (frequency === TransactionFrequency.ONCE) {
    await tx.recurringTransaction.deleteMany({ where: incomeId ? { incomeId } : { expenseId: expenseId! } });
    return;
  }
  await tx.recurringTransaction.upsert({
    where: incomeId ? { incomeId } : { expenseId: expenseId! },
    update: { householdId, frequency, active: true },
    create: { householdId, frequency, active: true, ...(incomeId ? { incomeId } : { expenseId: expenseId! }) },
  });
}

export async function createIncomeTransaction(
  prisma: PrismaClient,
  context: RequestContext,
  data: IncomeData,
  idempotencyKey: string,
): Promise<IdempotentResult<unknown>> {
  const hash = requestHash(data);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.income.create({
        data: { ...data, householdId: context.householdId, occurredAt: data.occurredAt ?? new Date(), idempotencyKey, requestHash: hash },
        include: { category: true, responsible: { select: { id: true, name: true } } },
      });
      await syncRecurrence(tx, context.householdId, created.id, null, created.frequency);
      await tx.activityLog.create({ data: { householdId: context.householdId, actorId: context.actorId, action: 'criou', entity: 'receita', entityId: created.id, description: created.description, amount: created.amount } });
      return created;
    });
    return { row: transactionForApi(row), status: 201 };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const existing = await prisma.income.findUnique({ where: { householdId_idempotencyKey: { householdId: context.householdId, idempotencyKey } }, include: { category: true, responsible: { select: { id: true, name: true } } } });
    if (!existing) throw error;
    if (existing.requestHash !== hash) throw new IdempotencyConflictError();
    return { row: transactionForApi(existing), status: 200 };
  }
}

export async function createExpenseTransaction(
  prisma: PrismaClient,
  context: RequestContext,
  data: ExpenseData,
  idempotencyKey: string,
): Promise<IdempotentResult<unknown>> {
  const hash = requestHash(data);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: { ...data, householdId: context.householdId, dueAt: data.dueAt ?? new Date(), idempotencyKey, requestHash: hash },
        include: { category: true, responsible: { select: { id: true, name: true } } },
      });
      await syncRecurrence(tx, context.householdId, null, created.id, created.frequency);
      await tx.activityLog.create({ data: { householdId: context.householdId, actorId: context.actorId, action: 'criou', entity: 'despesa', entityId: created.id, description: created.description, amount: created.amount } });
      return created;
    });
    return { row: transactionForApi(row), status: 201 };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const existing = await prisma.expense.findUnique({ where: { householdId_idempotencyKey: { householdId: context.householdId, idempotencyKey } }, include: { category: true, responsible: { select: { id: true, name: true } } } });
    if (!existing) throw error;
    if (existing.requestHash !== hash) throw new IdempotencyConflictError();
    return { row: transactionForApi(existing), status: 200 };
  }
}
