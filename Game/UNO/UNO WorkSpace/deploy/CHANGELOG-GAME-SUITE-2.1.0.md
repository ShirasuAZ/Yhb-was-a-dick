# LayUDown Game Suite 2.1.0

- Added the Arknights UNION ARENA entry and `/arknights-union-arena/` route, backed by the existing website account service and Socket.IO origin.
- Added two-seat authoritative room state, reconnect grace, account avatars, a searchable 254-record card catalog and the provided `Map/对战地图.png`.
- Added the account profile controls for avatar upload, password changes, verified email changes, logout and account deletion.
- Added the 2.1.0 home update entry and responsive game grid.
- Kept UNION ARENA gameplay start disabled because card types, costs, triggers and effects have not been verified for all cards. The catalog has 254 records and 252 available images.
- No Nginx or host service configuration was changed. No online 80-port deployment was available for verification.
