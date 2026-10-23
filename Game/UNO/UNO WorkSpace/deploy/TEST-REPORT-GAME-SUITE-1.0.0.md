# LayUDown Game Suite 1.0.0 Test Report

Executed on Windows with Node.js v24.11.1 and npm 11.6.2 from the supplied workspaces.

| Check | Result |
| --- | --- |
| UNO and site TypeScript check (`npm run typecheck`) | Passed |
| UNO/site unit and integration suite (`npm test`) | 14 files, 95 tests passed |
| Browser E2E (`npm run test:e2e`) | 9 tests passed |
| Shogi engine tests | 1 file, 11 tests passed |
| Shogi engine TypeScript check | Passed |
| Shogi engine build | Passed |
| Production website and both server builds (`npm run build`) | Passed |
| Homepage brand title check, including production HTML and JavaScript | Passed (`TITLE_PROTECTION_OK`) |

The browser suite checked the logged-out login/register-only screen; the authenticated homepage's game and profile entry points; non-compressed Shogi card layout; UNO online play and reconnect; Shogi route/title and board boundaries at 1440x1000, 390x844, 844x390, and 540x720; and existing UNO sound, bubbles, seating, and play interactions.

The previously reported UNO `+2` integration timeout did not recur in the current complete run: the current integration suite passed. No UNO rule or card-play implementation was changed while preparing this package.

This report does not claim a live ECS/Nginx deployment check or physical-device test. The server at `47.100.174.241`, its active Nginx configuration, systemd units, and phone browsers were not accessed. The owner should perform the public IP and physical phone checks after deployment using `README-GAME-SUITE-1.0.0.md`.
