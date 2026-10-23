# LayUDown Game Suite 2.0.1

- Shogi board coordinates and player hands now follow each player's seat, so the player's own army is displayed at the bottom and faces them.
- Shogi hand pieces stay upright for both players. The turn indicator uses readable colors in light mode, and the compact board stacks opponent hand, board, and local hand on mobile landscape.
- Shogi rooms now wait for a second player to join and get ready before the host can start. The room number and setup controls disappear once play begins; the active view keeps the turn label, room-exit button, hands, and a compact board.
- Leaving an active Shogi game awards the opponent a win and releases the departing player's seat. A replacement can join the finished room and prepare for a new game.
- Moved logout into About Me for the homepage and Shogi lobby. Added password-confirmed account deletion and a collapsible donation section.
- Registration now requires a unique email address. Password recovery checks the registered username and email, sets a new password, and invalidates existing account tokens.
- Existing accounts without a stored email remain able to log in; email recovery requires an account with a registered email.
- UNO game rules and gameplay presentation were not changed. The homepage, UNO, and Shogi services remain on ports 80, 3000, and 3001 respectively.
