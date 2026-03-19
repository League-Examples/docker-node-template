---
id: "014"
title: "Image Storage & MCP OAuth"
status: planning
branch: sprint/014-image-storage-mcp-oauth
use-cases: [SUC-001, SUC-002, SUC-003, SUC-004]
---

# Sprint 014: Image Storage & MCP OAuth

## Goals

Add two independent capabilities: (1) image upload, processing, and
dual-storage (local + S3), and (2) a proper OAuth2 authorization server
for MCP clients to replace static token authentication.

## Problem

1. **No image handling.** The app has no way to upload, process, or store
   images. Any feature requiring user-uploaded images (avatars, attachments)
   is blocked.
2. **Static MCP tokens.** The MCP endpoint uses a single shared
   `MCP_DEFAULT_TOKEN`. You can't revoke individual clients, track which
   client made which call, or require user consent. This doesn't scale
   and is a security concern.

## Solution

1. **Image Storage**: Add an Image Prisma model, an ImageService that
   processes uploads with Sharp (resize to 1600px max, convert to WebP),
   stores locally and optionally replicates to S3, and exposes
   `/api/images` routes for upload/metadata/delete.
2. **MCP OAuth**: Implement an OAuth2 authorization server with PKCE
   (RFC 7636) and discovery (RFC 8414). Add ApiToken model for
   database-backed tokens. Update MCP token validation to check both
   static tokens (backward compat) and OAuth-issued tokens. Add admin
   token management panel.

## Success Criteria

- Image upload produces a resized WebP file stored locally
- S3 replication works when configured, degrades gracefully when not
- Images are accessible via their URL path
- OAuth discovery endpoint returns correct RFC 8414 metadata
- Authorization code flow with PKCE works end-to-end
- OAuth-issued tokens are accepted by the MCP endpoint
- Tokens can be revoked and expired tokens are rejected
- Admin panel shows token management
- All existing tests continue to pass

## Scope

### In Scope

- Image model, ImageService, image API routes
- Sharp image processing (resize, WebP conversion, checksums)
- Local + S3 dual storage
- OAuth2 authorization server (authorize, token, discovery endpoints)
- PKCE with S256 method
- ApiToken model and migration
- Token validation middleware update
- Admin token management panel
- Tests for image upload and OAuth flow

### Out of Scope

- Image CDN or caching layer
- Image transformations beyond resize/WebP
- OAuth refresh tokens (tokens have fixed expiry)
- Third-party OAuth client registration UI
- Client credentials grant (deferred to future sprint)

## Test Strategy

- Server tests for ImageService (mock Sharp/S3, verify processing pipeline)
- Server tests for image API routes (upload, get, delete, auth)
- Server tests for OAuth endpoints (discovery, authorize, token exchange)
- Server tests for token validation (static, OAuth, revoked, expired)
- Integration test for full OAuth flow with PKCE

## Architecture Notes

- Sharp is a native dependency — requires platform-specific binaries
- S3 client reuses the existing @aws-sdk/client-s3 from backup service
- OAuth authorization codes stored in-memory (Map) with 10-min TTL
- Token hashing uses SHA256, same pattern as the inventory app
- Static MCP_DEFAULT_TOKEN remains supported for backward compatibility

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

(To be created after sprint approval.)
