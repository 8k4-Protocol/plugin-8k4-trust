# @8k4protocol/plugin-trust

`@8k4protocol/plugin-trust` adds trust-aware behavior to ElizaOS agents using 8K4 Protocol trust APIs: explicit trust checks (`CHECK_AGENT_TRUST`), trusted counterparty discovery (`FIND_TRUSTED_AGENT`), a pre-evaluator trust guard (`off/warn/block`), and a lightweight trust context provider powered by free `/agents/top` data.

## Install

```bash
bun add @8k4protocol/plugin-trust
```

(or `npm i @8k4protocol/plugin-trust`)

## What this plugin gives you

- `CHECK_AGENT_TRUST` — check trust for an ERC-8004 agent ID or wallet
- `FIND_TRUSTED_AGENT` — search for trusted counterparties for a task
- trust guard pre-evaluator — warn or block before low-trust interactions
- trust context provider — inject current `/agents/top` trust context into runtime

## Development / Local Install

Clone and link locally:

```bash
git clone https://github.com/8k4-Protocol/plugin-8k4-trust
cd plugin-8k4-trust
bun install
bun run build
bun link

# In your ElizaOS project:
bun link @8k4protocol/plugin-trust
```

## Register in your character

```ts
import trustPlugin from "@8k4protocol/plugin-trust";

export default {
  name: "MyAgent",
  plugins: [trustPlugin],
};
```

Or in JSON-style character configs:

```json
{
  "name": "TrustTestAgent",
  "plugins": ["@8k4protocol/plugin-trust"]
}
```

## Configuration

| Setting | Required | Default | Description |
|---|---:|---|---|
| `EIGHTK4_API_KEY` | No* | _(unset)_ | API key used for paid endpoints. Required unless paid calls are handled via x402. |
| `EIGHTK4_API_BASE` | No | `https://api.8k4protocol.com` | Base URL for 8K4 API. |
| `EIGHTK4_DEFAULT_CHAIN` | No | `eth` | Default chain for score/search calls. |
| `EIGHTK4_GUARD_MODE` | No | `warn` | Trust guard mode: `off`, `warn`, or `block`. |
| `EIGHTK4_GUARD_FAIL_MODE` | No | derived | Enforcement failure behavior: `open` or `closed`. Defaults to `open` in `warn` mode and `closed` in `block` mode unless explicitly set. |
| `EIGHTK4_GUARD_BLOCK_THRESHOLD` | No | `30` | In `block` mode, block if score is below this threshold or trust tier is `minimal`/`new`. |
| `EIGHTK4_GUARD_CAUTION_THRESHOLD` | No | `60` | In `warn`/`block` mode, warn if score is below this threshold. |
| `EIGHTK4_CACHE_TTL_MS` | No | `300000` | In-memory cache TTL for trust/search/top responses. Clamped to `1000..3600000`. |
| `EIGHTK4_CACHE_MAX_ENTRIES` | No | `500` | Maximum in-memory cache entries before oldest entries are evicted. Clamped to `50..10000`. |
| `EIGHTK4_TIMEOUT_MS` | No | `8000` | HTTP timeout per request. Clamped to `500..30000`. |
| `EIGHTK4_ALLOW_CUSTOM_API_BASE` | No | `false` | Permit non-default HTTPS API hosts. Without this, non-default hosts are rejected and the default API base is used. |

\* Paid endpoints need API key or x402 micropayment flow.

## Quickstart

Minimal setup (free features only — trust context provider, no paid lookups):

```env
# No API key needed for free endpoints
EIGHTK4_GUARD_MODE=warn
```

Full setup (paid trust checks + guard enforcement):

```env
EIGHTK4_API_KEY=your-api-key-here
EIGHTK4_GUARD_MODE=block
# block mode defaults to fail-closed — no need to set EIGHTK4_GUARD_FAIL_MODE
```

## Tested runtime status

Validated in a live ElizaOS runtime with:
- plugin boot/loading
- `CHECK_AGENT_TRUST`
- `FIND_TRUSTED_AGENT`
- bare-number negative case (`roadmap 2026 has 3 milestones`)
- browser UI response path

## Security model

The plugin applies several hardening measures by default:

- **No bare-number inference.** The plugin will never treat a random number in conversation as an agent ID. Only explicit forms are accepted: `parameters.agentId`, wallet addresses (`0x...`), or text patterns like `agent:6888`, `agent_id=6888`, `erc8004:6888`, `8k4:6888`.
- **Fail-closed in block mode.** If the trust API is unreachable while the guard is set to `block`, the plugin blocks the interaction rather than silently allowing it. This is configurable via `EIGHTK4_GUARD_FAIL_MODE`.
- **API base is locked down.** Only `https://` is accepted. Non-default hosts are rejected unless `EIGHTK4_ALLOW_CUSTOM_API_BASE=true` is set, preventing accidental credential leakage to wrong hosts.
- **Inputs are clamped.** Agent IDs, search limits, score thresholds, query lengths, timeouts, and cache sizes are all bounded to sane ranges regardless of what the caller passes.
- **Cache is bounded.** The in-memory cache has a max entry count with LRU eviction and deduplicates concurrent in-flight requests to the same endpoint to avoid redundant paid calls.
- **Provider context is sandboxed.** Data injected into model context is framed as untrusted reference material, serialized as structured data, and sanitized to strip control characters and injection-prone tokens.

**Operator responsibility:** The plugin reduces accidental spend through caching, input clamping, and deduplication, but does not implement per-user rate limits or budget caps. Production deployments should enforce these at the host/gateway level.

## Actions

### `CHECK_AGENT_TRUST`
Checks trust by **agent ID (integer ERC-8004 token ID)** or wallet address.

Example prompts:
- "Check trust for agent 6888 on eth"
- "Check trust for wallet 0xabc... on base"
- "Explain trust for agent 6888"

Parameters:
- `agentId` (required) — numeric agent ID or wallet `0x...`
- `chain` (optional)
- `explain` (optional boolean)

Output includes:
- `score`
- `score_tier`
- `trust_tier`
- `confidence`
- `adjusted`
- `adjustment_reasons`
- optional `positives/cautions` when `explain=true`

### `FIND_TRUSTED_AGENT`
Finds trusted counterparties for a task using `/agents/search`.

Example prompts:
- "Find me a trusted agent for token swaps"
- "Search trusted liquidation bot agents on base with score above 70"

Parameters:
- `query` (required)
- `chain` (optional)
- `minScore` (optional, default `60`)
- `limit` (optional, default `20`)

## Trust guard (pre-evaluator)

Mode behavior:
- `off`: no trust guard checks.
- `warn`: message is allowed, but warning context is injected when trust is low or the score falls below the caution threshold.
- `block`: minimal/new-trust interactions or scores below the block threshold are blocked before normal response processing.

Example settings:

```env
EIGHTK4_GUARD_MODE=warn
EIGHTK4_GUARD_FAIL_MODE=open
EIGHTK4_GUARD_CAUTION_THRESHOLD=60
```

```env
EIGHTK4_GUARD_MODE=block
EIGHTK4_GUARD_FAIL_MODE=closed
EIGHTK4_GUARD_BLOCK_THRESHOLD=30
```

## Provider: trust context

The provider calls **free** endpoint `/agents/top` and injects a ranked trust snapshot into runtime state (`8k4_trust_context`). This gives the model up-to-date trusted-agent context even when no API key is configured.

## x402 synergy

8K4 paid endpoints support x402 micropayments. If `EIGHTK4_API_KEY` is not set, this plugin can use an available `plugin-x402` payment fetch path for paid calls (when configured in runtime). This allows trust checks/search over paid endpoints without hard-coding API key auth.

## API caveats / rate limits

- Free endpoints: `/agents/top`, `/stats/public`, `/health`
- Paid endpoints used by this plugin: `/agents/{agent_id}/score`, `/agents/{agent_id}/score/explain`, `/agents/search`, `/wallet/{wallet}/score`
- Add caching and sane call frequency to avoid rate-limit pressure.

## Notes

- `agent_id` is an integer token ID, not an EVM address.
- Use wallet endpoints for `0x...` identifiers.
- Bare numbers in arbitrary free text are intentionally ignored; use explicit forms like `agent:6888` or pass `parameters.agentId`.
- `EIGHTK4_API_BASE` must be HTTPS. Non-default hosts require `EIGHTK4_ALLOW_CUSTOM_API_BASE=true`.
- Guard enforcement failure behavior is explicit: `warn` mode defaults to fail-open, while `block` mode defaults to fail-closed unless overridden.

## Troubleshooting

**"Paid 8K4 endpoint requires EIGHTK4_API_KEY or plugin-x402..."**
Set `EIGHTK4_API_KEY` in your character settings or configure `@elizaos/plugin-x402` for micropayments. Free features (trust context provider, `/agents/top`) work without a key.

**Trust guard blocks everything after an API outage**
In `block` mode, the guard defaults to fail-closed. If you prefer fail-open during outages, set `EIGHTK4_GUARD_FAIL_MODE=open`.

**"EIGHTK4_API_BASE host rejected"**
The plugin only allows `api.8k4protocol.com` by default. For staging/custom hosts, set `EIGHTK4_ALLOW_CUSTOM_API_BASE=true`.

**Agent ID not recognized from conversation text**
The plugin intentionally ignores bare numbers. Use explicit forms: `agent:6888`, `agent_id=6888`, `erc8004:6888`, or `8k4:6888`. Or pass the ID via `parameters.agentId`.

## Publish checklist

Before publishing publicly:
- run `npm install`
- run `npm run build`
- run `npm run test`
- verify install/link in a clean ElizaOS project
- confirm package scope/ownership on npm

## References

- 8K4 Protocol API base: `https://api.8k4protocol.com`
- 8K4 docs: `https://docs.8k4protocol.com`
- ElizaOS x402 plugin: `@elizaos/plugin-x402`
