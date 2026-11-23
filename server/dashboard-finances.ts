import { ExpenseNature, ExpenseStatus, IncomeKind } from '@prisma/client';

type Amount = number | { toString(): string };
type IncomeRow = { amount: Amount; kind: IncomeKind; occurredAt: Date };
type ExpenseRow = { amount: Amount; nature: ExpenseNature; status: ExpenseStatus; dueAt: Date; category: { name: string } };
type ContributionRow = { amount: Amount; contributedAt: Date };

const sum = (rows: { amount: Amount }[]) => rows.reduce((total, row) => total + Number(row.amount), 0);
const availableIncomeKinds = new Set<IncomeKind>([IncomeKind.NET_SALARY, IncomeKind.EXTRA, IncomeKind.OTHER]);

export function buildDashboardFinances(incomes: IncomeRow[], expenses: ExpenseRow[], contributions: ContributionRow[], now: Date) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sixMonthStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const monthIncome = incomes.filter(row => row.occurredAt >= monthStart && row.occurredAt < nextMonth);
  const monthExpense = expenses.filter(row => row.dueAt >= monthStart && row.dueAt < nextMonth);
  const categoryMap = new Map<string, number>();
  for (const row of monthExpense) categoryMap.set(row.category.name, (categoryMap.get(row.category.name) ?? 0) + Number(row.amount));

  const chart = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const monthIncomes = incomes.filter(row => row.occurredAt >= date && row.occurredAt < next);
    const monthExpenses = expenses.filter(row => row.dueAt >= date && row.dueAt < next);
    return {
      month: date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      availableIncome: sum(monthIncomes.filter(row => availableIncomeKinds.has(row.kind))),
      paidExpenses: sum(monthExpenses.filter(row => row.status === ExpenseStatus.PAID)),
      goalContributions: sum(contributions.filter(row => row.contributedAt >= date && row.contributedAt < next)),
    };
  });

  return {
    income: {
      gross: sum(monthIncome.filter(row => row.kind === IncomeKind.GROSS_SALARY)),
      netConfirmed: sum(monthIncome.filter(row => row.kind === IncomeKind.NET_SALARY)),
      benefits: sum(monthIncome.filter(row => row.kind === IncomeKind.BENEFIT)),
      extra: sum(monthIncome.filter(row => row.kind === IncomeKind.EXTRA || row.kind === IncomeKind.OTHER)),
    },
    expenses: {
      total: sum(monthExpense),
      fixed: sum(monthExpense.filter(row => row.nature === ExpenseNature.FIXED)),
      variable: sum(monthExpense.filter(row => row.nature === ExpenseNature.VARIABLE)),
      paid: sum(monthExpense.filter(row => row.status === ExpenseStatus.PAID)),
      pending: sum(monthExpense.filter(row => row.status === ExpenseStatus.PENDING)),
      categories: [...categoryMap].map(([name, value]) => ({ name, value })).sort((left, right) => right.value - left.value),
    },
    availableBalance: null,
    balanceNote: 'Saldo disponível: a apurar. Ainda faltam salários líquidos e despesas confirmados.',
    chart,
  };
}

export function dashboardWindow(now: Date) {
  return { sixMonthStart: new Date(now.getFullYear(), now.getMonth() - 5, 1) };
}
