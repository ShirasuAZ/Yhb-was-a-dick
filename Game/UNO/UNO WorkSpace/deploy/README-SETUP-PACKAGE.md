# LayUDown Game Suite Setup Package

The ZIP is a Linux server update bundle, not a Windows installer. Its root contains:

- `dist/`: production frontend plus the existing UNO and new Shogi Node server bundles.
- `deploy/`: deployment and rollback scripts, Nginx location example, test report, changelog, and ECS instructions.
- `source/UNO/UNO WorkSpace/`: the full website, UNO source and tests, Shogi integration, assets, dependency lockfile, and title protection check.
- `source/Hon shugi/Hon shugi WorkSpace/`: the Hon shugi engine source, engine tests, and workspace metadata.

Extract the ZIP and follow `deploy/README-GAME-SUITE-1.0.0.md` from its root `deploy/` directory. The deployed address remains `http://47.100.174.241/`; the package does not require DNS or expose port 3001.
