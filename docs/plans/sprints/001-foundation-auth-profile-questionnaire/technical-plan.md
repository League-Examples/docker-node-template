---
status: draft
from-architecture-version: null
to-architecture-version: architecture-001
---

# Sprint 001 Technical Plan

## Architecture Version

- **From version**: none (greenfield)
- **To version**: architecture-001

## Architecture Overview

The application is a standard three-tier web app on the docker-node-template
stack. The backend (Express) owns all business logic and AI calls; the frontend
(React SPA) communicates only through the `/api` prefix.

```
Browser (React SPA)
  │  HTTP/JSON  │  SSE (chat stream)
  ▼
Express API (Node 20, TypeScript)
  │  Prisma ORM      │  Anthropic SDK
  ▼                  ▼
PostgreSQL 16     Claude API (claude-sonnet-4-6)
```

**Key architectural constraints:**
- The Claude API key is a server-side secret only — never sent to the browser.
- Sessions are stored in PostgreSQL (`sessions` table via `connect-pg-simple`)
  so they survive container restarts without Redis.
- The Vite dev proxy forwards `/api` to `http://server:3000` in Docker dev.
- All routes under `/api` require authentication except `POST /api/auth/signup`
  and `POST /api/auth/login`.

## Database Schema (Prisma)

```prisma
model User {
  id        Int              @id @default(autoincrement())
  email     String           @unique
  password  String           // bcrypt hash
  name      String
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  profile   StudentProfile?
  questionnaire QuestionnaireResponse?
  plan      CoursePlan?
  messages  ChatMessage[]
}

model StudentProfile {
  id         Int      @id @default(autoincrement())
  userId     Int      @unique
  user       User     @relation(fields: [userId], references: [id])
  grade      Int      // 8–12
  highSchool String
  state      String   // 2-letter abbreviation
  gpa        Float?
  courses    Json     // { current: string[], planned: string[] }
  testScores Json     // { sat?: number, act?: number, ap?: { subject: string, score: number }[] }
  questionnaireComplete Boolean @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model QuestionnaireResponse {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique
  user      User     @relation(fields: [userId], references: [id])
  data      Json     // { interests: {...}, careerGoals: {...}, extracurriculars: {...}, collegePrefs: {...} }
  completedAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model CoursePlan {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique
  user      User     @relation(fields: [userId], references: [id])
  data      Json     // { years: [{ grade: 9, fall: string[], spring: string[] }, ...] }
  generatedAt DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model ChatMessage {
  id        Int      @id @default(autoincrement())
  userId    Int
  user      User     @relation(fields: [userId], references: [id])
  role      String   // "user" | "assistant"
  content   String
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```

## Component Design

### Component: Auth (SUC-001, SUC-002)

**Backend — `server/src/routes/auth.ts`**
- `POST /api/auth/signup` — validate inputs, hash password with bcrypt (rounds=12),
  create `User` + `StudentProfile`, log in via Passport, return user object
- `POST /api/auth/login` — Passport local authenticate, return user object
- `POST /api/auth/logout` — destroy session, return 204
- `GET /api/auth/me` — return current user if authenticated, else 401

**Middleware — `server/src/middleware/requireAuth.ts`**
- Checks `req.isAuthenticated()`, returns `{ error: "Unauthorized" }` 401 if not

**Passport config — `server/src/services/passport.ts`**
- Local strategy: find user by email, compare bcrypt hash
- `serializeUser` / `deserializeUser` using `User.id`

**Frontend — `client/src/pages/`**
- `SignupPage.tsx` — form: name, email, password, grade, high school, state
- `LoginPage.tsx` — form: email, password
- `client/src/components/ProtectedRoute.tsx` — wraps routes, redirects to `/login`
- `client/src/services/auth.ts` — `signup()`, `login()`, `logout()`, `getMe()`

---

### Component: Student Profile (SUC-004)

**Backend — `server/src/routes/profile.ts`**
- `GET /api/profile` — return current user's `StudentProfile`
- `PUT /api/profile` — validate and update `StudentProfile`

**Frontend — `client/src/pages/ProfilePage.tsx`**
- Displays and edits: grade (select 8–12), high school, state, GPA, courses
  (tag input), test scores
- `client/src/services/profile.ts` — `getProfile()`, `updateProfile()`

---

### Component: Interest & Goals Questionnaire (SUC-003)

**Backend — `server/src/routes/questionnaire.ts`**
- `GET /api/questionnaire` — return existing response or `null`
- `PUT /api/questionnaire` — upsert `QuestionnaireResponse` (accepts partial
  data per-section); set `profile.questionnaireComplete = true` only when all
  four sections are present in the stored data

**Frontend — `client/src/pages/QuestionnairePage.tsx`**
- Multi-step wizard (4 steps with progress indicator)
- Step 1: Academic interests (checkboxes + free text)
- Step 2: Career goals (dropdowns + salary range + work environment)
- Step 3: Extracurriculars (checkboxes + free text)
- Step 4: College preferences (region multi-select, size radio, distance slider)
- Auto-saves to server (PUT `/api/questionnaire`) on each step advance so
  progress survives a closed tab; on resume, loads existing partial data and
  skips to the first incomplete section
- On final submit: PUT full response, navigate to `/plan`

---

### Component: 4-Year Academic Plan (SUC-005)

**Backend — `server/src/routes/plan.ts`**
- `GET /api/plan` — return existing `CoursePlan` or `null`
- `POST /api/plan/generate` — require `questionnaireComplete`; build system
  prompt from profile + questionnaire; call Claude API (non-streaming);
  parse JSON response; upsert `CoursePlan`
- `PUT /api/plan` — update plan data (manual edits)

**Plan generation** delegates to `claude.generatePlan(profile, questionnaire)`.
The Claude service constructs the system prompt and requests structured JSON:
```
Return a JSON object: { "years": [ { "grade": 9, "fall": ["..."], "spring": ["..."] }, ... ] }
```
Response is parsed and validated before persisting.

**Frontend — `client/src/pages/PlanPage.tsx`**
- On load: GET `/api/plan`; if null, show "Generate my plan" button
- Plan display: 2-column table per year (Fall | Spring), course chips
- Inline editing: click a course chip to rename it; "Add course" button per semester
- "Save changes" sends PUT `/api/plan`

---

### Component: Claude Service (SUC-005, SUC-006)

**`server/src/services/claude.ts`** — single owner of all Claude API interactions:
- Initialises the Anthropic SDK client from `process.env.CLAUDE_API_KEY`
- `buildSystemPrompt(profile, questionnaire)` — constructs the student context
  prompt from DB records; system prompt is hardcoded as a template in this
  service (not stored in the DB)
- `streamChat(messages, systemPrompt)` — calls Claude with streaming, yields
  text deltas as an async iterable
- `generatePlan(profile, questionnaire)` — non-streaming call that returns a
  parsed `CoursePlan.data` JSON object

This service is the only place that imports `@anthropic-ai/sdk`.

---

### Component: Claude Chat Interface (SUC-006)

**Backend — `server/src/routes/chat.ts`**
- Apply `express-rate-limit` middleware: 20 requests/minute per authenticated
  user (keyed on `req.user.id`)
- `GET /api/chat/history` — return last 50 `ChatMessage` records for user
- `POST /api/chat` — save user message; delegate to `claude.streamChat()`;
  stream response back via SSE; save assistant message on stream end

**SSE protocol:**
```
Content-Type: text/event-stream
data: {"type":"delta","text":"..."}\n\n
data: {"type":"done"}\n\n
```

**Frontend — `client/src/components/ChatPanel.tsx`**
- Floating panel (bottom-right), toggle open/close
- Renders message history with user/assistant bubbles
- Textarea + send button; on send: POST to `/api/chat`, consume SSE stream
- `client/src/services/chat.ts` — `getHistory()`, `sendMessage()` (returns
  async iterable of SSE events)

---

### Component: React App Shell

**`client/src/App.tsx`** — React Router setup:
```
/ → redirect to /profile (if authed) or /login
/signup → SignupPage
/login → LoginPage
/profile → ProtectedRoute(ProfilePage)
/questionnaire → ProtectedRoute(QuestionnairePage)
/plan → ProtectedRoute(PlanPage)
/chat → ProtectedRoute(ChatPage) (full-page chat, supplements the panel)
```

**`client/src/components/Layout.tsx`** — shared nav bar + ChatPanel mount point

---

### Component: Secrets & Configuration

New secrets required (add to `secrets/dev.env.example` and `secrets/prod.env.example`):

| Secret | Purpose |
|--------|---------|
| `claude_api_key` | Anthropic API key for Claude calls |
| `session_secret` | express-session signing key (already in template) |

`docker/entrypoint.sh` will expose these as `$CLAUDE_API_KEY` and
`$SESSION_SECRET`.

## Decisions

1. **System prompt storage** — The Claude system prompt is hardcoded as a
   template in `server/src/services/claude.ts`, populated at runtime from the
   student's profile and questionnaire. No DB column needed. Per-student
   customisation is deferred to a future sprint.

2. **Questionnaire auto-save** — Progress is saved to the server (PUT
   `/api/questionnaire`) on each step advance. The backend accepts partial
   data and only sets `questionnaireComplete = true` when all four sections
   are present. On resume, the frontend loads existing data and skips to the
   first incomplete section.
