## 1. State Transition

- [x] 1.1 Add an explicit new-conversation event and facade method that clears request, conversation, pending first request, and drafts while keeping the panel open.
- [x] 1.2 Preserve the monotonic conversation identity boundary and add reducer guards/tests proving stale first and follow-up results cannot modify the cleared state.

## 2. Panel Contract And UI

- [x] 2.1 Add the new-conversation control to the AI panel DOM and typed `AiPanelDom` fixture without introducing a second conversation source.
- [x] 2.2 Extend the panel view model and renderer so the control is visible only while a conversation or request exists, and clicking it returns to the empty direct-question form.
- [x] 2.3 Keep existing collapse/reopen, project reset, retry, follow-up, and read-only output behavior unchanged.

## 3. Verification

- [x] 3.1 Add state tests for completed conversations, pending first requests, pending follow-ups, notification behavior, and identity isolation after new conversation.
- [x] 3.2 Add DOM/view-model tests for control visibility, click behavior, cleared drafts, and the empty direct-question state.
- [x] 3.3 Run the project test suite and type/build checks, then confirm the OpenSpec task and requirement scenarios are covered.
