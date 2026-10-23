# LayUDown Game Suite 2.0.0 Test Report

## Completed locally

- `npm run build`: passed; Vite site and UNO/Shogi server production outputs generated. The title protection check ran against source and production HTML/JavaScript.
- `npm run test:all`: passed; TypeScript check, 15 Vitest files / 101 tests, and 10 Playwright browser tests.
- Playwright included authenticated lobby visibility, Shogi route and responsive viewport checks, two independently authenticated accounts in one online room, opposite player-relative piece facing, move synchronization, and UNO regression flows.
- Hon shugi engine tests: 11 passed in the preceding full validation of the current rules source.
- Production Shogi output includes the rules engine; Express and Socket.IO resolve from the existing UNO project's production dependencies, which are specified by the included package manifest and lockfile.
- `npm run test:shogi:dist`: passed; it started the built service with isolated temporary account storage and verified `/health`, GET/HEAD SPA behavior, the `LayUDown` title, and unauthenticated WebSocket rejection.

## Not tested in this workspace

- Public `47.100.174.241` access, the ECS's real Nginx/systemd configuration, or a live deployment. The user will deploy the package.
- Physical Windows PCs or phones. Browser tests used Chromium on the development machine with desktop, narrow, portrait, and landscape viewport emulation.
- The POSIX rollback simulation could not be rerun in this Windows environment: `bash.exe`/`wsl.exe` are launcher stubs, no WSL distribution or Git Bash runtime is installed, and Docker Desktop's Linux engine is not running. A previous run before the backup-permission adjustment passed; the delivered script should still be exercised on a disposable Linux host before relying on it for a production rollback.

No public-server or mobile-hardware result is claimed.
