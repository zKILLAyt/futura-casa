import { Activity, ArrowRight, ArrowUpRight, MoreHorizontal } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardData } from './types';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const palette = ['#76977e', '#d4a46f', '#8293a5', '#b18caa', '#d78d79', '#76a29a'];

export default function DashboardCharts({ chart, expenses, onNavigate }: {
  chart: DashboardData['chart'];
  expenses: DashboardData['expenses'];
  onNavigate: (page: 'expenses') => void;
}) {
  return <div className="dashboard-grid chart-grid">
    <section className="panel chart-panel">
      <div className="panel-heading"><div><span className="panel-kicker">MOVIMENTO DO DINHEIRO</span><h3>Fluxo de caixa confirmado</h3></div><button className="more-button" onClick={() => onNavigate('expenses')} aria-label="Ver despesas"><MoreHorizontal size={20} /></button></div>
      <div className="chart-legend"><span><i className="legend-dot legend-income" /> Entradas disponíveis: líquido e outras receitas</span><span><i className="legend-dot legend-expense" /> Despesas pagas</span><span><i className="legend-dot legend-savings" /> Aportes registrados às metas</span></div>
      <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{ top: 10, right: 3, left: -16, bottom: 0 }}>
        <defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#76977e" stopOpacity={0.19} /><stop offset="100%" stopColor="#76977e" stopOpacity={0} /></linearGradient><linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d5a078" stopOpacity={0.16} /><stop offset="100%" stopColor="#d5a078" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 14 }} dy={10} /><YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 14 }} tickFormatter={value => value === 0 ? '0' : `${Math.round(value / 1000)}k`} /><Tooltip formatter={value => money(Number(value))} contentStyle={{ borderRadius: 12, borderColor: 'var(--line)', background: 'var(--surface)', fontSize: 14 }} labelStyle={{ fontSize: 14 }} itemStyle={{ fontSize: 14 }} />
        <Area type="monotone" dataKey="availableIncome" name="Entradas disponíveis (salário líquido + outras receitas)" stroke="#77967e" strokeWidth={2.3} fill="url(#incomeFill)" /><Area type="monotone" dataKey="paidExpenses" name="Despesas pagas (agrupadas pelo vencimento)" stroke="#d5a078" strokeWidth={2.3} fill="url(#expenseFill)" /><Area type="monotone" dataKey="goalContributions" name="Aportes registrados às metas" stroke="#8295aa" strokeWidth={2} fill="transparent" />
      </AreaChart></ResponsiveContainer></div>
      <div className="chart-note"><span><Activity size={14} /> Bruto e benefícios ficam fora do caixa; pendências não são despesas pagas.</span><span className="note-sage">{chart.length} meses</span></div>
    </section>
    <section className="panel category-panel">
      <div className="panel-heading"><div><span className="panel-kicker">PRA ONDE VAI</span><h3>Despesas por categoria</h3></div><button className="text-link" onClick={() => onNavigate('expenses')}>Detalhes <ArrowRight size={14} /></button></div>
      {expenses.categories.length ? <><div className="donut-row"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={expenses.categories} dataKey="value" nameKey="name" innerRadius={49} outerRadius={69} paddingAngle={3} stroke="none">{expenses.categories.map((_, index) => <Cell key={index} fill={palette[index % palette.length]} />)}</Pie><Tooltip formatter={value => money(Number(value))} contentStyle={{ borderRadius: 12, borderColor: 'var(--line)', background: 'var(--surface)' }} /></PieChart></ResponsiveContainer><div className="donut-center"><b>{money(expenses.total)}</b><small>no mês</small></div></div><div className="category-legend">{expenses.categories.slice(0, 5).map((row, index) => <div className="category-row" key={row.name}><span className="category-name"><i className="legend-dot" style={{ background: palette[index % palette.length] }} />{row.name}</span><b>{money(row.value)}</b></div>)}</div></div></> : <div className="empty-chart"><div><ArrowUpRight size={19} /></div><b>As despesas aparecem aqui</b><span>Quando registrarem despesas, vocês verão como elas se dividem por categoria.</span></div>}
    </section>
  </div>;
}
