# Matter Layer AI service

Workflow code and UI code should call the AI service instead of importing model
provider SDKs directly.

Provider calls are stateless. Matter Layer sends the message history required for
each request and remains responsible for application persistence.

For OpenAI, `store: false` is set on each response request so responses are not
stored as OpenAI provider-side application state. True zero data retention can
still require provider/account-level configuration; this code avoids
application-level provider storage even when that account-level setting is not
available.

Configure the active provider from `/app/admin` after signing in as an Admin.
The selected provider and model are stored in the app database. Cloud providers
store an API key. Ollama Local stores the internal Ollama server URL and does
not require an API key.

Admin setup:

1. Sign in as the first Admin.
2. Open `/app/admin`.
3. Select the AI provider.
4. Select the model.
5. For cloud providers, enter the provider API key. For Ollama Local, enter the
   internal Ollama server URL and refresh installed models.
6. Save settings.

The Anthropic `sonnet-4` model option is a Matter Layer alias that resolves to
Anthropic's current Claude API model ID `claude-sonnet-4-6`.

For intranet deployments, Ollama Local defaults to `http://localhost:11434`.
Use a different internal URL only when Ollama runs on another server.
