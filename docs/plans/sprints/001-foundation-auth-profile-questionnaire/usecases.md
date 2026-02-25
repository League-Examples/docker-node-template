---
status: draft
---

# Sprint 001 Use Cases

## SUC-001: Student Signs Up

- **Actor**: Unauthenticated visitor
- **Preconditions**: No account exists for the email address
- **Main Flow**:
  1. Visitor navigates to `/signup`
  2. Visitor enters name, email, password, current grade, high school, and state
  3. App validates inputs (email format, password ≥ 8 chars, grade 8–12)
  4. App creates a `User` record and a linked `StudentProfile` record
  5. App logs the user in and redirects to `/questionnaire`
- **Alternate Flow — email already in use**:
  - App returns a validation error: "An account with that email already exists"
- **Postconditions**: User is authenticated; `User` and `StudentProfile` records exist
- **Acceptance Criteria**:
  - [ ] Successful sign-up creates both `User` and `StudentProfile` rows
  - [ ] Duplicate email returns a 400 with a descriptive error message
  - [ ] Password is stored as a bcrypt hash, never plaintext
  - [ ] User is redirected to `/questionnaire` after sign-up

---

## SUC-002: Student Logs In and Out

- **Actor**: Registered student
- **Preconditions**: A `User` account exists
- **Main Flow (login)**:
  1. Student navigates to `/login`
  2. Student enters email and password
  3. App authenticates via Passport local strategy
  4. App redirects to `/profile` (or the originally requested URL)
- **Main Flow (logout)**:
  1. Student clicks "Log out"
  2. App destroys the session and redirects to `/login`
- **Alternate Flow — wrong credentials**:
  - App returns: "Invalid email or password"
- **Postconditions**: Session is established (login) or destroyed (logout)
- **Acceptance Criteria**:
  - [ ] Correct credentials establish a session and redirect
  - [ ] Wrong credentials return a 401 with a generic error message (no info leak)
  - [ ] Logout destroys the session; subsequent requests to protected routes redirect to `/login`
  - [ ] Unauthenticated access to protected routes redirects to `/login`

---

## SUC-003: Student Completes Interest & Goals Questionnaire

- **Actor**: Authenticated student
- **Preconditions**: Student is logged in; questionnaire not yet completed (or resuming)
- **Main Flow**:
  1. Student navigates to `/questionnaire`
  2. App presents a multi-step form (4 sections, ≥10 questions total):
     - **Academic interests** (subjects, favourite school topics)
     - **Career goals** (dream careers, salary expectations, work environment)
     - **Extracurriculars** (current activities, interests to explore)
     - **College preferences** (location, size, campus type, distance from home)
  3. Student completes each section and advances with "Next"
  4. On final step, student submits; app persists a `QuestionnaireResponse` record
  5. App marks the student's profile as `questionnaireComplete = true`
  6. App redirects student to `/plan`
- **Alternate Flow — partial save**:
  - Student may leave mid-questionnaire; progress is saved per section so
    they can resume from where they left off
- **Postconditions**: `QuestionnaireResponse` record exists with JSONB data
- **Acceptance Criteria**:
  - [ ] All four sections render with correct questions
  - [ ] Partial progress is preserved on page reload
  - [ ] Submitted responses are retrievable from the API
  - [ ] Student is redirected to `/plan` on completion

---

## SUC-004: Student Views and Edits Academic Profile

- **Actor**: Authenticated student
- **Preconditions**: Student is logged in; `StudentProfile` exists
- **Main Flow**:
  1. Student navigates to `/profile`
  2. App displays current profile: name, grade, high school, state, GPA,
     planned/completed courses, and any test scores
  3. Student edits one or more fields and clicks "Save"
  4. App validates and persists the updated `StudentProfile`
  5. App shows a success confirmation
- **Postconditions**: `StudentProfile` updated in database
- **Acceptance Criteria**:
  - [ ] Profile page displays all current profile fields
  - [ ] Edits persist and are reflected on page reload
  - [ ] Grade must be between 8 and 12; GPA between 0.0 and 4.0
  - [ ] Students cannot view or edit another student's profile

---

## SUC-005: Student Views AI-Generated 4-Year Academic Plan

- **Actor**: Authenticated student who has completed the questionnaire
- **Preconditions**: `QuestionnaireResponse` exists; student is logged in
- **Main Flow**:
  1. Student navigates to `/plan`
  2. If no plan exists yet, app calls the Claude API with the student's profile
     and questionnaire data as context, requesting a 4-year course plan
  3. Claude returns a structured plan; app persists it as a `CoursePlan` record
  4. App renders the plan as a year-by-year table (Grade 9 → Grade 12),
     showing recommended courses per semester
  5. Student may edit individual course entries and save changes
- **Alternate Flow — plan exists**:
  - Skip generation; load persisted `CoursePlan` directly
- **Alternate Flow — questionnaire not complete**:
  - App prompts: "Complete your questionnaire first" with a link to `/questionnaire`
- **Postconditions**: `CoursePlan` persisted; student has viewed personalised plan
- **Acceptance Criteria**:
  - [ ] Plan generates only when questionnaire is complete
  - [ ] Generated plan covers all four high school years with course suggestions
  - [ ] Plan is persisted after first generation (no re-generation on reload)
  - [ ] Student can manually edit course entries and save

---

## SUC-006: Student Chats With Claude Advisor

- **Actor**: Authenticated student
- **Preconditions**: Student is logged in
- **Main Flow**:
  1. Student opens the chat panel (available on every page)
  2. Student types a question (e.g. "What AP classes should I take junior year?")
  3. Frontend POSTs the message to `/api/chat` with conversation history
  4. Backend injects the student's profile + questionnaire summary as a system
     prompt, then calls the Claude API
  5. Response streams back to the frontend via SSE and is displayed in the chat
  6. Conversation history is appended and persisted in `ChatMessage` records
- **Alternate Flow — unanswerable question**:
  - Claude responds honestly that it doesn't have enough information and asks
    a follow-up question
- **Postconditions**: Exchange is persisted; student received a contextual response
- **Acceptance Criteria**:
  - [ ] Chat panel is visible and usable from `/profile`, `/plan`, and `/questionnaire`
  - [ ] Response streams progressively (not a single delayed payload)
  - [ ] Student's profile context is included in every Claude request
  - [ ] Conversation history persists across page navigations within the session
  - [ ] A student cannot access another student's chat history
