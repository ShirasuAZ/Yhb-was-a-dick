# LayUDown Game Suite 1.0.0

- Preserved the existing UNO client, server, rules, account data location, and TCP 3000 runtime.
- Added the Japanese Shogi homepage entry, responsive board, local two-player mode, room-based online mode, reconnect support, and server-side move validation on loopback TCP 3001.
- Kept the homepage brand `LayUDown` in the header and browser tab and retained its build-time protection check.
- Kept the existing login-first homepage flow: game and profile cards are shown only after authentication.
- Added an additive Nginx location example, Linux deployment helper, rollback helper, and ECS deployment guide.
- Bundled the Shogi piece images locally; the upstream source marks them CC0 1.0.
