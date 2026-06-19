type GoogleOAuthSetupProps = {
  message?: string;
  missingEnvVars?: string[];
  status?: "ready" | "missing" | "invalid";
};

type SetupSection = {
  title: string;
  body?: string;
  details?: string[];
};

const setupSections: SetupSection[] = [
  {
    title: "Start in Google Cloud",
    body: "Begin by opening Google Cloud Console and choosing the Google account that should own this Matter Layer OAuth configuration.",
    details: [
      "Go to https://console.cloud.google.com/",
      "Sign in with the Google Workspace administrator account or the Google account that will own the Matter Layer OAuth configuration.",
      "Create or select a dedicated Google Cloud project for Matter Layer.",
      "Example project names: Matter Layer, Smith Law Matter Layer",
    ],
  },
  {
    title: "Open Google Auth Platform",
    body: "In Google Cloud Console, go to APIs & Services -> OAuth consent screen. This opens Google Auth Platform.",
    details: [
      "If Google Auth Platform is not configured yet, click Get started.",
      "Matter Layer is self-hosted in this setup. Each law firm deployment should use its own Google Cloud project, OAuth web client, client ID, and client secret.",
    ],
  },
  {
    title: "Complete App Information",
    body: "In the project configuration wizard, complete the App Information step.",
    details: [
      "App name: Matter Layer",
      "User support email: IT or administrator support email",
    ],
  },
  {
    title: "Choose Audience",
    body: "Choose Internal.",
    details: [
      "Internal keeps the app limited to users inside the firm's Google Workspace organization and avoids the external app verification path for this Stage 1 setup.",
      "External is not recommended for Stage 1.",
    ],
  },
  {
    title: "Add Contact Information",
    body: "Enter the IT or administrator support email for the person or team responsible for this Matter Layer deployment.",
  },
  {
    title: "Finish Google Auth Platform setup",
    body: "Review the configuration, agree to the Google API Services User Data Policy if prompted, then click Create.",
  },
  {
    title: "Create the OAuth web client",
    body: "Go to Google Auth Platform -> Clients, then create a web application client.",
    details: [
      "Click Create client or Create OAuth client.",
      "Application type: Web application",
      "Name: Matter Layer Web Client",
    ],
  },
  {
    title: "Add authorized redirect URIs",
    body: "Add callback URLs for local development and production. The callback path must match exactly.",
    details: [
      "Local: http://localhost:3000/api/auth/callback/google",
      "Production: https://your-domain.com/api/auth/callback/google",
      "Required path: /api/auth/callback/google",
      "Example: https://matterlayer.smithlaw.com/api/auth/callback/google",
      "Example: https://ai.smithlaw.com/api/auth/callback/google",
      "Example: https://smithlaw-matter-layer.vercel.app/api/auth/callback/google",
    ],
  },
  {
    title: "Copy the client credentials",
    body: "After creating the OAuth web client, Google shows the Client ID and Client secret.",
    details: [
      "Client ID becomes AUTH_GOOGLE_ID.",
      "Client secret becomes AUTH_GOOGLE_SECRET.",
    ],
  },
  {
    title: "Generate AUTH_SECRET",
    body: "Run npx auth secret and use the generated value for AUTH_SECRET.",
    details: ["npx auth secret", "AUTH_SECRET=\"paste-generated-secret-here\""],
  },
];

const productionEnvVars = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "NEXTAUTH_URL",
  "MATTER_LAYER_FIRM_NAME",
  "MATTER_LAYER_ALLOWED_DOMAINS",
];

const troubleshootingItems = [
  {
    title: "redirect_uri_mismatch",
    body: "The redirect URI in Google Auth Platform does not exactly match the URL Matter Layer is using. Check protocol, domain, port, and the /api/auth/callback/google path.",
  },
  {
    title: "access blocked",
    body: "Confirm the Google Auth Platform audience is Internal and that the user belongs to the firm's Google Workspace organization.",
  },
  {
    title: "User can sign in but should not have access",
    body: "Check MATTER_LAYER_ALLOWED_DOMAINS and the user's active, pending, or disabled status in Matter Layer.",
  },
  {
    title: "Works locally but fails in production",
    body: "Confirm production environment variables, redeploy the app, and verify the production callback URL is listed in Google Auth Platform -> Clients -> Matter Layer Web Client.",
  },
];

function CodeLine({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto bg-zinc-50 px-3 py-2 font-mono text-sm leading-6 text-zinc-800 ring-1 ring-zinc-200">
      {children}
    </code>
  );
}

export function GoogleOAuthSetup({
  message,
  missingEnvVars = [],
  status = "missing",
}: GoogleOAuthSetupProps) {
  const hasMissingEnvVars = missingEnvVars.length > 0;

  return (
    <main
      className="min-h-screen bg-zinc-50 text-zinc-950"
      data-testid="auth-setup-instructions"
    >
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold uppercase text-[#5c6f47]">
              Matter Layer configuration
            </p>
            <div className="flex flex-col gap-4">
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
                Google OAuth Setup
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-zinc-700">
                Configure Google OAuth for this self-hosted Matter Layer
                deployment. Each law firm deployment uses its own Google Cloud
                project, OAuth web client, client ID, and client secret.
              </p>
            </div>
          </div>

          {status === "ready" ? (
            <div className="border-l-4 border-[#5c6f47] bg-[#f4f8ef] p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                Google sign-in is configured
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                Matter Layer found the required Google OAuth environment
                variables. Continue to the app when the rest of setup is
                complete.
              </p>
            </div>
          ) : hasMissingEnvVars ? (
            <div className="border-l-4 border-[#b24a3b] bg-[#fff4f0] p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                Google sign-in is not configured
              </h2>
              {message ? (
                <p className="mt-2 text-sm leading-6 text-zinc-700">
                  {message}
                </p>
              ) : null}
              <p className="mt-2 text-sm leading-6 text-zinc-700">
                The following environment variables are missing:
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {missingEnvVars.map((envVar) => (
                  <li
                    key={envVar}
                    className="border border-[#e5b2a6] bg-white px-3 py-1 font-mono text-sm text-[#8b2f23]"
                    data-testid="missing-auth-env-var"
                  >
                    {envVar}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-6 text-zinc-700">
                Add these values to{" "}
                <code className="font-mono">.env.local</code>, then restart or
                redeploy Matter Layer.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10 sm:px-8 lg:px-10">
        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            What you will create
          </h2>
          <ul className="mt-4 grid gap-2 text-sm leading-6 text-zinc-700 sm:grid-cols-2">
            <li>Dedicated Google Cloud project</li>
            <li>Google Auth Platform configuration</li>
            <li>OAuth web client</li>
            <li>Client ID</li>
            <li>Client secret</li>
            <li>Authorized redirect URI</li>
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          {setupSections.map((step, index) => (
            <article
              key={step.title}
              className="grid gap-4 bg-white p-6 shadow-sm ring-1 ring-zinc-200 sm:grid-cols-[3rem_minmax(0,1fr)]"
            >
              <div className="flex size-10 items-center justify-center bg-[#5c6f47] text-sm font-semibold text-white">
                {index + 1}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-zinc-950">
                  {step.title}
                </h2>
                {step.body ? (
                  <p className="mt-2 text-sm leading-6 text-zinc-700">
                    {step.body}
                  </p>
                ) : null}
                {step.details ? (
                  <ul className="mt-4 grid gap-2">
                    {step.details.map((detail) => (
                      <li key={detail}>
                        <CodeLine>{detail}</CodeLine>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Configure local environment variables
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            For local development, set{" "}
            <code className="font-mono">NEXTAUTH_URL</code> to:
          </p>
          <div className="mt-3">
            <CodeLine>{'NEXTAUTH_URL="http://localhost:3000"'}</CodeLine>
          </div>
          <p className="mt-5 text-sm leading-6 text-zinc-700">
            Complete local example:
          </p>
          <pre className="mt-3 overflow-x-auto bg-zinc-950 p-4 text-sm leading-6 text-zinc-50">
            <code>{`AUTH_SECRET="replace-with-generated-secret"
AUTH_GOOGLE_ID="replace-with-google-client-id"
AUTH_GOOGLE_SECRET="replace-with-google-client-secret"
NEXTAUTH_URL="http://localhost:3000"

MATTER_LAYER_FIRM_NAME="Smith Law"
MATTER_LAYER_ALLOWED_DOMAINS="smithlaw.com"`}</code>
          </pre>
          <p className="mt-4 text-sm leading-6 text-zinc-700">
            Do not commit real environment values to the repository. Use{" "}
            <code className="font-mono">.env.local</code> for local
            development, then restart the dev server.
          </p>
        </div>

        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Configure production environment variables
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-700">
            In Vercel, go to Project Settings -&gt; Environment Variables and
            add:
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {productionEnvVars.map((envVar) => (
              <li key={envVar}>
                <CodeLine>{envVar}</CodeLine>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid gap-3">
            <p className="text-sm leading-6 text-zinc-700">
              For production, set{" "}
              <code className="font-mono">NEXTAUTH_URL</code> to the public
              production URL.
            </p>
            <CodeLine>
              {'NEXTAUTH_URL="https://matterlayer.smithlaw.com"'}
            </CodeLine>
            <p className="text-sm leading-6 text-zinc-700">
              Make sure the matching production callback URL is also listed in
              Google Auth Platform -&gt; Clients -&gt; Matter Layer Web Client.
            </p>
          </div>
        </div>

        <div className="bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <h2 className="text-2xl font-semibold text-zinc-950">
            Troubleshooting
          </h2>
          <div className="mt-5 grid gap-4">
            {troubleshootingItems.map((item) => (
              <section key={item.title}>
                <h3 className="font-semibold text-zinc-950">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-zinc-700">
                  {item.body}
                </p>
              </section>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
