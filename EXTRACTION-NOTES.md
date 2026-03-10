# Extraction Notes

This standalone repo was prepared from:
- source: `projects/agent-trust/integrations/elizaos/plugin-8k4-trust/`

Included:
- `src/`
- `__tests__/`
- `README.md`
- `tsconfig.json`
- standalone `package.json`
- `LICENSE`
- `CHANGELOG.md`
- example character config
- GitHub Actions CI workflow

Intentionally excluded:
- `dist/`
- `node_modules/`
- monorepo-local Eliza clone and reference plugin clones
- monorepo docs/checklists/plans not needed for package consumers

Before publishing:
1. `cd projects/plugin-8k4-trust`
2. `npm install`
3. `npm run build`
4. `npm run test`
5. initialize a new git repo or push to `github.com/8k4protocol/plugin-8k4-trust`
6. publish via `npm publish --access public`
