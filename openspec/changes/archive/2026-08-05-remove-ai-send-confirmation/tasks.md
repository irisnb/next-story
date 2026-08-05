## 1. Remove Send Confirmation Flow

- [x] 1.1 Remove creative-content confirmation preflight from AI first-request and follow-up request paths
- [x] 1.2 Remove in-memory API-origin confirmation tracking and unused origin-normalization helpers if no longer referenced
- [x] 1.3 Remove obsolete canceled-confirmation panel states and UI copy while preserving blocked and error states

## 2. Update LLM/API Configuration Disclosure

- [x] 2.1 Add one visible configuration-page line explaining AI requests send selected text and follow-up content to the configured model service
- [x] 2.2 Ensure the disclosure also states AI replies remain temporary AI-panel material and do not write into draft or main notebooks

## 3. Permissions And Tests

- [x] 3.1 Remove Tauri dialog permission only if no remaining runtime path uses native dialogs
- [x] 3.2 Update frontend tests that expected confirmation cancellation or origin confirmation behavior
- [x] 3.3 Add or update tests for direct AI request start and configuration-page disclosure copy
- [x] 3.4 Run targeted frontend tests for AI panel, AI feature flow, and LLM configuration form
