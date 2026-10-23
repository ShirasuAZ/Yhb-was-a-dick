# LayUDown Game Suite 2.0.0

- Shogi now provides online rooms only. Removed the local two-player mode and undo action/API.
- Shogi room codes use five uppercase letters or digits; player identity, name, and seat are bound to the verified UNO login session.
- Added explicit room exit, reconnect seat recovery, account takeover handling, host succession, and two-player confirmation for restart.
- Added sequence checks for moves so stale or duplicate online actions are rejected by the server.
- Board and hand-piece facing now follows the authenticated player's assigned side, including promoted pieces and captured pieces in hand.
- Kept UNO on TCP 3000 and added the Shogi service on loopback TCP 3001 behind the TCP 80 Nginx entry point.
- Added server-side GET/HEAD SPA behavior and deployment health checks.
- Added isolated deployment backups, Nginx syntax validation before reload, systemd unit verification, automatic failure rollback, and a tested rollback helper.
- Production build checks preserve the homepage `LayUDown` h1 and document title.
- UNO rules source was not changed.
