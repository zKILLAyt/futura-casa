import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Baby, BedDouble, Check, ChevronDown, CircleHelp,
  ClipboardList, CreditCard, House, Lamp, LayoutDashboard, LogOut, Menu, Moon, MoreHorizontal, PackageCheck,
  Pencil, Plus, ShieldCheck, ShoppingBasket, Sun, Trash2, TrendingUp, Wallet, WashingMachine, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Category, DashboardData, Expense, Goal, Income, Property, ShoppingItem, ShoppingStatus, User } from './types';

const DashboardCharts = lazy(() => import('./DashboardCharts'));

type Page = 'overview' | 'income' | 'expenses' | 'home' | 'shopping' | 'goals';
type ModalName = 'income' | 'expense' | 'item' | 'goal' | 'contribution' | null;
type RequestOptions = { method?: string; body?: unknown; idempotencyKey?: string };
const money = (value: number | string | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));
const number = (value: number | string | null | undefined) => Number(value ?? 0);
const todayLocal = () => { const current = new Date(); return new Date(current.getTime() - current.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
const dateLabel = (value: string) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const kindLabel: Record<Income['kind'], string> = { GROSS_SALARY: 'Salário bruto', NET_SALARY: 'Salário líquido', BENEFIT: 'Benefício', EXTRA: 'Renda extra', OTHER: 'Outra entrada' };
const frequencyLabel: Record<string, string> = { MONTHLY: 'Todo mês', WEEKLY: 'Toda semana', YEARLY: 'Todo ano', ONCE: 'Pontual' };
const nav: { id: Page; label: string; icon: LucideIcon; group: string }[] = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard, group: 'Seu espaço' },
  { id: 'income', label: 'Receitas', icon: ArrowDownLeft, group: 'Seu espaço' },
  { id: 'expenses', label: 'Despesas', icon: ArrowUpRight, group: 'Seu espaço' },
  { id: 'home', label: 'A futura casa', icon: House, group: 'Planos do casal' },
  { id: 'shopping', label: 'Lista de compras', icon: ShoppingBasket, group: 'Planos do casal' },
  { id: 'goals', label: 'Metas financeiras', icon: TrendingUp, group: 'Planos do casal' },
];

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) };
  const response = await fetch(`/api${path}`, { method: options.method ?? 'GET', credentials: 'include', headers, body: options.body ? JSON.stringify(options.body) : undefined });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Algo deu errado. Tente novamente.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('overview');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [toastIsError, setToastIsError] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [editing, setEditing] = useState<Income | Expense | ShoppingItem | Goal | null>(null);
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('futura-theme') === 'dark');

  const loadData = useCallback(async () => {
    const [summary, incomeRows, expenseRows, categoryRows, propertyRows, shoppingRows, goalRows] = await Promise.all([
      request<DashboardData>('/dashboard'), request<Income[]>('/incomes'), request<Expense[]>('/expenses'), request<Category[]>('/categories'),
      request<Property[]>('/properties'), request<ShoppingItem[]>('/shopping'), request<Goal[]>('/goals'),
    ]);
    setDashboard(summary); setIncomes(incomeRows); setExpenses(expenseRows); setCategories(categoryRows); setProperties(propertyRows); setItems(shoppingRows); setGoals(goalRows);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('futura-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    request<{ user: User }>('/auth/me').then(({ user: current }) => { setUser(current); return loadData(); }).catch(() => setUser(null)).finally(() => setLoading(false));
  }, [loadData]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError('');
    try { await action(); await loadData(); setModal(null); setEditing(null); setToastIsError(false); setToast(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const changeShoppingStatus = async (item: ShoppingItem, status: ShoppingStatus) => {
    const previousStatus = items.find(current => current.id === item.id)?.status ?? item.status;
    setItems(current => current.map(row => row.id === item.id ? { ...row, status } : row));
    try {
      const saved = await request<ShoppingItem>(`/shopping/${item.id}`, { method: 'PATCH', body: { status } });
      setItems(current => current.map(row => row.id === item.id ? saved : row));
      setToastIsError(false);
      setToast(`${item.name}: ${statusLabel(saved.status)}`);
    } catch (error) {
      try {
        const latest = await request<ShoppingItem[]>('/shopping');
        setItems(latest);
      } catch {
        setItems(current => current.map(row => row.id === item.id ? { ...row, status: previousStatus } : row));
      }
      setToastIsError(true);
      setToast(error instanceof Error ? error.message : 'Não foi possível atualizar o status.');
    }
  };
  const openModal = (which: ModalName, record: Income | Expense | ShoppingItem | Goal | null = null) => { setError(''); setEditing(record); setModal(which); };
  const logout = async () => { await request('/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); setPage('overview'); };
  const currentPage = nav.find(item => item.id === page)!;

  if (loading) return <div className="boot-screen"><div className="brand-mark"><House size={22} /></div><span>Preparando o nosso cantinho...</span></div>;
  if (!user) return <Login onLogin={async (email, password) => { const result = await request<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } }); setUser(result.user); await loadData(); }} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><div className="brand-mark"><House size={20} strokeWidth={1.9} /></div><div><b>futura casa</b><span>planos que viram lar</span></div><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X size={18} /></button></div>
        <div className="nav-stack">
          {(['Seu espaço', 'Planos do casal'] as const).map(group => <div className="nav-group" key={group}><span className="nav-caption">{group}</span>{nav.filter(item => item.group === group).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'selected' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{page === item.id && <span className="nav-dot" />}</button>)}</div>)}
        </div>
        <div className="sidebar-bottom"><div className="household-chip"><div className="couple-avatars"><span>G</span><span>D</span></div><div><b>Gustavo & Dani</b><small>Orçamento compartilhado</small></div><ShieldCheck size={16} className="shield-icon" /></div><button className="profile-row" onClick={logout}><div className="avatar avatar-dark">{user.name.slice(0, 1)}</div><div className="profile-copy"><b>{user.name}</b><small>Sair da conta</small></div><LogOut size={17} /></button><span className="sidebar-footnote"><ShieldCheck size={12} /> Seus dados ficam só com vocês dois</span></div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Fechar menu" />}
      <main className="main-area">
        <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu size={20} /></button><div className="breadcrumb"><span>Gustavo & Dani</span><span className="crumb-slash">/</span><b>{currentPage.label}</b></div><div className="top-actions"><div className="top-status"><span className="live-dot" /> Espaço do casal</div><button className="icon-button theme-toggle" onClick={() => setDark(value => !value)} aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><div className="avatar">{user.name.slice(0, 1)}</div></div></header>
        <div className="page-content">
          {page === 'overview' && dashboard && <Overview dashboard={dashboard} user={user} incomes={incomes} expenses={expenses} onNavigate={setPage} />}
          {page === 'income' && <Transactions mode="income" entries={incomes} members={dashboard?.members ?? []} onAdd={() => openModal('income')} onEdit={row => openModal('income', row)} onRefresh={loadData} onToast={setToast} />}
          {page === 'expenses' && <Transactions mode="expense" entries={expenses} members={dashboard?.members ?? []} onAdd={() => openModal('expense')} onEdit={row => openModal('expense', row)} onRefresh={loadData} onToast={setToast} />}
          {page === 'home' && <HomePage properties={properties} />}
          {page === 'shopping' && <ShoppingPage items={items} onAdd={() => openModal('item')} onEdit={row => openModal('item', row)} onStatusChange={changeShoppingStatus} onDelete={async item => { if (confirm(`Remover “${item.name}” da lista?`)) await mutate(() => request(`/shopping/${item.id}`, { method: 'DELETE' }), 'Item removido'); }} />}
          {page === 'goals' && <GoalsPage goals={goals} onAdd={() => openModal('goal')} onEdit={goal => openModal('goal', goal)} onContribute={goal => { setActiveGoal(goal); openModal('contribution'); }} />}
        </div>
      </main>
      {modal && <Modal title={modalTitle(modal, editing)} onClose={() => { setModal(null); setEditing(null); setError(''); }} error={error}>
        {(modal === 'income' || modal === 'expense') && <TransactionForm mode={modal} editing={editing as Income | Expense | null} categories={categories.filter(c => c.type === (modal === 'income' ? 'INCOME' : 'EXPENSE'))} members={dashboard?.members ?? []} busy={busy} onCancel={() => setModal(null)} onSubmit={(data, idempotencyKey) => mutate(() => request(`/${modal === 'income' ? 'incomes' : 'expenses'}${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: data, idempotencyKey: editing ? undefined : idempotencyKey }), editing ? 'Lançamento atualizado' : 'Lançamento adicionado')} />}
        {modal === 'item' && <ShoppingForm editing={editing as ShoppingItem | null} members={dashboard?.members ?? []} busy={busy} onCancel={() => setModal(null)} onSubmit={data => mutate(() => request(`/shopping${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: data }), editing ? 'Item atualizado' : 'Item adicionado à lista')} />}
        {modal === 'goal' && <GoalForm editing={editing as Goal | null} busy={busy} onCancel={() => setModal(null)} onSubmit={data => mutate(() => request(`/goals${editing ? `/${editing.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: data }), editing ? 'Meta atualizada' : 'Meta criada')} />}
        {modal === 'contribution' && activeGoal && <ContributionForm goal={activeGoal} busy={busy} onCancel={() => setModal(null)} onSubmit={data => mutate(() => request(`/goals/${activeGoal.id}/contributions`, { method: 'POST', body: data }), 'Contribuição registrada')} />}
      </Modal>}
      {toast && <div className={`toast ${toastIsError ? 'toast-error' : ''}`} role={toastIsError ? 'alert' : 'status'}><span className="toast-check">{toastIsError ? <CircleHelp size={14} /> : <Check size={14} />}</span>{toast}</div>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); setBusy(true); try { await onLogin(email, password); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar.'); } finally { setBusy(false); } };
  return <div className="login-screen"><div className="login-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="sun-circle" /><div className="art-home"><div className="art-roof" /><div className="art-house"><span className="art-window window-left" /><span className="art-window window-right" /><span className="art-door" /></div><div className="art-ground" /></div><div className="art-copy"><div className="brand-mark mark-light"><House size={20} /></div><span>Um lar começa com um plano.</span><p>Um passo de cada vez,<br />juntos até a próxima casa.</p></div><div className="art-small-note">F&G <span>·</span> 2026</div></div><div className="login-panel"><div className="login-brand"><div className="brand-mark"><House size={20} /></div><div><b>futura casa</b><span>planos que viram lar</span></div></div><form className="login-form" onSubmit={submit}><span className="eyebrow">BEM-VINDOS DE VOLTA</span><h1>O próximo capítulo<br />começa aqui.</h1><p>Entre na conta compartilhada para continuar planejando.</p><label>E-mail<input autoComplete="username" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" required /></label><label>Senha<input autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha" required /></label>{error && <div className="form-error">{error}</div>}<button className="button button-primary login-submit" disabled={busy}>{busy ? 'Entrando...' : <>Entrar no nosso espaço <ArrowRight size={17} /></>}</button><div className="login-assurance"><ShieldCheck size={15} /> Um espaço privado para vocês dois.</div></form><span className="login-footer">feito de planos e carinho <span>♡</span></span></div></div>;
}

function Overview({ dashboard, user, incomes, expenses, onNavigate }: { dashboard: DashboardData; user: User; incomes: Income[]; expenses: Expense[]; onNavigate: (page: Page) => void }) {
  const recent = useMemo(() => {
    if (dashboard.activities.length) return dashboard.activities.map(row => ({ id: row.id, description: row.description, person: row.actor, category: `${row.action} ${row.entity}`, amount: row.amount, kind: row.entity === 'despesa' ? 'expense' as const : 'income' as const, date: row.createdAt, action: row.action, icon: row.entity === 'despesa' ? ArrowUpRight : row.entity === 'receita' ? ArrowDownLeft : Activity }));
    return [...incomes.map(row => ({ id: row.id, description: row.description, person: 'Dados iniciais', category: row.category?.name ?? 'Receita', amount: number(row.amount), kind: 'income' as const, date: row.occurredAt, action: 'valor informado', icon: ArrowDownLeft })), ...expenses.map(row => ({ id: row.id, description: row.description, person: 'Dados iniciais', category: row.category?.name ?? 'Despesa', amount: number(row.amount), kind: 'expense' as const, date: row.dueAt, action: 'valor informado', icon: ArrowUpRight }))].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  }, [dashboard.activities, incomes, expenses]);
  const mainGoal = dashboard.goals[0]; const property = dashboard.properties[0];
  return <>
    <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-mark">✳</span> UM PLANO FEITO A DOIS</div><h1>Oi, {user.name}. <span>Bom ter você por aqui.</span></h1><p className="page-subtitle">Um olhar tranquilo para o que vocês estão construindo juntos.</p></div><button className="date-pill"><span className="date-icon">◷</span>{dashboard.month}</button></div>
    <section className="hero-banner"><div className="hero-copy"><span className="hero-overline"><span className="sparkle">✳</span> PRÓXIMO DESTINO</span><h2>A nossa casa,<br /><em>no nosso tempo.</em></h2><p>Todo pequeno passo de hoje aproxima vocês<br className="desktop-only" /> da vida que querem construir amanhã.</p><button className="hero-link" onClick={() => onNavigate('home')}>Ver a casa que estamos olhando <ArrowRight size={16} /></button></div><div className="hero-illustration"><div className="hero-sun" /><div className="hero-cloud cloud-one" /><div className="hero-cloud cloud-two" /><div className="hero-hills hill-back" /><div className="hero-hills hill-front" /><div className="hero-house"><div className="hero-roof" /><div className="hero-walls"><span className="hero-window" /><span className="hero-door" /><span className="hero-window second" /></div></div><div className="hero-tree tree-left"><i /><b /></div><div className="hero-tree tree-right"><i /><b /></div><div className="hero-flower flower-one">✿</div><div className="hero-flower flower-two">✿</div></div><span className="hero-deco deco-a">✳</span><span className="hero-deco deco-b">✳</span></section>
    <div className="section-heading"><div><h2>Um retrato do mês</h2><p>Os números que vocês compartilharam até agora.</p></div><span className="section-month">{dashboard.month}</span></div>
    <section className="stats-grid">
      <StatCard label="Salário bruto" value={money(dashboard.income.gross)} icon={Wallet} tone="green" foot="Valor informado antes dos descontos" />
      <StatCard label="Salário líquido confirmado" value={dashboard.income.netConfirmed > 0 ? money(dashboard.income.netConfirmed) : 'Não informado'} icon={CircleHelp} tone="blue" foot="Valor efetivamente recebido e confirmado" />
      <StatCard label="Benefícios" value={money(dashboard.income.benefits)} icon={CreditCard} tone="gold" foot="Benefícios não entram no fluxo de caixa" />
      <StatCard label="Despesas cadastradas" value={money(dashboard.expenses.total)} icon={ArrowUpRight} tone="rose" foot={`Pagas ${money(dashboard.expenses.paid)} · Pendentes ${money(dashboard.expenses.pending)}`} />
      <StatCard label="Saldo disponível:" value="a apurar" icon={CircleHelp} tone="blue" foot="Faltam salários líquidos e despesas completas" />
    </section>
    <Suspense fallback={<div className="charts-loading panel">Carregando visualizações...</div>}><DashboardCharts chart={dashboard.chart} expenses={dashboard.expenses} onNavigate={onNavigate} /></Suspense>
    <div className="dashboard-grid lower-grid"><section className="panel activity-panel"><div className="panel-heading"><div><span className="panel-kicker">ACONTECEU POR AQUI</span><h3>Movimentações recentes</h3></div><button className="text-link" onClick={() => onNavigate('income')}>Ver tudo <ArrowRight size={14} /></button></div>{recent.length ? <div className="recent-list">{recent.map(row => <div className="recent-row" key={`${row.kind}-${row.id}`}><div className={`recent-icon ${row.kind}`}><row.icon size={16} /></div><div className="recent-main"><b>{row.description}</b><span>{row.person} <i>·</i> {row.category}</span></div><div className="recent-amount"><b className={row.kind === 'income' ? 'positive' : ''}>{row.action === 'removeu' ? 'Removido' : row.amount === null ? '—' : `${row.kind === 'income' ? '+' : '−'} ${money(row.amount)}`}</b><span>{dateLabel(row.date)}</span></div></div>)}</div> : <EmptyChart icon={ClipboardList} title="Tudo começa com um primeiro registro" body="Adicionem uma receita ou despesa para ver a atividade do casal." />}</section><aside className="side-cards"><section className="mini-goal-card"><div className="mini-card-top"><div className="mini-icon"><TrendingUp size={18} /></div><span>RESERVA PARA MUDANÇA</span></div><h3>{mainGoal ? money(mainGoal.contributed) : money(0)} <small>guardados</small></h3>{mainGoal?.targetAmount ? <><div className="progress-track"><i style={{ width: `${mainGoal.progress ?? 0}%` }} /></div><p>{mainGoal.progress?.toFixed(0)}% da meta de {money(mainGoal.targetAmount)}</p></> : <p>Definam o valor da meta para acompanhar o progresso juntos.</p>}<button onClick={() => onNavigate('goals')}>Acompanhar meta <ArrowRight size={14} /></button><span className="goal-sprig">✳</span></section><section className="mini-home-card"><div className="home-card-icon"><House size={17} /></div><div><span>OPÇÃO EM ANÁLISE</span><b>{property?.title ?? 'Sua próxima casa'}</b><small>{property ? `${property.location} · ${money(property.monthlyTotal)}/mês` : 'Registre um imóvel para planejar'}</small></div><button aria-label="Ver imóvel" onClick={() => onNavigate('home')}><ArrowRight size={16} /></button></section></aside></div>
    <footer className="dashboard-footnote"><ShieldCheck size={14} /><span>{dashboard.balanceNote}</span><button onClick={() => onNavigate('income')}>Revisar lançamentos</button></footer>
  </>;
}

function StatCard({ label, value, icon: Icon, tone, foot }: { label: string; value: string; icon: LucideIcon; tone: string; foot: string }) {
  return <section className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={17} strokeWidth={1.9} /></span></div><b className="stat-value">{value}</b><span className="stat-foot">{foot}</span></section>;
}
function EmptyChart({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) { return <div className="empty-chart"><div><Icon size={19} /></div><b>{title}</b><span>{body}</span></div>; }

function Transactions({ mode, entries, members, onAdd, onEdit, onRefresh, onToast }: { mode: 'income' | 'expense'; entries: Income[] | Expense[]; members: User[]; onAdd: () => void; onEdit: (row: Income | Expense) => void; onRefresh: () => Promise<void>; onToast: (message: string) => void }) {
  const incomeMode = mode === 'income';
  const title = incomeMode ? 'Receitas' : 'Despesas';
  const [filter, setFilter] = useState('TODAS'); const [busyId, setBusyId] = useState('');
  const filtered = entries.filter(row => incomeMode ? filter === 'TODAS' || (row as Income).kind === filter : filter === 'TODAS' || (row as Expense).status === filter);
  const total = entries.reduce((sum, row) => sum + number(row.amount), 0);
  const remove = async (row: Income | Expense) => { if (!confirm(`Remover “${row.description}”?`)) return; setBusyId(row.id); try { await request(`/${incomeMode ? 'incomes' : 'expenses'}/${row.id}`, { method: 'DELETE' }); await onRefresh(); onToast(incomeMode ? 'Receita removida' : 'Despesa removida'); } catch (e) { onToast(e instanceof Error ? e.message : 'Não foi possível remover'); } finally { setBusyId(''); } };
  const toggle = async (row: Income | Expense) => { if (incomeMode) return; const expense = row as Expense; setBusyId(row.id); try { await request(`/expenses/${row.id}`, { method: 'PATCH', body: { status: expense.status === 'PAID' ? 'PENDING' : 'PAID' } }); await onRefresh(); onToast(expense.status === 'PAID' ? 'Despesa marcada como pendente' : 'Despesa marcada como paga'); } catch (e) { onToast(e instanceof Error ? e.message : 'Não foi possível atualizar'); } finally { setBusyId(''); } };
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-mark">✳</span> ORGANIZAÇÃO DO CASAL</div><h1>{title}</h1><p className="page-subtitle">{incomeMode ? 'Acompanhem o que entra no orçamento compartilhado.' : 'Tudo que vocês decidiram acompanhar, em um só lugar.'}</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Adicionar {incomeMode ? 'receita' : 'despesa'}</button></div>
    <div className="transaction-summary"><div><span>{incomeMode ? 'Lançamentos cadastrados' : 'Despesas cadastradas'}</span><b>{entries.length}</b></div><div><span>Valor total listado</span><b>{money(total)}</b></div><div><span>{incomeMode ? 'Valor líquido confirmado' : 'Valores pendentes'}</span><b>{incomeMode ? ((entries as Income[]).some(row => row.kind === 'NET_SALARY') ? money((entries as Income[]).filter(row => row.kind === 'NET_SALARY').reduce((sum, row) => sum + number(row.amount), 0)) : 'Não informado') : money((entries as Expense[]).filter(row => row.status === 'PENDING').reduce((sum, row) => sum + number(row.amount), 0))}</b></div>{incomeMode && <div className="summary-warning"><CircleHelp size={16} /><span>Salários brutos e benefícios não são renda líquida.</span></div>}</div>
    <section className="panel transaction-panel"><div className="list-toolbar"><div><span className="panel-kicker">SEU HISTÓRICO</span><h3>Todos os lançamentos</h3></div><label className="select-wrap"><span className="sr-only">Filtrar</span><select value={filter} onChange={e => setFilter(e.target.value)}>{incomeMode ? <><option value="TODAS">Todos os tipos</option><option value="GROSS_SALARY">Salário bruto</option><option value="NET_SALARY">Salário líquido</option><option value="BENEFIT">Benefícios</option><option value="EXTRA">Renda extra</option><option value="OTHER">Outras entradas</option></> : <><option value="TODAS">Todos os status</option><option value="PENDING">Pendentes</option><option value="PAID">Pagas</option></>}</select><ChevronDown size={15} /></label></div>{filtered.length ? <div className="table-scroll"><table><thead><tr><th>Descrição</th><th>Categoria</th><th>Responsável</th><th>{incomeMode ? 'Tipo' : 'Vencimento'}</th><th>{incomeMode ? 'Frequência' : 'Status'}</th><th className="amount-cell">Valor</th><th aria-label="Ações" /></tr></thead><tbody>{filtered.map(row => { const income = row as Income; const expense = row as Expense; return <tr key={row.id}><td><div className="transaction-description"><span className={`transaction-symbol ${incomeMode ? 'green' : expense.status === 'PAID' ? 'muted' : 'peach'}`}>{incomeMode ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><div><b>{row.description}</b>{row.notes && <small>{row.notes}</small>}</div></div></td><td><span className="category-pill">{row.category?.name ?? '—'}</span></td><td>{row.responsible?.name ?? 'Compartilhado'}</td><td>{incomeMode ? <span className={`kind-pill ${income.kind === 'GROSS_SALARY' ? 'gross' : income.kind === 'BENEFIT' ? 'benefit' : 'net'}`}>{kindLabel[income.kind]}</span> : dateLabel(expense.dueAt)}</td><td>{incomeMode ? <span className="frequency-text">{frequencyLabel[income.frequency] ?? income.frequency}</span> : <button className={`status-pill ${expense.status.toLowerCase()}`} disabled={busyId === row.id} onClick={() => void toggle(row)}><i />{expense.status === 'PAID' ? 'Pago' : 'Pendente'}</button>}</td><td className="amount-cell"><b className={incomeMode ? 'positive' : ''}>{money(row.amount)}</b></td><td><div className="row-actions"><button className="icon-button" aria-label={`Editar ${row.description}`} onClick={() => onEdit(row)}><Pencil size={15} /></button><button className="icon-button danger-icon" aria-label={`Remover ${row.description}`} disabled={busyId === row.id} onClick={() => void remove(row)}><Trash2 size={15} /></button></div></td></tr>; })}</tbody></table></div> : <EmptyChart icon={incomeMode ? ArrowDownLeft : ArrowUpRight} title="Ainda não há lançamentos aqui" body={incomeMode ? 'Cadastrem uma receita para começar a visualizar o orçamento compartilhado.' : 'Adicionem as despesas que querem acompanhar no orçamento.'} />}</section>
    {!incomeMode && <div className="privacy-note"><ShieldCheck size={16} /><span>Os lançamentos são compartilhados apenas entre {members.map(m => m.name).join(' e ')}.</span></div>}
  </>;
}

function HomePage({ properties }: { properties: Property[] }) {
  const property = properties[0];
  if (!property) return <div className="page-title-row"><div><div className="eyebrow">PLANOS DO CASAL</div><h1>A futura casa</h1><p className="page-subtitle">Um lugar para sonhar e comparar opções juntos.</p></div></div>;
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-mark">✳</span> PLANOS DO CASAL</div><h1>A futura casa</h1><p className="page-subtitle">Uma opção em análise, sem compromisso confirmado.</p></div><a className="button button-outline" href={property.listingUrl} target="_blank" rel="noreferrer">Ver anúncio <ArrowUpRight size={16} /></a></div><section className="property-hero"><div className="property-art"><div className="property-sun" /><div className="property-moon" /><div className="property-mound mound-a" /><div className="property-mound mound-b" /><div className="property-building"><div className="building-roof" /><div className="building-body"><span /><span /><i /></div></div><div className="property-plant plant-a">✿</div><div className="property-plant plant-b">✿</div><span className="property-spark spark-one">✳</span><span className="property-spark spark-two">✦</span></div><div className="property-summary"><span className="status-pill reviewing"><i /> EM ANÁLISE</span><h2>{property.title}</h2><p className="property-location"><House size={15} /> {property.location}</p><div className="property-rent"><span>Valor mensal anunciado</span><b>{money(property.monthlyTotal)}<small>/mês</small></b></div><p className="property-caveat">Estimativa com os valores anunciados. Ainda não inclui contas de consumo, internet ou outros gastos da mudança.</p></div></section><div className="section-heading property-section-heading"><div><h2>Detalhes do imóvel</h2><p>Valores informados no anúncio que vocês compartilharam.</p></div><span className="status-pill reviewing"><i /> OPÇÃO EM ANÁLISE</span></div><section className="property-detail-grid"><PropertyValue label="Aluguel" value={money(property.rent)} icon={House} /><PropertyValue label="IPTU" value={money(property.iptu)} icon={ClipboardList} /><PropertyValue label="Seguro incêndio" value={money(property.fireInsurance)} icon={ShieldCheck} /><PropertyValue label="Taxa de lixo" value={money(property.trashFee)} icon={PackageCheck} /><PropertyValue label="Condomínio" value={number(property.condoFee) === 0 ? 'Isento' : money(property.condoFee)} icon={MoreHorizontal} /><PropertyValue label="Área" value={`${number(property.areaM2)} m²`} icon={Lamp} /><PropertyValue label="Quartos" value={String(property.bedrooms)} icon={BedDouble} /><PropertyValue label="Banheiros" value={String(property.bathrooms)} icon={Baby} /><PropertyValue label="Garagem" value={`${property.parkingSpaces} vagas`} icon={CreditCard} /></section><div className="property-total"><div className="total-seal"><House size={19} /></div><div><span>CUSTO MENSAL ANUNCIADO</span><b>{money(property.monthlyTotal)}<small> / mês</small></b></div><span className="total-caveat">Valores ainda precisam ser confirmados com a imobiliária.</span></div><div className="privacy-note"><CircleHelp size={16} /><span>A casa continua como opção em análise. Os valores do anúncio não são um contrato nem uma despesa atual.</span></div></>;
}
function PropertyValue({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) { return <div className="property-value"><div className="property-value-icon"><Icon size={17} /></div><span>{label}</span><b>{value}</b></div>; }

const shoppingStatuses: { value: ShoppingStatus; label: string }[] = [
  { value: 'PLANNED', label: 'Planejado' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'PURCHASED', label: 'Comprado' },
  { value: 'RECEIVED', label: 'Recebido' },
];

function ShoppingStatusSelector({ item, onSelect }: { item: ShoppingItem; onSelect: (status: ShoppingStatus) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => shoppingStatuses.findIndex(option => option.value === item.status));
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentIndex = shoppingStatuses.findIndex(option => option.value === item.status);
  const current = shoppingStatuses[currentIndex] ?? shoppingStatuses[0];
  const menuId = `shopping-status-${item.id}`;

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(220, window.innerWidth - 16);
    const height = Math.min(208, window.innerHeight - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const below = rect.bottom + 8;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8);
    setPosition({ top, left });
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? shoppingStatuses.length - 1 : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + shoppingStatuses.length) % shoppingStatuses.length;
        setActiveIndex(next);
        optionRefs.current[next]?.focus();
      } else if (event.key === 'Tab') {
        closeMenu(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [activeIndex, closeMenu, open, positionMenu]);

  const toggleMenu = () => {
    if (open) {
      closeMenu();
      return;
    }
    setActiveIndex(currentIndex);
    positionMenu();
    setOpen(true);
  };

  const chooseStatus = async (status: ShoppingStatus) => {
    closeMenu(true);
    if (status === item.status) return;
    setSaving(true);
    try { await onSelect(status); }
    finally { setSaving(false); }
  };

  return <>
    <button ref={triggerRef} type="button" className={`status-pill status-trigger item-status-${item.status.toLowerCase()}`} onClick={toggleMenu} aria-label={`Status de ${item.name}: ${current.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-busy={saving} disabled={saving}>
      <i />{current.label}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menuRef} id={menuId} className="shopping-status-menu" role="menu" aria-label={`Alterar status de ${item.name}`} style={{ top: position.top, left: position.left }}>
      {shoppingStatuses.map((option, index) => <button ref={node => { optionRefs.current[index] = node; }} key={option.value} type="button" role="menuitemradio" aria-checked={option.value === item.status} className={`shopping-status-option item-status-${option.value.toLowerCase()} ${option.value === item.status ? 'selected' : ''}`} onClick={() => void chooseStatus(option.value)}>
        <i /> <span>{option.label}</span>{option.value === item.status && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>, document.body)}
  </>;
}

function ShoppingPage({ items, onAdd, onEdit, onStatusChange, onDelete }: { items: ShoppingItem[]; onAdd: () => void; onEdit: (row: ShoppingItem) => void; onStatusChange: (item: ShoppingItem, status: ShoppingStatus) => Promise<void>; onDelete: (item: ShoppingItem) => void }) {
  const estimated = items.reduce((sum, item) => sum + number(item.estimatedCost) * item.quantity, 0); const priced = items.filter(i => i.estimatedCost !== null).length;
  const done = items.filter(i => i.status === 'RECEIVED').length;
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-mark">✳</span> PLANOS DO CASAL</div><h1>Lista de compras</h1><p className="page-subtitle">O essencial para transformar um espaço no lar de vocês.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Adicionar item</button></div><section className="shopping-summary"><div className="shopping-summary-icon"><ShoppingBasket size={21} /></div><div><span>ESTIMATIVA ATUAL</span><b>{priced ? money(estimated) : 'Aguardando valores'}</b><small>{priced ? `${priced} de ${items.length} itens com preço estimado` : 'Os preços serão somados conforme vocês preencherem.'}</small></div><div className="shopping-progress"><span>{done} de {items.length} recebidos</span><div className="progress-track"><i style={{ width: `${items.length ? done / items.length * 100 : 0}%` }} /></div></div></section><div className="section-heading"><div><h2>Itens para o nosso cantinho</h2><p>Definam prioridades e acompanhem cada compra.</p></div><div className="shopping-key"><span><i className="key-essential" /> Essencial</span><span><i className="key-important" /> Importante</span><span><i className="key-optional" /> Pode esperar</span></div></div><section className="shopping-grid">{items.map(item => <article className={`shopping-card ${item.status !== 'PLANNED' ? 'item-done' : ''}`} key={item.id}><div className="shopping-card-top"><div className={`shopping-item-icon icon-${item.name.toLowerCase().replace(/ /g, '-')}`}><ShoppingItemIcon name={item.name} /></div><button className="icon-button" onClick={() => onEdit(item)} aria-label={`Editar ${item.name}`}><MoreHorizontal size={19} /></button></div><div className="shopping-card-title"><div><h3>{item.name}</h3><span>Qtd. {item.quantity}{item.responsible ? ` · ${item.responsible.name}` : ' · Sem responsável'}</span></div><span className={`priority-dot ${item.priority.toLowerCase()}`} title={priorityLabel(item.priority)} /></div><div className="shopping-card-bottom"><div><small>VALOR ESTIMADO</small><b>{item.estimatedCost !== null ? money(number(item.estimatedCost) * item.quantity) : 'A definir'}</b></div><ShoppingStatusSelector key={item.id} item={item} onSelect={status => onStatusChange(item, status)} /></div><div className="shopping-card-actions"><button onClick={() => onEdit(item)}><Pencil size={14} /> Editar detalhes</button><button className="danger-text" onClick={() => onDelete(item)}><Trash2 size={14} /> Remover</button></div></article>)}<button className="add-item-card" onClick={onAdd}><span><Plus size={18} /></span><b>Adicionar mais um item</b><small>Continuem montando a lista juntos</small></button></section><div className="privacy-note"><CircleHelp size={16} /><span>Os valores são estimativas e aparecem somente quando vocês os cadastrarem. Nenhum preço foi presumido.</span></div></>;
}
function ShoppingItemIcon({ name }: { name: string }) { const value = name.toLowerCase(); if (value.includes('geladeira')) return <span>▣</span>; if (value.includes('fogão')) return <span>▤</span>; if (value.includes('lavar')) return <WashingMachine size={20} />; if (value.includes('cama')) return <BedDouble size={20} />; if (value.includes('sofá') || value.includes('mesa')) return <Lamp size={20} />; return <ShoppingBasket size={20} />; }
function priorityLabel(priority: ShoppingItem['priority']) { return priority === 'ESSENTIAL' ? 'Essencial' : priority === 'IMPORTANT' ? 'Importante' : 'Pode esperar'; }
function statusLabel(status: ShoppingItem['status']) { return shoppingStatuses.find(option => option.value === status)?.label ?? 'Planejado'; }

function GoalsPage({ goals, onAdd, onEdit, onContribute }: { goals: Goal[]; onAdd: () => void; onEdit: (goal: Goal) => void; onContribute: (goal: Goal) => void }) {
  const total = goals.reduce((sum, goal) => sum + goal.contributed, 0);
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-mark">✳</span> PLANOS DO CASAL</div><h1>Metas financeiras</h1><p className="page-subtitle">Pequenas contribuições, objetivos que ficam mais perto.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Nova meta</button></div><section className="goal-overview-card"><div className="goal-overview-deco">✳</div><div className="goal-overview-icon"><TrendingUp size={20} /></div><span>TOTAL GUARDADO EM OBJETIVOS</span><b>{money(total)}</b><p>Todo valor registrado por vocês conta como um passo adiante.</p><div className="goal-overview-avatars"><span>G</span><span>D</span><small>Contribuições compartilhadas</small></div></section><div className="section-heading"><div><h2>Os planos de vocês</h2><p>Metas compartilhadas e o progresso de cada uma.</p></div></div><section className="goal-grid">{goals.map((goal, index) => <article className="panel goal-card" key={goal.id}><div className="goal-card-header"><div className={`goal-card-icon goal-tone-${index % 3}`}><TrendingUp size={19} /></div><div className="goal-actions"><button className="icon-button" aria-label={`Editar ${goal.name}`} onClick={() => onEdit(goal)}><Pencil size={14} /></button><button className="text-link" onClick={() => onContribute(goal)}><Plus size={14} /> Contribuir</button></div></div><span className="panel-kicker">OBJETIVO COMPARTILHADO</span><h3>{goal.name}</h3><div className="goal-totals"><b>{money(goal.contributed)}</b><span>{goal.targetAmount ? `de ${money(goal.targetAmount)}` : 'acumulados'}</span></div>{goal.targetAmount ? <><div className="progress-track goal-track"><i style={{ width: `${Math.min(goal.contributed / number(goal.targetAmount) * 100, 100)}%` }} /></div><div className="goal-foot"><span>{Math.min(goal.contributed / number(goal.targetAmount) * 100, 100).toFixed(0)}% concluído</span><span>faltam {money(Math.max(number(goal.targetAmount) - goal.contributed, 0))}</span></div></> : <div className="target-undefined"><CircleHelp size={15} /><span>Definam o valor desejado ao editar esta meta.</span></div>}{goal.targetDate && <p className="goal-date">Prazo desejado: {new Date(goal.targetDate).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>}<div className="contribution-list">{goal.contributions?.slice(0, 3).map(contribution => <div key={contribution.id}><span className={`avatar avatar-small ${contribution.user.name === 'Dani' ? 'avatar-dani' : ''}`}>{contribution.user.name.slice(0, 1)}</span><span>{contribution.user.name}<small>{dateLabel(contribution.contributedAt)}</small></span><b>+ {money(contribution.amount)}</b></div>)}{!goal.contributions?.length && <span className="first-contribution">A primeira contribuição pode ser de qualquer um dos dois.</span>}</div></article>)}<button className="goal-add-card" onClick={onAdd}><span><Plus size={18} /></span><b>Criar um novo objetivo</b><small>Emergência, mudança ou qualquer sonho compartilhado.</small></button></section></>;
}

function Modal({ title, onClose, error, children }: { title: string; onClose: () => void; error: string; children: ReactNode }) { return <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal-card"><div className="modal-header"><div><span className="eyebrow">ESPAÇO DO CASAL</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>{error && <div className="form-error modal-error">{error}</div>}{children}</section></div>; }
function modalTitle(modal: Exclude<ModalName, null>, editing: Income | Expense | ShoppingItem | Goal | null) {
  const title = modal === 'income' ? 'receita' : modal === 'expense' ? 'despesa' : modal === 'item' ? 'item da casa' : modal === 'goal' ? 'meta financeira' : 'contribuição';
  return `${editing ? 'Editar' : modal === 'contribution' ? 'Registrar' : 'Adicionar'} ${title}`;
}

function TransactionForm({ mode, editing, categories, members, busy, onCancel, onSubmit }: { mode: 'income' | 'expense'; editing: Income | Expense | null; categories: Category[]; members: User[]; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, unknown>, idempotencyKey?: string) => void }) {
  const existing = editing as Income & Expense | null;
  const [submissionId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const [description, setDescription] = useState(existing?.description ?? ''); const [amount, setAmount] = useState(existing ? String(existing.amount) : ''); const [categoryId, setCategoryId] = useState(existing?.categoryId ?? categories[0]?.id ?? ''); const [responsibleId, setResponsibleId] = useState(existing?.responsibleId ?? ''); const [kind, setKind] = useState<Income['kind']>(existing && 'kind' in existing ? existing.kind : 'GROSS_SALARY'); const [frequency, setFrequency] = useState(existing?.frequency ?? 'MONTHLY'); const [date, setDate] = useState(existing ? new Date(mode === 'income' ? existing.occurredAt : existing.dueAt).toISOString().slice(0, 10) : todayLocal()); const [status, setStatus] = useState<Expense['status']>(existing && 'status' in existing ? existing.status : 'PENDING'); const [nature, setNature] = useState<Expense['nature']>(existing && 'nature' in existing ? existing.nature : 'FIXED'); const [isShared, setIsShared] = useState(existing && 'isShared' in existing ? existing.isShared : true); const [notes, setNotes] = useState(existing?.notes ?? '');
  const submit = (e: FormEvent) => { e.preventDefault(); if (!categoryId) return; const data = { description, amount: Number(amount), categoryId, responsibleId: responsibleId || null, frequency, notes: notes || null, ...(mode === 'income' ? { kind, occurredAt: date } : { dueAt: date, status, nature, isShared }) }; let hash = 2166136261; for (const char of JSON.stringify(data)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); onSubmit(data, `${submissionId}-${(hash >>> 0).toString(36)}`); };
  return <form className="form-grid" onSubmit={submit}><label className="form-field full">Descrição<input value={description} onChange={e => setDescription(e.target.value)} placeholder={mode === 'income' ? 'Ex.: Salário mensal' : 'Ex.: Conta de internet'} maxLength={120} required /></label><label className="form-field">Valor (R$)<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" required /></label><label className="form-field">Categoria<select value={categoryId} onChange={e => setCategoryId(e.target.value)} required>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="form-field">Responsável<select value={responsibleId} onChange={e => setResponsibleId(e.target.value)}><option value="">Compartilhado / sem responsável</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>{mode === 'income' ? <label className="form-field">Tipo de receita<select value={kind} onChange={e => setKind(e.target.value as Income['kind'])}>{Object.entries(kindLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> : <label className="form-field">Status<select value={status} onChange={e => setStatus(e.target.value as Expense['status'])}><option value="PENDING">Pendente</option><option value="PAID">Pago</option></select></label>}{mode === 'expense' && <label className="form-field">Tipo de despesa<select value={nature} onChange={e => setNature(e.target.value as Expense['nature'])}><option value="FIXED">Fixa</option><option value="VARIABLE">Variável</option></select></label>}<label className="form-field">{mode === 'income' ? 'Data' : 'Vencimento'}<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label className="form-field">Frequência<select value={frequency} onChange={e => setFrequency(e.target.value)}>{Object.entries(frequencyLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{mode === 'expense' && <label className="checkbox-field full"><input type="checkbox" checked={isShared} onChange={e => setIsShared(e.target.checked)} /><span>Despesa compartilhada pelo casal</span></label>}<label className="form-field full">Observações (opcional)<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Detalhes úteis para vocês dois..." maxLength={500} rows={2} /></label><div className="form-actions full"><button type="button" className="button button-outline" onClick={onCancel}>Cancelar</button><button className="button button-primary" disabled={busy || !categories.length}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Salvar lançamento'} <ArrowRight size={15} /></button></div></form>;
}

function ShoppingForm({ editing, members, busy, onCancel, onSubmit }: { editing: ShoppingItem | null; members: User[]; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, unknown>) => void }) {
  const [name, setName] = useState(editing?.name ?? ''); const [quantity, setQuantity] = useState(String(editing?.quantity ?? 1)); const [estimate, setEstimate] = useState(editing?.estimatedCost == null ? '' : String(editing.estimatedCost)); const [paid, setPaid] = useState(editing?.paidCost == null ? '' : String(editing.paidCost)); const [priority, setPriority] = useState<ShoppingItem['priority']>(editing?.priority ?? 'IMPORTANT'); const [status, setStatus] = useState<ShoppingItem['status']>(editing?.status ?? 'PLANNED'); const [responsible, setResponsible] = useState(editing?.responsibleId ?? '');
  return <form className="form-grid" onSubmit={e => { e.preventDefault(); onSubmit({ name, quantity: Number(quantity), estimatedCost: estimate ? Number(estimate) : null, paidCost: paid ? Number(paid) : null, priority, status, responsibleId: responsible || null }); }}><label className="form-field full">Nome do item<input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Geladeira" required maxLength={100} /></label><label className="form-field">Quantidade<input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label><label className="form-field">Prioridade<select value={priority} onChange={e => setPriority(e.target.value as ShoppingItem['priority'])}><option value="ESSENTIAL">Essencial</option><option value="IMPORTANT">Importante</option><option value="OPTIONAL">Pode esperar</option></select></label><label className="form-field">Valor estimado (R$)<input type="number" min="0" step="0.01" value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="A definir" /></label><label className="form-field">Valor pago (R$)<input type="number" min="0" step="0.01" value={paid} onChange={e => setPaid(e.target.value)} placeholder="Ainda não comprado" /></label><label className="form-field">Responsável<select value={responsible} onChange={e => setResponsible(e.target.value)}><option value="">Ainda não definido</option>{members.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label className="form-field">Status<select value={status} onChange={e => setStatus(e.target.value as ShoppingItem['status'])}><option value="PLANNED">Planejado</option><option value="IN_PROGRESS">Em andamento</option><option value="PURCHASED">Comprado</option><option value="RECEIVED">Recebido</option></select></label><div className="form-actions full"><button type="button" className="button button-outline" onClick={onCancel}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Adicionar à lista'} <ArrowRight size={15} /></button></div></form>;
}

function GoalForm({ editing, busy, onCancel, onSubmit }: { editing: Goal | null; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, unknown>) => void }) { const [name, setName] = useState(editing?.name ?? ''); const [target, setTarget] = useState(editing?.targetAmount == null ? '' : String(editing.targetAmount)); const [targetDate, setTargetDate] = useState(editing?.targetDate ? new Date(editing.targetDate).toISOString().slice(0, 10) : ''); return <form className="form-grid" onSubmit={e => { e.preventDefault(); onSubmit({ name, targetAmount: target ? Number(target) : null, targetDate: targetDate || null }); }}><label className="form-field full">Nome do objetivo<input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Reserva para mudança" required maxLength={100} /></label><label className="form-field">Valor desejado (R$)<input type="number" min="0.01" step="0.01" value={target} onChange={e => setTarget(e.target.value)} placeholder="Pode ser definido depois" /></label><label className="form-field">Prazo (opcional)<input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} /></label><div className="form-actions full"><button type="button" className="button button-outline" onClick={onCancel}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Salvando...' : editing ? 'Salvar objetivo' : 'Criar objetivo'} <ArrowRight size={15} /></button></div></form>; }
function ContributionForm({ goal, busy, onCancel, onSubmit }: { goal: Goal; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, unknown>) => void }) { const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); return <form className="form-grid" onSubmit={e => { e.preventDefault(); onSubmit({ amount: Number(amount), note: note || undefined }); }}><div className="contribution-intro full"><div className="goal-card-icon goal-tone-0"><TrendingUp size={18} /></div><span>Contribuição para<br /><b>{goal.name}</b></span></div><label className="form-field full">Valor da contribuição (R$)<input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" required autoFocus /></label><label className="form-field full">Observação (opcional)<input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: valor guardado este mês" maxLength={300} /></label><div className="form-actions full"><button type="button" className="button button-outline" onClick={onCancel}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Registrando...' : 'Registrar contribuição'} <ArrowRight size={15} /></button></div></form>; }

export default App;
