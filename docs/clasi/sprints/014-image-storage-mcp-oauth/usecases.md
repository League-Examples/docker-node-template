---
status: draft
---

# Sprint 014 Use Cases

## SUC-001: Image Upload and Processing
Parent: Infrastructure

- **Actor**: Authenticated user or admin
- **Preconditions**: User is logged in, ImageService is available
- **Main Flow**:
  1. User uploads an image via POST /api/images (multipart form data)
  2. ImageService receives the file buffer
  3. Sharp resizes to max 1600px on longest edge, converts to WebP quality 80
  4. SHA256 checksum is computed on the processed image
  5. Image is saved to local uploads/images/ directory
  6. If S3 is configured, image is uploaded to S3 (best-effort)
  7. Image record is created in database with URL, dimensions, checksum
  8. Response returns the Image record with URL
- **Postconditions**: Image is stored locally (and optionally on S3), database record exists
- **Acceptance Criteria**:
  - [ ] Upload produces a WebP file in the local uploads directory
  - [ ] Image is resized to max 1600px on longest edge
  - [ ] SHA256 checksum is computed and stored
  - [ ] S3 upload works when configured, logs warning when not
  - [ ] Image metadata (width, height, size, mimeType) is stored
  - [ ] Image is accessible via GET /uploads/images/{checksum}.webp

## SUC-002: Image Management
Parent: Infrastructure

- **Actor**: Admin user
- **Preconditions**: Image records exist in database
- **Main Flow**:
  1. Admin retrieves image metadata via GET /api/images/:id
  2. Admin deletes an image via DELETE /api/images/:id
  3. System removes local file, S3 object, and database record
- **Postconditions**: Image is fully removed from all storage locations
- **Acceptance Criteria**:
  - [ ] GET /api/images/:id returns image metadata
  - [ ] DELETE /api/images/:id removes local file, S3 object, and DB record
  - [ ] DELETE requires admin role
  - [ ] 404 returned for nonexistent image ID

## SUC-003: OAuth Authorization Flow for MCP Clients
Parent: MCP

- **Actor**: External MCP client (e.g., Claude Desktop)
- **Preconditions**: Client knows the app's OAuth discovery URL
- **Main Flow**:
  1. Client fetches /.well-known/oauth-authorization-server for endpoint URLs
  2. Client generates PKCE code_verifier and code_challenge
  3. Client redirects user to /oauth/authorize with client_id, redirect_uri,
     code_challenge, state
  4. Server stores pending OAuth params in session
  5. If user is not logged in, server redirects to login flow
  6. After login, server generates authorization code and redirects to
     redirect_uri with code and state
  7. Client exchanges code + code_verifier at POST /oauth/token
  8. Server validates code and PKCE, creates ApiToken, returns access_token
  9. Client uses access_token as Bearer token for MCP requests
- **Postconditions**: Client has a valid access token for MCP API
- **Acceptance Criteria**:
  - [ ] Discovery endpoint returns correct RFC 8414 metadata
  - [ ] Authorization code flow works with PKCE S256
  - [ ] Token exchange returns working bearer token
  - [ ] Authorization codes expire after 10 minutes
  - [ ] Authorization codes are single-use
  - [ ] Invalid PKCE verifier is rejected

## SUC-004: Token Management
Parent: Admin Dashboard

- **Actor**: Admin user
- **Preconditions**: ApiToken records may exist
- **Main Flow**:
  1. Admin views token list in admin dashboard
  2. Admin sees label, token prefix, associated user, last used, expiry
  3. Admin can revoke a token (sets revokedAt timestamp)
  4. Admin can create a new token manually (for testing/automation)
  5. MCP endpoint validates tokens against both static and database tokens
- **Postconditions**: Admin has full visibility and control over API tokens
- **Acceptance Criteria**:
  - [ ] Admin panel lists all tokens with metadata
  - [ ] Revoke button immediately invalidates a token
  - [ ] Revoked tokens are rejected by MCP endpoint
  - [ ] Expired tokens are rejected
  - [ ] Static MCP_DEFAULT_TOKEN continues to work
  - [ ] MCP endpoint accepts OAuth-issued bearer tokens
