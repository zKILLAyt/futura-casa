# Futura Casa 🏡

Aplicação privada de planejamento financeiro para Gustavo e Dani, com um orçamento compartilhado. O saldo líquido fica sem cálculo enquanto faltarem descontos de folha e despesas informadas pelo casal. Salários brutos, benefícios e valores anunciados aparecem separados.

## Requisitos

- Node.js 20 ou superior e npm.
- PostgreSQL 14 ou superior; Neon é usado em produção e pode levar mais tempo na primeira conexão depois de ficar ocioso.

## Configuração local

1. Instale as dependências: `npm install`.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL`, `DIRECT_URL` e `SESSION_SECRET`. Para um PostgreSQL local, `DATABASE_URL` e `DIRECT_URL` podem ser iguais. Use um segredo aleatório com pelo menos 32 caracteres.
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
| `npm run db:deploy` | Aplica migrations já versionadas no banco configurado |
| `npm run db:migrate` | Aplica/gera migrations Prisma |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:seed` | Cria as contas e o orçamento compartilhado inicial |
| `npm run db:studio` | Abre o Prisma Studio |

## Deploy na Vercel

O `vercel.json` configura o projeto como Vite estático (`dist`) e deixa os arquivos em `api/` como Vercel Functions Node.js. `api/[...path].ts` encaminha `/api/...` para o mesmo app Express usado localmente; o app não chama `listen()` nesse caminho. O rewrite restante serve `index.html` para as rotas do frontend. No Vercel, use a raiz do repositório como **Root Directory**.

Configuração do projeto Vercel (também definida em `vercel.json`):

| Campo | Valor |
| --- | --- |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

O `postinstall` gera o Prisma Client durante a instalação. A migration `20261124110000_user_sessions` cria a tabela persistente usada pelo `connect-pg-simple`; as migrations não são executadas no build nem durante uma invocação serverless. Depois de revisar a migration, aplique-a manualmente ao banco escolhido com `npm run db:deploy`. Esse comando altera o banco; ele não foi executado como parte desta preparação. Não execute o seed no build ou em cada deploy.

Configure as variáveis abaixo em **Settings → Environment Variables**. Não coloque valores secretos no repositório.

| Variável | Valor / uso |
| --- | --- |
| `DATABASE_URL` | URL PostgreSQL do Neon com pooler (`-pooler` no host), TLS (`sslmode=require`) e `connection_limit=1`. É usada em runtime por Prisma e sessões. |
| `DIRECT_URL` | URL direta do mesmo banco Neon, sem `-pooler`, com TLS (`sslmode=require`). O Prisma CLI usa essa URL para migrations; a aplicação usa `DATABASE_URL` em runtime. |
| `SESSION_SECRET` | Segredo aleatório com pelo menos 32 caracteres; mantenha o mesmo valor em todas as funções e ambientes que devam compartilhar sessões. |
| `NODE_ENV` | `production`; o Vercel normalmente já define isso em produção. |
| `FRONTEND_URL` | Origem pública canônica, por exemplo `https://seu-dominio.com`, sem barra final. A API também permite o domínio da implantação via `VERCEL_URL`. |

`PORT` só é necessário no servidor local. `VERCEL_URL` é fornecida pela plataforma. `SEED_GUSTAVO_PASSWORD` e `SEED_DANI_PASSWORD` só são necessárias para a inicialização manual das contas; não as configure para executar o seed no Vercel. A aplicação usa `/api` relativo no navegador, o proxy local do Vite continua apontando para `localhost:4000`, e frontend e API compartilham o domínio publicado para que o cookie de sessão funcione como cookie first-party.

As sessões não ficam em memória: são armazenadas em `user_sessions` no Neon por 14 dias. O cookie é `HttpOnly`, `SameSite=Lax` e `Secure` em produção. O `trust proxy` é ativado em produção para o Express reconhecer HTTPS atrás do proxy da Vercel. O pool do `pg` e o cliente Prisma são singleton por instância aquecida da função; nenhum estado de autenticação depende dessa instância.

Limitações: a limpeza física de sessões expiradas está desativada porque funções serverless não garantem timers em segundo plano; sessões expiradas deixam de autenticar, mas suas linhas podem permanecer até limpeza manual. O limite de tentativas de login existente usa memória local e não representa um limite global entre instâncias Vercel; para exposição pública com tráfego maior, use proteção distribuída como Firewall/rate limiting da plataforma ou store compartilhado.

Uma prévia local da função Vercel pode ser validada com `vercel dev` depois de instalar a CLI. Um deploy de preview ainda é necessário para validar o comportamento real da plataforma e as variáveis ligadas ao Neon.

## Segurança e dados

- As senhas são armazenadas com bcrypt e não existem credenciais padrão no código.
- Sessões usam cookie `HttpOnly`, `SameSite=Lax`, expiração e armazenamento PostgreSQL.
- A API aplica autenticação, validação Zod, limite de tentativas de login e escopo por orçamento em consultas e operações.
- Registros financeiros são isolados por `householdId`; a atividade grava quem criou, editou ou removeu cada lançamento.
- Configure HTTPS no proxy de produção. Não compartilhe o `.env` nem coloque segredos no repositório.
