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
