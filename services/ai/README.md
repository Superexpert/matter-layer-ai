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
The selected provider, model, and API key are stored in the app database.

Admin setup:

1. Sign in as the first Admin.
2. Open `/app/admin`.
3. Select the AI provider.
4. Select the model.
5. Enter the provider API key and save settings.

The Anthropic `sonnet-4` model option is a Matter Layer alias that resolves to
Anthropic's current Claude API model ID `claude-sonnet-4-6`.
