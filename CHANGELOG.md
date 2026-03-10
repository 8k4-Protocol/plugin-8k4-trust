# Changelog

## 0.1.0

- Initial standalone release of `@8k4/plugin-trust`
- `CHECK_AGENT_TRUST` action for agent ID and wallet trust checks
- `FIND_TRUSTED_AGENT` action for trusted counterparty discovery
- Trust guard pre-evaluator with `off|warn|block` modes
- Trust context provider powered by free `/agents/top` data
- Security hardening: explicit target parsing, fail-mode control, input clamps, API base locking, bounded cache, in-flight dedupe
- Live ElizaOS integration tested
