#!/usr/bin/env node
/**
 * One-time OAuth2 flow to get a Google refresh token.
 *
 * Usage:
 *   node scripts/google-oauth.mjs <client_id> <client_secret>
 *
 * Opens a browser for consent, runs a local server to catch the redirect,
 * then prints the refresh token to add to .env.
 */

import http from 'http';
import { execSync } from 'child_process';

const [clientId, clientSecret] = process.argv.slice(2);

if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/google-oauth.mjs <client_id> <client_secret>');
  process.exit(1);
}

const PORT = 8976;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = 'https://www.googleapis.com/auth/drive';

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES,
  access_type: 'offline',
  prompt: 'consent',
})}`;

console.log('\nOpening browser for Google consent...\n');

try {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execSync(`${cmd} "${authUrl}"`, { stdio: 'ignore' });
} catch {
  console.log(`Open this URL in your browser:\n\n${authUrl}\n`);
}

console.log('Waiting for redirect...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code parameter.');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const data = await tokenRes.json();

    if (data.error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${data.error_description || data.error}`);
      console.error(`Error: ${data.error_description || data.error}`);
      process.exit(1);
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Done! You can close this tab.</h2>');

    console.log('Add this to your .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);

    server.close();
    process.exit(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Token exchange failed.');
    console.error(err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
