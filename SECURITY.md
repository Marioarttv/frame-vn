# Security

Frame is a single-user local application. Its authoring API is intended for the loopback interface on your own computer. It is not a hosted service with user authentication or tenant isolation.

## Reporting a vulnerability

Please use GitHub's **Security → Report a vulnerability** feature for this repository. If private reporting is unavailable, open an issue asking for a private reporting channel without including exploit details, keys, private media, or personal data.

Include the affected commit or release, operating system and browser, a minimal reproduction, and the expected security boundary. Synthetic fixtures are preferable to private project files. Public fixes will include a regression check where practical. Response times depend on maintainer availability; there is no guaranteed service-level agreement.

## Safe operation

- Run the development server on `127.0.0.1`; do not expose it with `--host 0.0.0.0`, a public reverse proxy, or a tunnel.
- Keep provider keys in a local `.env.local` file or another explicitly configured server-side environment file. Never prefix secrets with `VITE_`, commit them, or include them in issue attachments.
- Voice generation uses your provider account and may incur charges. Automated tests use mock or injected transports. An uncertain provider response must be inspected before a manual retry.
- Only import stories and media you trust. Exported HTML is a runnable document; inspect its source and origin before opening files from others.
- Project JSON and playable HTML exports embed the media used by the project. Check their contents before sharing them.
- Keep Node.js and installed dependencies current. Run `npm audit` when updating dependencies and review any relevant advisory rather than applying breaking fixes blindly.

The first public release is a preview. Security fixes target the latest released preview; older snapshots are not maintained independently.
