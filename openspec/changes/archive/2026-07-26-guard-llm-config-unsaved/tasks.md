## 1. State and Guard Surface

- [x] 1.1 Update LLM configuration state so loaded or successfully saved values become the saved baseline, and current form values can report whether they differ from that baseline
- [x] 1.2 Expose LLM configuration page dirty, save, and guard-leave operations from the configuration controller without exposing API Key text in dialog content or logs

## 2. Leave Flow Integration

- [x] 2.1 Route the LLM configuration page back action through the configuration leave guard before showing the previous page
- [x] 2.2 Compose native window close protection so editor unsaved text and LLM configuration unsaved changes must both pass their own leave guards before the window is destroyed
- [x] 2.3 Ensure save failure during configuration leave keeps the app on the configuration page or keeps the window open, preserves current input, and keeps configuration dirty state

## 3. Tests and Verification

- [x] 3.1 Add frontend state tests for configuration dirty baseline updates after load, successful save, discard, and failed save
- [x] 3.2 Add frontend flow tests for configuration back navigation choices and native close behavior when only configuration is dirty or when both editor and configuration are dirty
- [x] 3.3 Run targeted frontend tests, TypeScript checks, and OpenSpec validation for `guard-llm-config-unsaved`
