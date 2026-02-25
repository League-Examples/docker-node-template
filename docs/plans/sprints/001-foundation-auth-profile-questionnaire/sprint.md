---
id: "001"
title: Foundation: Auth, Profile & Questionnaire
status: planning
branch: sprint/001-foundation-auth-profile-questionnaire
use-cases: [SUC-001, SUC-002, SUC-003, SUC-004, SUC-005, SUC-006]
---

# Sprint 001: Foundation: Auth, Profile & Questionnaire

## Goals

Establish the complete application foundation for College Application Navigator:
user authentication, student profile, interest & goals questionnaire,
AI-generated 4-year academic plan, and the persistent Claude chat interface.
At the end of this sprint a student can sign up, describe themselves, receive
a personalised course plan, and ask questions of their AI advisor.

## Problem

The repository is a blank docker-node-template. No application logic, data
models, or user-facing screens exist yet. Students cannot create accounts,
record their goals, or interact with the AI guide.

## Solution

Build atop the existing Express + React + PostgreSQL + Prisma stack:

1. **Auth** — email/password sign-up and login via Passport.js local strategy
   with bcrypt hashing and express-session persistence.
2. **Student profile** — A profile linked to the user account capturing grade,
   high school, state, GPA, and planned/completed courses.
3. **Interest & goals questionnaire** — A multi-step guided form covering
   academic interests, career goals, extracurricular activities, and college
   preferences. Results persist to the database.
4. **4-year academic plan** — Claude generates a tailored course plan from the
   student's profile + questionnaire. Displayed, editable, and saved.
5. **Claude chat interface** — A persistent chat panel accessible from every
   page, with the student's profile injected as context on every request.

## Success Criteria

- A new student can sign up, log in, and log out successfully.
- A student can complete the interest & goals questionnaire and see their
  answers saved and retrievable on return.
- A student can view and edit their academic profile (courses, GPA, test
  scores).
- A student can generate and view a 4-year academic plan tailored to their
  questionnaire responses.
- A student can send messages to the Claude chat advisor and receive contextual
  responses.
- All backend routes are covered by Supertest tests.
- All React pages render without errors under Vitest/RTL.
- E2E Playwright tests cover sign-up → questionnaire → plan → chat flow.

## Scope

### In Scope

- User auth: sign-up, login, logout, session management
- Student profile CRUD (grade, high school, state, GPA, courses, test scores)
- Multi-step interest & goals questionnaire (≥10 questions across 4 categories)
- AI-generated 4-year academic plan via Claude API
- Persistent editable plan storage in PostgreSQL
- Claude chat panel (streaming responses, conversation history persisted per
  session)
- Full Prisma schema + migrations for all above models
- React SPA with React Router: `/`, `/signup`, `/login`, `/profile`,
  `/questionnaire`, `/plan`, `/chat`
- Protected routes redirecting unauthenticated users to `/login`

### Out of Scope

- Email verification or password reset flows
- Google/GitHub OAuth
- All deferred feature modules (test prep, college list, essays, etc.)
- Admin or counselor views
- Push notifications or email reminders

## Test Strategy

| Layer | What to test |
|-------|-------------|
| Database (`tests/db/`) | Prisma schema constraints, JSONB questionnaire response queries |
| Backend (`tests/server/`) | All auth routes, profile CRUD routes, questionnaire submit route, plan generation route, chat route |
| Frontend (`tests/client/`) | SignupPage, LoginPage, ProfilePage, QuestionnairePage, PlanPage, ChatPage render + happy-path interactions |
| E2E (`tests/e2e/`) | Full flow: sign-up → questionnaire → plan generation → chat |

## Architecture Notes

- This is a greenfield build — establishes architecture v1.
- Session stored server-side with `express-session` + `connect-pg-simple`
  (sessions table in PostgreSQL; no Redis).
- Claude API calls are made server-side only. The frontend never holds the API
  key. Streaming responses are proxied via a `/api/chat` SSE endpoint.
- Questionnaire responses stored as JSONB in `QuestionnaireResponse.data` to
  allow schema evolution without migrations.
- 4-year plan stored as JSONB in `CoursePlan.data` (array of year objects).
- All secrets (session secret, Claude API key) flow through
  `docker/entrypoint.sh` → environment variables.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, technical plan)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

(To be created after sprint approval.)
