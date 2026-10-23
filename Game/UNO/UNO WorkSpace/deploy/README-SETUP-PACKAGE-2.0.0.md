# LayUDown Game Suite Setup Package 2.0.0

This is a Linux ECS deployment ZIP, not a Windows installer. Extract it and follow `deploy/README-GAME-SUITE-2.0.0.md`.

The archive includes the real production `dist/` for the LayUDown homepage, existing UNO service, and Shogi online service; deployment and rollback scripts; an independent Nginx site configuration; source, tests, assets, dependency lockfiles, test report, and changelog. It excludes account data, local environment files, secrets, `node_modules`, caches, and old release archives.

Shogi runs on loopback TCP 3001 behind Nginx. UNO remains on TCP 3000. Public access uses `http://47.100.174.241/` and does not require the domain.
