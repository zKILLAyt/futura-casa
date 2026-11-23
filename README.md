# Futura Casa 🏡

Aplicação privada de planejamento financeiro para Gustavo e Dani, com um orçamento compartilhado. O saldo líquido fica sem cálculo enquanto faltarem descontos de folha e despesas informadas pelo casal. Salários brutos, benefícios e valores anunciados aparecem separados.

## Requisitos

- Node.js 20 ou superior e npm.
- PostgreSQL 14 ou superior.
- Uma base PostgreSQL disponível continuamente, sem serviço que pause o banco por inatividade.

## Configuração local

1. Instale as dependências: `npm install`.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL` e `SESSION_SECRET`. Use um segredo aleatório com pelo menos 32 caracteres.
3. Defina senhas diferentes de pelo menos 12 caracteres para `SEED_GUSTAVO_PASSWORD` e `SEED_DANI_PASSWORD`.
4. Crie/atualize as tabelas: `npm run db:migrate`.
5. Gere o cliente Prisma: `npm run db:generate`.
6. Cadastre os dados iniciais: `npm run db:seed`.
7. Inicie a API e o front-end: `npm run dev`.
8. Acesse `http://localhost:5173`.

As contas iniciais usam `gustavo@futuracasa.local` e `dani@futuracasa.local`; as respectivas senhas são as que você definiu no `.env`. O seed cria valores de salário bruto, benefícios, despesas atuais, opção de imóvel, itens sem preços presumidos e metas sem valor alvo inventado. Ele pode ser executado novamente sem duplicar esses registros. Mantenha o `.env` fora do controle de versão.

## Scripts

| Comando | Ação |
| --- | --- |
| `npm run dev` | Executa Vite e API Express em modo de desenvolvimento |
| `npm run build` | Gera os arquivos web e verifica os tipos TypeScript |
| `npm start` | Inicia a API (e serve `dist` em produção) |
| `npm run db:migrate` | Aplica/gera migrations Prisma |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:seed` | Cria as contas e o orçamento compartilhado inicial |
| `npm run db:studio` | Abre o Prisma Studio |

## Deploy

Use uma hospedagem contínua que mantenha a aplicação e PostgreSQL ativos. Configure as variáveis de `.env.example` no ambiente de produção, rode `npm run db:generate`, `npm run db:migrate` e `npm run build`, e inicie com `npm start`. Configure `FRONTEND_URL` com a origem pública do site e defina `NODE_ENV=production` para cookies de sessão seguros. Execute o seed uma vez para inicializar as duas contas.

## Segurança e dados

- As senhas são armazenadas com bcrypt e não existem credenciais padrão no código.
- Sessões usam cookie `HttpOnly`, `SameSite=Lax`, expiração e armazenamento PostgreSQL.
- A API aplica autenticação, validação Zod, limite de tentativas de login e escopo por orçamento em consultas e operações.
- Registros financeiros são isolados por `householdId`; a atividade grava quem criou, editou ou removeu cada lançamento.
- Configure HTTPS no proxy de produção. Não compartilhe o `.env` nem coloque segredos no repositório.
