---
status: pending
priority: medium
source: inventory app (server/src/routes/oauth.ts)
---

# OAuth Authorization Flow for MCP Connectors

Add a proper OAuth2 authorization server so external MCP clients
(Claude Desktop, third-party tools) can authenticate via a standard
OAuth flow rather than static tokens.

## Why

Static `MCP_DEFAULT_TOKEN` works for simple setups but doesn't scale:
you can't revoke individual clients, you can't track which client made
which call, and you can't require user consent. A proper OAuth flow
fixes all of these.

## Endpoints

Create `server/src/routes/oauth.ts`:

### Discovery

`GET /.well-known/oauth-authorization-server`

Returns RFC 8414 metadata:

```json
{
  "issuer": "https://your-app.example.com",
  "authorization_endpoint": "https://your-app.example.com/oauth/authorize",
  "token_endpoint": "https://your-app.example.com/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials"],
  "code_challenge_methods_supported": ["S256"]
}
```

### Authorization

`GET /oauth/authorize?client_id=&redirect_uri=&code_challenge=&code_challenge_method=S256&state=`

1. Store pending OAuth params in session
2. If user is not logged in, redirect to Google OAuth (or login page)
3. After login, generate an authorization code
4. Redirect to `redirect_uri` with `code` and `state`

Authorization codes expire after 10 minutes and are single-use.

### Token Exchange

`POST /oauth/token`

Supports two grant types:

**authorization_code:**
- Validates the code and PKCE code_verifier
- Creates an `ApiToken` record in the database
- Returns `{ access_token, token_type: "bearer", expires_in }`

**client_credentials:**
- Validates client_id and client_secret
- For machine-to-machine access without user interaction
- Creates an `ApiToken` with a system user

### PKCE

The flow uses PKCE (Proof Key for Code Exchange) with S256 method:

```typescript
// Client generates:
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256')
  .update(codeVerifier).digest('base64url');

// Server verifies during token exchange:
const expected = crypto.createHash('sha256')
  .update(req.body.code_verifier).digest('base64url');
if (expected !== storedCodeChallenge) {
  return res.status(400).json({ error: 'invalid_grant' });
}
```

## ApiToken Model

```prisma
model ApiToken {
  id        Int       @id @default(autoincrement())
  label     String
  tokenHash String    @unique  // SHA256 hash of the token
  prefix    String             // first 8 chars for identification
  userId    Int?
  user      User?     @relation(fields: [userId], references: [id])
  role      UserRole  @default(USER)
  lastUsedAt DateTime?
  revokedAt DateTime?
  expiresAt DateTime?
  createdAt DateTime  @default(now())
}
```

## Token Validation

Update the MCP endpoint's token auth middleware to check both:
1. Static `MCP_DEFAULT_TOKEN` (for backward compatibility)
2. Database `ApiToken` records (for OAuth-issued tokens)

```typescript
async function validateToken(token: string): Promise<User | null> {
  // Check static token first
  if (token === process.env.MCP_DEFAULT_TOKEN) {
    return getSystemUser();
  }

  // Check database tokens
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });

  if (!apiToken || apiToken.revokedAt || isExpired(apiToken)) {
    return null;
  }

  // Update last used
  await prisma.apiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  });

  return apiToken.user;
}
```

## Admin UI

Add a Tokens panel to the admin dashboard:

- List active tokens with label, prefix, user, last used, expiry
- Revoke button per token
- "Create Token" for manual token generation (admin use)

## Reference Files

- Inventory: `server/src/routes/oauth.ts`
- Inventory: `server/prisma/schema.prisma` — `ApiToken` model
- Inventory: `server/src/middleware/tokenAuth.ts`

## Verification

- `GET /.well-known/oauth-authorization-server` returns correct metadata
- Authorization code flow works end-to-end with PKCE
- Token exchange returns a working bearer token
- MCP endpoint accepts both static tokens and OAuth-issued tokens
- Revoking a token immediately invalidates it
- Expired tokens are rejected
- Client credentials grant works for machine-to-machine
