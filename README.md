# Lister v3

Real Google authentication + shared Supabase/Postgres database.

## Setup
1. Create a Supabase project.
2. Run `schema.sql` in Supabase SQL Editor.
3. Enable Google under Supabase Authentication > Providers.
4. Create a Google OAuth Web client in Google Cloud / Google Auth Platform.
5. Add your site's origin to Google's Authorized JavaScript origins.
6. Add the Supabase callback URL shown by Supabase to Google's Authorized redirect URIs.
7. Copy `config.example.js` to `config.js` and fill in the Supabase project URL and publishable key.
8. Serve the folder, e.g. `python3 -m http.server 8080`.
9. Add `http://localhost:8080` to Supabase Auth URL/redirect settings for development.

Never put a Supabase service_role/secret key in the browser.
