import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { PrismaClient, CategoryType, IncomeKind, TransactionFrequency, ExpenseStatus, ExpenseNature, ItemPriority, ItemStatus, Prisma } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardFinances, dashboardWindow } from './dashboard-finances.js';
import { createExpenseTransaction, createIncomeTransaction, IdempotencyConflictError, transactionForApi } from './transaction-service.js';
import { updateShoppingItemStatus } from './shopping-service.js';

const prisma = new PrismaClient();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PgSessionStore = connectPgSimple(session);
const app = express();
const port = Number(process.env.PORT ?? 4000);
const frontendOrigin = process.env.FRONTEND_URL ?? 'http://localhost:5173';

if (!process.env.DATABASE_URL || (process.env.SESSION_SECRET ?? '').length < 32) {
  throw new Error('Configure DATABASE_URL e SESSION_SECRET (mínimo de 32 caracteres) no arquivo .env.');
}
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  store: new PgSessionStore({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'futura.sid', secret: process.env.SESSION_SECRET!, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 },
}));

declare module 'express-session' { interface SessionData { userId?: string } }
declare global { namespace Express { interface Request { householdId?: string; currentUser?: { id: string; name: string; email: string } } } }

const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };
const positiveAmount = z.coerce.number().finite().positive().max(99_999_999);
const frequency = z.nativeEnum(TransactionFrequency);
const incomeSchema = z.object({ description: z.string().trim().min(1).max(120), amount: positiveAmount, categoryId: z.string().min(1), responsibleId: z.string().nullable().optional(), kind: z.nativeEnum(IncomeKind), frequency, occurredAt: z.coerce.date().optional(), notes: z.string().trim().max(500).nullable().optional() });
const expenseSchema = z.object({ description: z.string().trim().min(1).max(120), amount: positiveAmount, categoryId: z.string().min(1), responsibleId: z.string().nullable().optional(), frequency, nature: z.nativeEnum(ExpenseNature).default(ExpenseNature.FIXED), dueAt: z.coerce.date().optional(), status: z.nativeEnum(ExpenseStatus).optional(), isShared: z.boolean().optional(), notes: z.string().trim().max(500).nullable().optional() });

function readIdempotencyKey(req: Request, res: Response): string | null {
  const key = req.get('Idempotency-Key')?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    res.status(400).json({ error: 'Envie uma chave Idempotency-Key entre 8 e 128 caracteres.' });
    return null;
  }
  return key;
}

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    const membership = await prisma.householdMember.findFirst({ where: { userId: req.session.userId }, include: { user: { select: { id: true, name: true, email: true } } } });
    if (!membership) { req.session.destroy(() => undefined); return res.status(401).json({ error: 'Conta sem orçamento vinculado.' }); }
    req.householdId = membership.householdId; req.currentUser = membership.user; next();
  } catch (error) { next(error); }
}
const auth = express.Router();
auth.get('/me', requireAuth, (req, res) => res.json({ user: req.currentUser }));
auth.post('/login', rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe seu e-mail e senha.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.trim().toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
}));
auth.post('/logout', (req, res, next) => req.session.destroy((error) => error ? next(error) : res.clearCookie('futura.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }).json({ ok: true })));
app.use('/api/auth', auth);

const api = express.Router();
api.use(requireAuth);
api.get('/categories', asyncRoute(async (req, res) => {
  const rows = await prisma.category.findMany({ where: { householdId: req.householdId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  res.json(rows);
}));
api.get('/incomes', asyncRoute(async (req, res) => {
  const rows = await prisma.income.findMany({ where: { householdId: req.householdId }, include: { category: true, responsible: { select: { id: true, name: true } } }, orderBy: { occurredAt: 'desc' } });
  res.json(rows.map(transactionForApi));
}));
api.post('/incomes', asyncRoute(async (req, res) => {
  const data = incomeSchema.parse(req.body); const householdId = req.householdId!;
  const idempotencyKey = readIdempotencyKey(req, res); if (!idempotencyKey) return;
  const category = await prisma.category.findFirst({ where: { id: data.categoryId, householdId, type: CategoryType.INCOME } });
  if (!category) return res.status(400).json({ error: 'Selecione uma categoria de receita válida.' });
  if (data.responsibleId && !(await prisma.householdMember.findFirst({ where: { householdId, userId: data.responsibleId } }))) return res.status(400).json({ error: 'Pessoa responsável inválida.' });
  const result = await createIncomeTransaction(prisma, { householdId, actorId: req.currentUser!.id }, data, idempotencyKey);
  res.status(result.status).json(result.row);
}));
api.patch('/incomes/:id', asyncRoute(async (req, res) => {
  const data = incomeSchema.partial().parse(req.body); const householdId = req.householdId!;
  const old = await prisma.income.findFirst({ where: { id: req.params.id, householdId } });
  if (!old) return res.status(404).json({ error: 'Receita não encontrada.' });
  if (data.categoryId && !(await prisma.category.findFirst({ where: { id: data.categoryId, householdId, type: CategoryType.INCOME } }))) return res.status(400).json({ error: 'Categoria de receita inválida.' });
  if (data.responsibleId && !(await prisma.householdMember.findFirst({ where: { householdId, userId: data.responsibleId } }))) return res.status(400).json({ error: 'Pessoa responsável inválida.' });
  const row = await prisma.income.update({ where: { id: old.id }, data, include: { category: true, responsible: { select: { id: true, name: true } } } });
  await syncRecurrence(householdId, row.id, null, row.frequency); await logActivity(req, 'editou', 'receita', row.id, row.description, row.amount); res.json(transactionForApi(row));
}));
api.delete('/incomes/:id', asyncRoute(async (req, res) => {
  const row = await prisma.income.findFirst({ where: { id: req.params.id, householdId: req.householdId } }); if (!row) return res.status(404).json({ error: 'Receita não encontrada.' });
  await prisma.income.delete({ where: { id: row.id } }); await logActivity(req, 'removeu', 'receita', row.id, row.description, row.amount); res.json({ ok: true });
}));

api.get('/expenses', asyncRoute(async (req, res) => {
  const rows = await prisma.expense.findMany({ where: { householdId: req.householdId }, include: { category: true, responsible: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] });
  res.json(rows.map(transactionForApi));
}));
api.post('/expenses', asyncRoute(async (req, res) => {
  const data = expenseSchema.parse(req.body); const householdId = req.householdId!;
  const idempotencyKey = readIdempotencyKey(req, res); if (!idempotencyKey) return;
  if (!(await prisma.category.findFirst({ where: { id: data.categoryId, householdId, type: CategoryType.EXPENSE } }))) return res.status(400).json({ error: 'Selecione uma categoria de despesa válida.' });
  if (data.responsibleId && !(await prisma.householdMember.findFirst({ where: { householdId, userId: data.responsibleId } }))) return res.status(400).json({ error: 'Pessoa responsável inválida.' });
  const result = await createExpenseTransaction(prisma, { householdId, actorId: req.currentUser!.id }, data, idempotencyKey);
  res.status(result.status).json(result.row);
}));
api.patch('/expenses/:id', asyncRoute(async (req, res) => {
  const data = expenseSchema.partial().parse(req.body); const householdId = req.householdId!;
  const old = await prisma.expense.findFirst({ where: { id: req.params.id, householdId } }); if (!old) return res.status(404).json({ error: 'Despesa não encontrada.' });
  if (data.categoryId && !(await prisma.category.findFirst({ where: { id: data.categoryId, householdId, type: CategoryType.EXPENSE } }))) return res.status(400).json({ error: 'Categoria de despesa inválida.' });
  if (data.responsibleId && !(await prisma.householdMember.findFirst({ where: { householdId, userId: data.responsibleId } }))) return res.status(400).json({ error: 'Pessoa responsável inválida.' });
  const row = await prisma.expense.update({ where: { id: old.id }, data, include: { category: true, responsible: { select: { id: true, name: true } } } });
  await syncRecurrence(householdId, null, row.id, row.frequency); await logActivity(req, 'editou', 'despesa', row.id, row.description, row.amount); res.json(transactionForApi(row));
}));
api.delete('/expenses/:id', asyncRoute(async (req, res) => {
  const row = await prisma.expense.findFirst({ where: { id: req.params.id, householdId: req.householdId } }); if (!row) return res.status(404).json({ error: 'Despesa não encontrada.' });
  await prisma.expense.delete({ where: { id: row.id } }); await logActivity(req, 'removeu', 'despesa', row.id, row.description, row.amount); res.json({ ok: true });
}));

api.get('/properties', asyncRoute(async (req, res) => res.json(await prisma.property.findMany({ where: { householdId: req.householdId }, orderBy: { createdAt: 'desc' } }))));
const itemSchema = z.object({ name: z.string().trim().min(1).max(100), quantity: z.coerce.number().int().positive().max(999).default(1), estimatedCost: z.coerce.number().nonnegative().nullable().optional(), paidCost: z.coerce.number().nonnegative().nullable().optional(), priority: z.nativeEnum(ItemPriority).default(ItemPriority.IMPORTANT), status: z.nativeEnum(ItemStatus).default(ItemStatus.PLANNED), responsibleId: z.string().nullable().optional(), notes: z.string().trim().max(500).nullable().optional() });
const shoppingStatusSchema = z.object({ status: z.nativeEnum(ItemStatus) }).strict();
api.get('/shopping', asyncRoute(async (req, res) => res.json(await prisma.shoppingItem.findMany({ where: { householdId: req.householdId }, include: { responsible: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { priority: 'asc' }, { name: 'asc' }] }))));
api.post('/shopping', asyncRoute(async (req, res) => {
  const data = itemSchema.parse(req.body); const householdId = req.householdId!;
  if (data.responsibleId && !(await prisma.householdMember.findFirst({ where: { householdId, userId: data.responsibleId } }))) return res.status(400).json({ error: 'Pessoa responsável inválida.' });
  const row = await prisma.shoppingItem.create({ data: { ...data, householdId }, include: { responsible: { select: { id: true, name: true } } } }); await logActivity(req, 'adicionou', 'item', row.id, row.name); res.status(201).json(row);
}));
api.patch('/shopping/:id', asyncRoute(async (req, res) => {
  const statusChange = shoppingStatusSchema.safeParse(req.body);
  if (statusChange.success) {
    const row = await updateShoppingItemStatus(prisma, req.householdId!, req.currentUser!.id, req.params.id, statusChange.data.status);
    if (!row) return res.status(404).json({ error: 'Item não encontrado.' });
    return res.json(row);
  }
  const data = itemSchema.partial().parse(req.body); const old = await prisma.shoppingItem.findFirst({ where: { id: req.params.id, householdId: req.householdId } }); if (!old) return res.status(404).json({ error: 'Item não encontrado.' });
  if (data.responsibleId && !(await prisma.householdMember.findFirst({ where: { householdId: req.householdId, userId: data.responsibleId } }))) return res.status(400).json({ error: 'Pessoa responsável inválida.' });
  const row = await prisma.shoppingItem.update({ where: { id: old.id }, data, include: { responsible: { select: { id: true, name: true } } } }); await logActivity(req, 'atualizou', 'item', row.id, row.name); res.json(row);
}));
api.delete('/shopping/:id', asyncRoute(async (req, res) => {
  const row = await prisma.shoppingItem.findFirst({ where: { id: req.params.id, householdId: req.householdId } }); if (!row) return res.status(404).json({ error: 'Item não encontrado.' });
  await prisma.shoppingItem.delete({ where: { id: row.id } }); await logActivity(req, 'removeu', 'item', row.id, row.name); res.json({ ok: true });
}));

api.get('/goals', asyncRoute(async (req, res) => {
  const goals = await prisma.financialGoal.findMany({ where: { householdId: req.householdId }, include: { contributions: { include: { user: { select: { id: true, name: true } } }, orderBy: { contributedAt: 'desc' } } }, orderBy: { createdAt: 'asc' } });
  res.json(goals.map(goal => ({ ...goal, contributed: goal.contributions.reduce((sum, c) => sum + Number(c.amount), 0) })));
}));
const goalSchema = z.object({ name: z.string().trim().min(1).max(100), targetAmount: z.coerce.number().positive().nullable().optional(), targetDate: z.coerce.date().nullable().optional() });
api.post('/goals', asyncRoute(async (req, res) => { const data = goalSchema.parse(req.body); const row = await prisma.financialGoal.create({ data: { ...data, householdId: req.householdId! } }); await logActivity(req, 'criou', 'meta', row.id, row.name); res.status(201).json({ ...row, contributed: 0, contributions: [] }); }));
api.patch('/goals/:id', asyncRoute(async (req, res) => { const data = goalSchema.partial().parse(req.body); const old = await prisma.financialGoal.findFirst({ where: { id: req.params.id, householdId: req.householdId } }); if (!old) return res.status(404).json({ error: 'Meta não encontrada.' }); const row = await prisma.financialGoal.update({ where: { id: old.id }, data }); res.json(row); }));
api.post('/goals/:id/contributions', asyncRoute(async (req, res) => {
  const parsed = z.object({ amount: positiveAmount, note: z.string().trim().max(300).optional() }).parse(req.body); const goal = await prisma.financialGoal.findFirst({ where: { id: req.params.id, householdId: req.householdId } }); if (!goal) return res.status(404).json({ error: 'Meta não encontrada.' });
  const contribution = await prisma.goalContribution.create({ data: { goalId: goal.id, userId: req.currentUser!.id, amount: parsed.amount, note: parsed.note }, include: { user: { select: { id: true, name: true } } } });
  await logActivity(req, 'contribuiu para', 'meta', goal.id, goal.name, contribution.amount); res.status(201).json(contribution);
}));

api.get('/dashboard', asyncRoute(async (req, res) => {
  const householdId = req.householdId!; const now = new Date(); const { sixMonthStart } = dashboardWindow(now);
  const [incomes, expenses, properties, goals, shopping, activities, contributions] = await Promise.all([
    prisma.income.findMany({ where: { householdId, occurredAt: { gte: sixMonthStart } }, include: { category: true, responsible: { select: { name: true } } } }),
    prisma.expense.findMany({ where: { householdId, dueAt: { gte: sixMonthStart } }, include: { category: true, responsible: { select: { name: true } } } }),
    prisma.property.findMany({ where: { householdId } }),
    prisma.financialGoal.findMany({ where: { householdId }, include: { contributions: true } }),
    prisma.shoppingItem.findMany({ where: { householdId } }),
    prisma.activityLog.findMany({ where: { householdId }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.goalContribution.findMany({ where: { goal: { is: { householdId } }, contributedAt: { gte: sixMonthStart } } }),
  ]);
  const finances = buildDashboardFinances(incomes, expenses, contributions, now);
  res.json({
    month: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    ...finances, properties: properties.map(p => ({ ...p, monthlyTotal: Number(p.rent) + Number(p.iptu) + Number(p.fireInsurance) + Number(p.trashFee) + Number(p.condoFee) })),
    goals: goals.map(g => { const contributed = g.contributions.reduce((total, contribution) => total + Number(contribution.amount), 0); return { id: g.id, name: g.name, targetAmount: g.targetAmount ? Number(g.targetAmount) : null, contributed, progress: g.targetAmount ? Math.min(100, contributed / Number(g.targetAmount) * 100) : null }; }),
    shopping: { count: shopping.length, estimated: shopping.reduce((total, item) => total + Number(item.estimatedCost ?? 0) * item.quantity, 0), pricedCount: shopping.filter(item => item.estimatedCost !== null).length },
    activities: activities.map(a => ({ id: a.id, action: a.action, entity: a.entity, description: a.description, amount: a.amount === null ? null : Number(a.amount), actor: a.actor?.name ?? 'Alguém', createdAt: a.createdAt })),
    members: (await prisma.householdMember.findMany({ where: { householdId }, include: { user: { select: { id: true, name: true } } } })).map(m => m.user),
  });
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', api);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Confira os campos informados.', fields: error.flatten().fieldErrors });
  if (error instanceof IdempotencyConflictError) return res.status(409).json({ error: error.message });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ error: 'Registro não encontrado.' });
  console.error(error);
  res.status(500).json({ error: 'Não foi possível concluir esta ação. Tente novamente.' });
});

async function syncRecurrence(householdId: string, incomeId: string | null, expenseId: string | null, freq: TransactionFrequency) {
  const where = incomeId ? { incomeId } : { expenseId: expenseId! };
  if (freq === TransactionFrequency.ONCE) await prisma.recurringTransaction.deleteMany({ where });
  else await prisma.recurringTransaction.upsert({ where: incomeId ? { incomeId } : { expenseId: expenseId! }, update: { householdId, frequency: freq, active: true }, create: { householdId, frequency: freq, active: true, ...(incomeId ? { incomeId } : { expenseId: expenseId! }) } });
}
async function logActivity(req: Request, action: string, entity: string, entityId: string, description: string, amount?: Prisma.Decimal) {
  await prisma.activityLog.create({ data: { householdId: req.householdId!, actorId: req.currentUser?.id, action, entity, entityId, description, amount } });
}

if (process.env.NODE_ENV === 'production') {
  const currentFile = fileURLToPath(import.meta.url); const dir = path.dirname(currentFile);
  app.use(express.static(path.resolve(dir, '../dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(dir, '../dist/index.html')));
}
app.listen(port, () => console.log(`Futura Casa API disponível na porta ${port}.`));
