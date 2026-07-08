# Live Extraction Provider Tests

These tests make real AI provider calls against the Eminent Domain sample
evidence in `sample-evidence/eminent-domain`.

Run all configured providers:

```sh
npm run test:live:extraction
```

The script reads `.nvmrc` automatically when nvm is installed. If your shell is
not on Node 24, run `nvm use` from the repo root and retry.

Run a subset:

```sh
MATTER_LAYER_LIVE_EXTRACTION_PROVIDERS=openai,anthropic npm run test:live:extraction
MATTER_LAYER_LIVE_EXTRACTION_PROVIDERS=ollama npm run test:live:extraction
```

Provider configuration:

- OpenAI requires `OPENAI_API_KEY`; model defaults to `gpt-5-mini`.
- Anthropic requires `ANTHROPIC_API_KEY`; model defaults to `sonnet-4`.
- Ollama defaults to `http://localhost:11434` and `gemma3:4b`.

Overrides:

- `MATTER_LAYER_LIVE_OPENAI_MODEL`
- `MATTER_LAYER_LIVE_ANTHROPIC_MODEL`
- `MATTER_LAYER_LIVE_OLLAMA_BASE_URL`
- `MATTER_LAYER_LIVE_OLLAMA_MODEL`
- `MATTER_LAYER_LIVE_EXTRACTION_DOCUMENT_LIMIT`
- `MATTER_LAYER_LIVE_EXTRACTION_AI_TIMEOUT_MS`
