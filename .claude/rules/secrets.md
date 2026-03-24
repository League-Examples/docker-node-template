# Secrets & Configuration Rules

## Tools

- Use **dotconfig** for secrets and `.env` management. Run `dotconfig agent`
  for canonical instructions.
- Use **rundbat** MCP tools for database credentials and connection strings.
- Never run `sops` or `docker secret` commands directly — use the tools above.

## Security Rules

- Never hardcode secrets in source code.
- Never commit `.env` (gitignored).
- Never commit `*.agekey` private keys (gitignored).
- Never edit encrypted files under `config/` directly — use `dotconfig save`.
- Secrets flow through `docker/entrypoint.sh` at runtime — application
  code reads `process.env`, never `/run/secrets/` files directly.

## Config Directory Structure

```
config/
  dev/
    public.env           ← non-secret dev vars (committed)
    secrets.env          ← SOPS-encrypted dev secrets (committed)
    secrets.env.example  ← plaintext template (committed)
  prod/
    public.env           ← non-secret prod vars (committed)
    secrets.env          ← SOPS-encrypted prod secrets (committed)
  local/                 ← developer-specific overrides (gitignored)
```

## All Secrets Are Optional

The app starts without any OAuth or API credentials. Unconfigured
integrations return 501 with setup instructions. Never add startup
checks that crash when a secret is missing.
