# Tudú API 🚀

> Backend API oficial do **Tudú** construído com NestJS, TypeScript, PostgreSQL e Prisma.  
> Provisiona serviços de Inteligência Artificial gerenciada (DeepSeek + OpenAI), gestão de assinaturas (Tudú Pro com RevenueCat) e sincronização contínua de dados em nuvem mantendo a filosofia *offline-first* do app.

---

## 🌟 Principais Recursos

1. **Inteligência Artificial Blindada & Multi-Provedor:**
   - Suporte nativo a **DeepSeek** (`deepseek-chat`) como provedor primário de baixíssimo custo.
   - Suporte nativo a **OpenAI** mantendo os **2 modelos oficiais** em produção no Tudú:
     - `gpt-4o-mini`: micro-tarefas rápidas (sugestão de emojis e tarefas).
     - `gpt-5.6-luna`: estruturação semântica, categorização temática e agrupamento inteligente de listas.
   - **Fallback Automático:** Em caso de lentidão (> 6s), erro 429 ou 5xx no DeepSeek, a API chaveia automaticamente para o modelo OpenAI correspondente.
2. **Defesa Ativa Anti-Abuso & Prompt Injection:**
   - **Sem Prompts Abertos:** O app móvel envia apenas dados estruturados (`title`, `listName`, etc.).
   - **Sanitização de Input:** Rejeição rigorosa de padrões de jailbreak (`ignore previous instructions`, `system:`, `developer mode`).
   - **JSON Schema Compulsório:** Os LLMs respondem em modo estrito, impossibilitando geração de prosa livre ou uso indevido como chat geral.
   - **Guard de Assinatura (`SubscriptionGuard`):** Apenas assinantes ativos ou em período de trial têm acesso às rotas de IA.
   - **Teto Diário & Rate Limiting:** Proteção contra esgotamento acidental de créditos da API.
3. **Assinaturas & Monetização (Tudú Pro):**
   - Preço: **R$ 4,90 / mês** com **1ª semana grátis (7 dias de trial)**.
   - Integração completa com **RevenueCat Webhooks** para sincronização em tempo real com Google Play Billing e Apple StoreKit.
4. **Sincronização em Nuvem Offline-First (PostgreSQL):**
   - O aplicativo móvel continua gravando e operando localmente de forma instantânea.
   - Assinantes têm seus dados (listas, tarefas, contadores e configurações) sincronizados silenciosamente via `POST /sync/delta` com resolução de conflitos *Last-Write-Wins* e *soft deletes*.
   - Ao assinar, o app envia o snapshot completo do histórico local via `POST /sync/snapshot` sem perda de dados.

---

## 🏗️ Arquitetura

```
tudu-api/
├── prisma/
│   └── schema.prisma                # Modelos User, Subscription, List, Task, Counter, etc.
├── src/
│   ├── app.module.ts
│   ├── main.ts                      # Swagger, ValidationPipe, CORS e Filtro Global
│   ├── common/
│   │   ├── decorators/              # @CurrentUser()
│   │   ├── filters/                 # AllExceptionsFilter
│   │   ├── guards/                  # SubscriptionGuard
│   │   └── sanitizers/              # PromptSanitizer & Anti-Injection Regex
│   ├── modules/
│   │   ├── auth/                    # Login Google, Apple e Dev (JWT 90 dias)
│   │   ├── users/                   # Perfil e remoção de conta (LGPD/Apple)
│   │   ├── subscriptions/           # Webhooks RevenueCat e status de assinatura
│   │   ├── ai/                      # Orquestrador com Fallback, DeepSeek e OpenAI
│   │   │   ├── providers/           # DeepSeekProvider e OpenAiProvider
│   │   │   └── dto/                 # DTOs com validação estrita de tamanho
│   │   └── sync/                    # Sincronização em nuvem (Delta & Snapshot)
│   └── prisma/                      # PrismaService singleton
├── test/                            # Suíte de testes E2E (Supertest)
├── docker-compose.yml               # PostgreSQL + API
├── Dockerfile                       # Multi-stage build Node.js 22 LTS Alpine
└── package.json
```

---

## 🚀 Como Executar

### Pré-requisitos
- Node.js 20+ (testado no Node.js 23 LTS)
- PostgreSQL (ou Docker / Docker Compose)

### 1. Clonar e Instalar Dependências
```bash
git clone https://github.com/rampazzo1989/tudu-api.git
cd tudu-api
npm install
```

### 2. Configurar Variáveis de Ambiente
Copie o arquivo de exemplo e preencha suas chaves:
```bash
cp .env.example .env
```

### 3. Gerar Prisma Client & Migrações
```bash
npx prisma generate
npx prisma db push
```

### 4. Iniciar em Desenvolvimento
```bash
npm run start:dev
```
A API estará acessível em `http://localhost:3000`.  
A documentação interativa Swagger estará em: `http://localhost:3000/api/docs`.

---

## 🐳 Executando com Docker Compose

Suba o banco PostgreSQL e a API em um único comando:
```bash
docker-compose up -d --build
```

---

## 🧪 Testes

A aplicação conta com suíte completa de testes unitários e testes de integração de ponta a ponta (E2E):

```bash
# Executar todos os testes unitários (Sanitização, Guardas, AI Fallback, Sync)
npm test

# Executar testes End-to-End (E2E)
npm run test:e2e

# Executar com relatório de cobertura de código
npm run test:cov
```

---

## 📡 Endpoints da API

| Método | Rota | Descrição | Autenticação |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/google` | Login via Google Identity Token | Pública |
| `POST` | `/api/v1/auth/apple` | Login via Apple Identity Token | Pública |
| `POST` | `/api/v1/auth/dev` | Login simulado para testes e dev | Pública |
| `GET` | `/api/v1/users/me` | Retorna perfil do usuário e dados do plano | Bearer JWT |
| `DELETE` | `/api/v1/users/me` | Exclusão definitiva de conta e dados | Bearer JWT |
| `POST` | `/api/v1/webhooks/revenuecat` | Webhook de eventos da RevenueCat | Bearer Secret |
| `GET` | `/api/v1/subscriptions/status` | Consulta status do plano Tudú Pro | Bearer JWT |
| `POST` | `/api/v1/ai/suggest-emojis` | Sugestão de 5-10 emojis para tarefas/listas | Bearer JWT + Assinatura |
| `POST` | `/api/v1/ai/suggest-tasks` | Sugestão de subtarefas contextuais | Bearer JWT + Assinatura |
| `POST` | `/api/v1/ai/parse-list` | Leitura e estruturação inteligente de texto livre | Bearer JWT + Assinatura |
| `GET` | `/api/v1/ai/quota` | Saldo e métricas de cota diária de IA | Bearer JWT + Assinatura |
| `POST` | `/api/v1/sync/snapshot` | Carga inicial de backup local para a nuvem | Bearer JWT + Assinatura |
| `POST` | `/api/v1/sync/delta` | Sincronização incremental bidirecional | Bearer JWT + Assinatura |
| `GET` | `/api/v1/sync/export` | Exportação de backup completo do usuário | Bearer JWT + Assinatura |

---

## 📄 Licença
Propriedade de Felipe Rampazzo. Todos os direitos reservados.
