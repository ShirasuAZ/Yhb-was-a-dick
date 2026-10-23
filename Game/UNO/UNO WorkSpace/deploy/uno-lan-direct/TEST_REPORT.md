# Test Report

- TypeScript: `npm run typecheck` passed.
- Unit tests: 68 passed, including IPv4 parsing without private-range restrictions, target address/port probing, and unreachable-host diagnostics.
- Integration tests: 25 passed, including `/join` auto-redirect for one room, room selection for multiple rooms, no-room and full-room responses, and real Socket.IO gameplay flows.
- End-to-end tests: 8 passed. Invite-path registration joins automatically without a second click; two independent browser clients completed a game and reconnected; six clients shared a room; responsive layout and existing gameplay were checked.
- Production build: `npm run build` passed.
- The combined `npm test` run intermittently timed out in the existing randomized `stacks two +2 cards` game scenario; `npm run test:integration` passed on its standalone rerun with all 25 tests.
- Normal LAN, virtual LAN, public deployment, and two physical devices: not tested from this environment. The integration tests use real local Socket.IO servers, not separate networked computers.
- Aliyun Workbench: read-only inspection confirmed `uno-game.service` is active with `WorkingDirectory=/opt/uno-game` and `ExecStart=/usr/bin/node /opt/uno-game/dist/server/index.js`. Deployment was not performed; no production files or services were changed.

The application server binds to `0.0.0.0` by default and uses `PORT` (default `3000`). LAN access is controlled by the existing host-side LAN toggle. Firewall rules and network isolation remain host/network configuration and must be validated on the actual devices.
