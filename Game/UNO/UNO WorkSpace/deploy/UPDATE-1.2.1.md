# UNO 1.2.1 update notes

- The root page now contains only the UNO entry and the About Me profile entry. Room connection, creation, and joining are available after entering `/uno`.
- About Me uses the supplied `LayUDown` avatar and name. Donation codes switch between the supplied WeChat and Alipay images; closing the donation dialog returns to About Me.
- Light and dark themes remain available. Lobby surfaces use solid colors with no animated background.
- Nginx forwarding preserves the real client address for existing host-only controls. Existing API and Socket.IO paths remain on the port-3000 service.
- Windows installer: `UNO-LAN-1.2.1-setup.exe`.
- Linux web update: `uno-web-1.2.1.tar.gz`.
- Android APK was not rebuilt or replaced.

Verification: `npm run typecheck`, `npm test` (13 files, 90 tests), and `npm run test:e2e` (8 tests) passed. The remote Nginx deployment was not run from this workspace.
