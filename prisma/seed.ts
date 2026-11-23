import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, CategoryType, IncomeKind, TransactionFrequency, ExpenseStatus, ItemPriority, ItemStatus } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const categories = [
  ['Moradia', CategoryType.EXPENSE, '#839c85'], ['Alimentação', CategoryType.EXPENSE, '#d9a45b'],
  ['Transporte', CategoryType.EXPENSE, '#8291a6'], ['Faculdade', CategoryType.EXPENSE, '#9c86af'],
  ['Saúde', CategoryType.EXPENSE, '#d58578'], ['Internet e telefone', CategoryType.EXPENSE, '#6b9d9a'],
  ['Lazer', CategoryType.EXPENSE, '#d58b67'], ['Compras para casa', CategoryType.EXPENSE, '#b18b62'],
  ['Outros', CategoryType.EXPENSE, '#92988f'], ['Salário', CategoryType.INCOME, '#668b70'],
  ['Benefícios', CategoryType.INCOME, '#729b8e'], ['Renda extra', CategoryType.INCOME, '#b69758'],
  ['Outras entradas', CategoryType.INCOME, '#8a8bae'],
] as const;

type SeedEnvironment = { SEED_GUSTAVO_PASSWORD?: string; SEED_DANI_PASSWORD?: string };

export function validateSeedPasswords(environment: SeedEnvironment) {
  const gusPassword = environment.SEED_GUSTAVO_PASSWORD;
  const daniPassword = environment.SEED_DANI_PASSWORD;
  if (!gusPassword || !daniPassword || gusPassword.length < 12 || daniPassword.length < 12) {
    throw new Error('Defina SEED_GUSTAVO_PASSWORD e SEED_DANI_PASSWORD com pelo menos 12 caracteres antes de executar o seed.');
  }
  if (gusPassword === daniPassword) throw new Error('SEED_GUSTAVO_PASSWORD e SEED_DANI_PASSWORD devem ser diferentes.');
  return { gusPassword, daniPassword };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

export async function runSeed(client: PrismaClient, environment: SeedEnvironment) {
  const { gusPassword, daniPassword } = validateSeedPasswords(environment);
  const household = await client.household.upsert({
    where: { id: 'futura-casa-inicial' },
    update: { name: 'Casa Gustavo e Dani' },
    create: { id: 'futura-casa-inicial', name: 'Casa Gustavo e Dani' },
  });
  const gus = await client.user.upsert({
    where: { email: 'gustavo@futuracasa.local' }, update: { name: 'Gustavo' },
    create: { name: 'Gustavo', email: 'gustavo@futuracasa.local', passwordHash: await bcrypt.hash(gusPassword, 12) },
  });
  const dani = await client.user.upsert({
    where: { email: 'dani@futuracasa.local' }, update: { name: 'Dani' },
    create: { name: 'Dani', email: 'dani@futuracasa.local', passwordHash: await bcrypt.hash(daniPassword, 12) },
  });
  for (const user of [gus, dani]) {
    await client.householdMember.upsert({ where: { householdId_userId: { householdId: household.id, userId: user.id } }, update: {}, create: { householdId: household.id, userId: user.id, role: 'ADMIN' } });
  }
  const categoryIds = new Map<string, string>();
  for (const [name, type, color] of categories) {
    const row = await client.category.upsert({ where: { householdId_name_type: { householdId: household.id, name, type } }, update: { color }, create: { householdId: household.id, name, type, color } });
    categoryIds.set(`${type}:${name}`, row.id);
  }

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(9, 0, 0, 0);
  const incomeSeeds = [
    { seedKey: 'futura-casa:initial-income:gross-gustavo:v1', description: 'Salário bruto · Gustavo', amount: '2500.00', kind: IncomeKind.GROSS_SALARY, responsibleId: gus.id, category: 'Salário' },
    { seedKey: 'futura-casa:initial-income:benefit-gustavo:v1', description: 'Vale-alimentação · Gustavo', amount: '400.00', kind: IncomeKind.BENEFIT, responsibleId: gus.id, category: 'Benefícios' },
    { seedKey: 'futura-casa:initial-income:gross-dani:v1', description: 'Salário bruto · Dani', amount: '1809.00', kind: IncomeKind.GROSS_SALARY, responsibleId: dani.id, category: 'Salário' },
    { seedKey: 'futura-casa:initial-income:benefit-dani:v1', description: 'Vale-alimentação · Dani', amount: '600.00', kind: IncomeKind.BENEFIT, responsibleId: dani.id, category: 'Benefícios' },
  ];
  for (const { category, ...item } of incomeSeeds) {
    const row = await ensureInitialIncome(client, {
      householdId: household.id, ...item,
      categoryId: categoryIds.get(`${CategoryType.INCOME}:${category}`)!,
      occurredAt: monthStart, frequency: TransactionFrequency.MONTHLY,
      notes: 'Valor inicial informado. Salário bruto/benefício; não representa renda líquida.',
    });
    await syncInitialRecurrence(client, household.id, row.id, null, row.frequency);
  }
  const expenseSeeds = [
    { seedKey: 'futura-casa:initial-expense:moto-gustavo:v1', description: 'Parcela da moto · Gustavo', amount: '700.00', category: 'Transporte', responsibleId: gus.id },
    { seedKey: 'futura-casa:initial-expense:college-gustavo:v1', description: 'Faculdade · Gustavo', amount: '391.00', category: 'Faculdade', responsibleId: gus.id },
    { seedKey: 'futura-casa:initial-expense:health-gustavo:v1', description: 'Plano de saúde · Gustavo', amount: '59.00', category: 'Saúde', responsibleId: gus.id },
    { seedKey: 'futura-casa:initial-expense:phone-dani:v1', description: 'Celular · Dani', amount: '59.00', category: 'Internet e telefone', responsibleId: dani.id },
  ];
  for (const { category, ...item } of expenseSeeds) {
    const row = await ensureInitialExpense(client, {
      householdId: household.id, ...item,
      categoryId: categoryIds.get(`${CategoryType.EXPENSE}:${category}`)!,
      dueAt: monthStart, status: ExpenseStatus.PENDING, frequency: TransactionFrequency.MONTHLY,
      isShared: false, notes: 'Valor inicial informado pelo casal.',
    });
    await syncInitialRecurrence(client, household.id, null, row.id, row.frequency);
  }

  const listingUrl = 'https://www.vivareal.com.br/imovel/casa-1-quartos-machados-bairros-navegantes-com-garagem-35m2-aluguel-RS1800-id-2915313854/';
  if (!(await client.property.findFirst({ where: { householdId: household.id, listingUrl } }))) {
    await client.property.create({ data: { householdId: household.id, title: 'Casa em Machados', location: 'Machados, Navegantes/SC', rent: '1800.00', iptu: '11.00', fireInsurance: '17.27', trashFee: '50.00', condoFee: '0.00', areaM2: '35', bedrooms: 1, bathrooms: 1, parkingSpaces: 2, listingUrl, status: 'EM_ANALISE' } });
  }
  for (const name of ['Geladeira', 'Fogão', 'Máquina de lavar', 'Cama', 'Guarda-roupa', 'Mesa', 'Sofá', 'Utensílios domésticos', 'Produtos de limpeza']) {
    if (!(await client.shoppingItem.findFirst({ where: { householdId: household.id, name } }))) {
      await client.shoppingItem.create({ data: { householdId: household.id, name, quantity: 1, priority: ['Geladeira', 'Fogão', 'Cama', 'Produtos de limpeza'].includes(name) ? ItemPriority.ESSENTIAL : ItemPriority.IMPORTANT, status: ItemStatus.PLANNED } });
    }
  }
  for (const name of ['Reserva para mudança', 'Reserva de emergência']) {
    if (!(await client.financialGoal.findFirst({ where: { householdId: household.id, name } }))) await client.financialGoal.create({ data: { householdId: household.id, name } });
  }
  console.log('Orçamento compartilhado inicializado.');
}

async function ensureInitialIncome(client: PrismaClient, data: Prisma.IncomeUncheckedCreateInput) {
  const existing = await client.income.findFirst({ where: { householdId: data.householdId, seedKey: null, description: data.description } });
  if (existing) return client.income.update({ where: { id: existing.id }, data: { seedKey: data.seedKey } });
  try {
    return await client.income.upsert({ where: { seedKey: data.seedKey! }, update: {}, create: data });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const concurrent = await client.income.findUnique({ where: { seedKey: data.seedKey! } });
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function ensureInitialExpense(client: PrismaClient, data: Prisma.ExpenseUncheckedCreateInput) {
  const existing = await client.expense.findFirst({ where: { householdId: data.householdId, seedKey: null, description: data.description } });
  if (existing) return client.expense.update({ where: { id: existing.id }, data: { seedKey: data.seedKey } });
  try {
    return await client.expense.upsert({ where: { seedKey: data.seedKey! }, update: {}, create: data });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const concurrent = await client.expense.findUnique({ where: { seedKey: data.seedKey! } });
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function syncInitialRecurrence(client: PrismaClient, householdId: string, incomeId: string | null, expenseId: string | null, frequency: TransactionFrequency) {
  const unique = incomeId ? { incomeId } : { expenseId: expenseId! };
  if (frequency === TransactionFrequency.ONCE) return client.recurringTransaction.deleteMany({ where: unique });
  try {
    return await client.recurringTransaction.upsert({
      where: unique,
      update: { householdId, frequency, active: true },
      create: { householdId, frequency, active: true, ...(incomeId ? { incomeId } : { expenseId: expenseId! }) },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const existing = await client.recurringTransaction.findUnique({ where: unique });
    if (!existing) throw error;
    return existing;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runSeed(prisma, process.env)
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(async () => prisma.$disconnect());
}
