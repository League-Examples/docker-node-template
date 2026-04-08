---
status: pending
---

# Migrate LEAGUEhub-orig to student-progress-report template

## Description
Port all domain logic from /Users/eric/proj/scratch/LEAGUEhub-orig into the student-progress-report template application. The source app is a student progress reporting tool for The LEAGUE of Amazing Programmers using Express + Drizzle/PostgreSQL, Pike13 OAuth, React/Wouter/Tailwind. The target is a template app with Express + Prisma (dual SQLite/PostgreSQL), Passport.js OAuth, service registry pattern, React Router. Currently running a chat demo that needs to be replaced with LEAGUEhub's student progress features.

## Acceptance Criteria
- `npm run dev` starts both server and client without errors
- All LEAGUEhub domain models exist in Prisma schema (Instructor, Student, MonthlyReview, ReviewTemplate, etc.)
- Chat infrastructure (channels, messages, SSE) fully removed
- Pike13 OAuth flow creates instructor records and stores tokens
- All instructor pages work: dashboard, reviews, templates, checkins
- All admin pages work: instructor list, compliance, volunteer hours, feedback
- Public feedback form works via token URL
- SendGrid email integration works (graceful no-op without API key)
- Pike13 sync service works (graceful no-op without credentials)
- Docker build succeeds
- Deployment via rundbat/dotconfig preserved

## Tasks

### Phase 1: Prisma Schema + DB Foundation
- [ ] Remove Channel and Message models from schema.prisma
- [ ] Add 15 LEAGUEhub domain models: Instructor, Student, InstructorStudent, MonthlyReview, ReviewTemplate, ServiceFeedback, AdminSetting, Pike13Token, TaCheckin, AdminNotification, VolunteerHour, StudentAttendance, VolunteerSchedule, VolunteerEventSchedule, Pike13AdminToken
- [ ] Add ReviewStatus enum (PENDING, DRAFT, SENT)
- [ ] Update User model relations (add instructors, notifications; remove messages)
- [ ] Delete existing migration and regenerate clean init migration
- [ ] Update seed script: remove channel seed

### Phase 2: Remove Chat, Add Client Dependencies
- [ ] Delete server chat files: channels.ts, messages.ts, search.ts routes; channel.service.ts, message.service.ts, sse.ts services
- [ ] Edit app.ts: remove channel/message/search router imports and app.use() lines
- [ ] Edit service.registry.ts: remove Channel/MessageService, update clearAll()
- [ ] Add client deps: @tanstack/react-query, react-hook-form, @hookform/resolvers, zod, tailwindcss, @tailwindcss/vite, tailwind-merge, clsx, lucide-react
- [ ] Configure Tailwind: add vite plugin, add @import to index.css
- [ ] Delete client chat pages: Chat.tsx, Channels.tsx
- [ ] Edit App.tsx: remove Chat/Channels routes and admin/channels route

### Phase 3: Domain Services
- [ ] Create instructor.service.ts (list, getByUserId, create, activate, getStudents, getDashboard)
- [ ] Create student.service.ts (upsertByPike13Id, list, getById)
- [ ] Create review.service.ts (list, getById, create, update, send, generateDraft)
- [ ] Create template.service.ts (CRUD)
- [ ] Create checkin.service.ts (getPending, submit, notifyAdmin)
- [ ] Create feedback.service.ts (getByToken, submit)
- [ ] Create email.service.ts (SendGrid; no-op without API key)
- [ ] Create pike13-sync.service.ts (convert Drizzle to Prisma, SQLite-safe)
- [ ] Create volunteer.service.ts (list, getSummary, CRUD)
- [ ] Create compliance.service.ts (getReport)
- [ ] Create notification.service.ts (list, markRead, create)
- [ ] Register all services in service.registry.ts
- [ ] Add server deps: @sendgrid/mail, groq-sdk

### Phase 4: Auth + Middleware
- [ ] Extend Passport deserializeUser to load Instructor record and attach instructorId/isActiveInstructor
- [ ] Create types/express.d.ts to augment Express.User
- [ ] Edit pike13.ts callback: add email domain check, instructor creation, token storage
- [ ] Create middleware/requireInstructor.ts
- [ ] Update client AuthContext: add instructorId and isActiveInstructor to user type

### Phase 5: Domain Route Handlers
- [ ] Create routes: instructor.ts (dashboard, students, sync)
- [ ] Create routes: reviews.ts (CRUD, send, generate draft)
- [ ] Create routes: templates.ts (CRUD)
- [ ] Create routes: checkins.ts (pending, submit)
- [ ] Create routes: feedback.ts (public get/post by token, no auth)
- [ ] Create admin routes: instructors.ts, compliance.ts, volunteer-hours.ts, feedback.ts, notifications.ts
- [ ] Mount all new routes in app.ts and admin/index.ts

### Phase 6: Client — Instructor Pages
- [ ] Create shared components: InstructorLayout, ProtectedRoute, MonthPicker, ui/button, ui/input, lib/utils.ts
- [ ] Port type definitions from LEAGUEhub client/src/types/
- [ ] Create pages: LoginPage, DashboardPage, ReviewListPage, ReviewEditorPage, TemplateListPage, TemplateEditorPage, CheckinPage, FeedbackPage, PendingActivationPage
- [ ] Wrap app in QueryClientProvider (edit main.tsx)
- [ ] Update App.tsx: replace Home with Dashboard, add instructor routes under InstructorLayout, add /feedback/:token public route

### Phase 7: Client — Admin Pages
- [ ] Create admin pages: InstructorListPanel, CompliancePanel, VolunteerHoursPanel, AdminFeedbackPanel, NotificationsPanel
- [ ] Update AdminLayout nav with new items
- [ ] Add new admin routes to App.tsx

### Phase 8: Cleanup + Verification
- [ ] Update .env: APP_NAME=LEAGUEhub, APP_SLUG=leaguehub
- [ ] Remove any remaining chat references
- [ ] Verify npm run dev starts cleanly
- [ ] Verify login flow and dashboard
- [ ] Verify Docker build succeeds
- [ ] Update existing tests for schema changes
