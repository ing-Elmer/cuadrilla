# Deploying the SPA as static files

`npm run build` produces `dist/`: `index.html` plus hashed files under `dist/assets/`. Any static
host works if it does four things:

1. **SPA fallback:** unknown paths serve `index.html` (react-router handles them), but missing
   files under `/assets/` return 404 (never `index.html` with 200).
2. **Caching:** `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`;
   `index.html` → `no-cache` (so a new deploy is picked up immediately).
3. **Security headers:** see `security.md` (nosniff, frame denial, referrer policy, permissions
   policy, HSTS, CSP when ready).
4. **Environment:** `VITE_API_URL` is baked in **at build time** per environment (production →
   production API, preview → staging API). Changing it requires a rebuild.

Deploy target, domains and environments come from the project profile. The deploy platform
builds from GitHub and **waits for CI** (`ci-<name>` job); no deploy tokens stored in GitHub
unless the profile declares an exception.

## Vercel

- Template: `${CLAUDE_SKILL_DIR}/templates/vercel.json` (framework `vite`, `npm ci`, rewrite to
  `/index.html` except `/assets/`, immutable assets, `no-cache` index, security headers).
- Project settings: *Root Directory* = component path; Node version from `.nvmrc`/`engines`.
- *Deployment Checks*: require the `ci-<name>` check so production waits for CI.
- Environment variables: `VITE_API_URL` for Production and Preview separately.
- Backend CORS: production Vercel domain in explicit origins; `*.vercel.app` previews allowed
  only on non-production backends.

## Netlify

`netlify.toml` at the component root:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    Strict-Transport-Security = "max-age=63072000; includeSubDomains"
```

Netlify serves existing files before redirects, so `/assets/*` files are not rewritten; set
`VITE_API_URL` per deploy context (production / deploy-preview) and require the CI check before
publishing.

## nginx

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;   # contents of dist/
  index index.html;

  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

  location /assets/ {
    try_files $uri =404;                       # never fall back to index.html
    add_header Cache-Control "public, max-age=31536000, immutable" always;
  }

  location = /index.html {
    add_header Cache-Control "no-cache" always;
  }

  location / {
    try_files $uri $uri/ /index.html;          # SPA fallback
  }
}
```

(`add_header` inside a `location` replaces the server-level ones: repeat the security headers
there if the location sets its own, or use an `include` snippet.) Enable gzip/brotli for
`text/css`, `application/javascript`, `image/svg+xml`. HSTS goes on the TLS-terminating server.
For a container: multi-stage Dockerfile (`node:<lts>` builds with `npm ci && npm run build`,
`nginx:stable-alpine` serves `dist/`), with `VITE_API_URL` passed as a build arg.

## IIS

Requires the **URL Rewrite** module. `public/web.config` (Vite copies `public/` into `dist/`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
            <add input="{REQUEST_URI}" pattern="^/assets/" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <staticContent>
      <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" />
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".webmanifest" />
      <mimeMap fileExtension=".webmanifest" mimeType="application/manifest+json" />
    </staticContent>
    <httpProtocol>
      <customHeaders>
        <add name="X-Content-Type-Options" value="nosniff" />
        <add name="X-Frame-Options" value="DENY" />
        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />
        <add name="Permissions-Policy" value="camera=(), microphone=(), geolocation=()" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
  <location path="index.html">
    <system.webServer>
      <staticContent>
        <clientCache cacheControlMode="DisableCache" />
      </staticContent>
    </system.webServer>
  </location>
</configuration>
```

If the app lives in a sub-path (`https://host/<app>/`), set `base: "/<app>/"` in
`vite.config.ts`, `basename` in the router, and rewrite to `/<app>/index.html`.

## Before a production deploy

- CI green on the commit; `npm audit --omit=dev` reviewed.
- `VITE_API_URL` correct for the environment; backend CORS lists the frontend origin.
- Deep link (e.g. `/customers/1`) reloads correctly; a missing `/assets/x.js` returns 404.
- Response headers checked on the preview URL.
