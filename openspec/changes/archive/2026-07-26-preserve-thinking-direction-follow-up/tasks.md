## 1. Regression Coverage

- [x] 1.1 Add a frontend regression test proving a `思维扩展` conversation started with a non-empty direction sends that same direction-bearing initial user material when submitting a follow-up.
- [x] 1.2 Add or keep a regression test proving `及时召唤` follow-ups do not gain a direction field or direction text.
- [x] 1.3 If backend message assembly changes, add a Rust unit test proving follow-up message reconstruction preserves the first user material exactly for direction-bearing requests.

## 2. Temporary Conversation State

- [x] 2.1 Extend the current temporary conversation state to retain immutable initial user material for the accepted first request.
- [x] 2.2 Populate that metadata from `思维扩展` start using the frozen selection and trimmed non-empty direction.
- [x] 2.3 Populate the same metadata for `及时召唤` without adding a direction.
- [x] 2.4 Ensure new召唤 and project unload/replacement still replace or clear the whole temporary conversation, including this metadata.

## 3. Follow-up Request Assembly

- [x] 3.1 Update follow-up request construction to send the preserved initial user material instead of reconstructing the first user message from selected text alone.
- [x] 3.2 Update backend request types and message assembly only as far as needed for the new structured data.
- [x] 3.3 Keep the request boundary unchanged: no nearby context, full notebook text, summary, project metadata, AI content library, history, or user-confirmed story information.

## 4. Verification

- [x] 4.1 Run targeted frontend tests covering AI panel, thinking expansion, and follow-up request assembly.
- [x] 4.2 Run targeted Rust tests if backend request assembly changed.
- [x] 4.3 Run `npm run check` and document any pre-existing unrelated failures separately.
