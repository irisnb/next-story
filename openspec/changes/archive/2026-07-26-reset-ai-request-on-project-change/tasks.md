## 1. Regression Coverage

- [x] 1.1 Add a first-request regression test proving a stale old-project request does not block a new project request after project replacement.
- [x] 1.2 Add a structured follow-up regression test proving a stale old-project follow-up request does not block a new project request after project replacement.
- [x] 1.3 Keep or add coverage proving same-project concurrent AI requests remain rejected while the current request is in flight.

## 2. Request Coordination

- [x] 2.1 Add an explicit AI request coordinator operation that releases stale in-flight ownership when the active project token changes.
- [x] 2.2 Wire the reset into project unload and successful project replacement paths that already clear AI panel state.
- [x] 2.3 Preserve stale-result checks so old-project success, structured failure, and rejection cannot update the new project or reopen the panel.

## 3. Verification

- [x] 3.1 Run the targeted frontend tests that cover AI request coordination and project replacement.
- [x] 3.2 Run `npm run check` and document any pre-existing unrelated failures separately.
