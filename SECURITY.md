# Security

DEVNS is a local-first developer tool. It reads and writes local `.devns/` state and may run configured local commands through lanes and hooks.

## Trust Boundary

- Run DEVNS only in repositories you trust.
- Review lane commands before enabling them; they execute with your local user permissions.
- Do not expose the dashboard to the public internet. It is intended for localhost use.
- Review agents are a contract, not a sandbox. Their actual permissions depend on the host tool you run them in.

## Reporting

Please report security issues privately through the GitHub repository security channel when available. Avoid posting exploitable details in public issues.

