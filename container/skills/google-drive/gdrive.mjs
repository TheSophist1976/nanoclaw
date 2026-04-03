#!/usr/bin/env node
/**
 * Google Drive CLI wrapper using REST API v3.
 * No external dependencies — uses Node 22 native fetch.
 *
 * Auth: OAuth2 refresh token flow.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * Usage: node gdrive.mjs <command> [args...]
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// --- Auth ---

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 30_000) return cachedToken;

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'Missing env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN',
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

async function driveRequest(path, opts = {}) {
  const token = await getAccessToken();
  const base = opts.upload ? UPLOAD_API : DRIVE_API;
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    },
  });
  return res;
}

// --- Helpers ---

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function out(data) {
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

function parseFolderId(input) {
  // Accept folder ID, full URL, or path
  if (!input) return null;
  const urlMatch = input.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // If it looks like an ID (no slashes), use as-is
  if (!input.includes('/')) return input;
  return null;
}

// --- Commands ---

async function cmdList(args) {
  const folderId = parseFolderId(args[0]) || 'root';
  const pageSize = args[1] || '20';
  const q = `'${folderId}' in parents and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize,
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
    orderBy: 'folder,modifiedTime desc',
  });

  const res = await driveRequest(`/files?${params}`);
  if (!res.ok) die(`List failed: ${await res.text()}`);
  const data = await res.json();

  if (!data.files?.length) {
    out('No files found.');
    return;
  }

  const lines = data.files.map((f) => {
    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
    const size = f.size ? `${(parseInt(f.size) / 1024).toFixed(1)}KB` : '-';
    const date = f.modifiedTime?.split('T')[0] || '';
    const type = isFolder ? 'DIR' : size;
    return `${type.padEnd(10)} ${date}  ${f.name}  [${f.id}]`;
  });

  out(lines.join('\n'));
}

async function cmdSearch(args) {
  const query = args.join(' ');
  if (!query) die('Usage: gdrive search <query>');

  const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed=false`;
  const params = new URLSearchParams({
    q,
    pageSize: '20',
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  const res = await driveRequest(`/files?${params}`);
  if (!res.ok) die(`Search failed: ${await res.text()}`);
  const data = await res.json();

  if (!data.files?.length) {
    out('No results found.');
    return;
  }

  const lines = data.files.map((f) => {
    const date = f.modifiedTime?.split('T')[0] || '';
    return `${date}  ${f.name}  [${f.id}]`;
  });

  out(lines.join('\n'));
}

async function cmdRead(args) {
  const fileId = parseFolderId(args[0]) || args[0];
  if (!fileId) die('Usage: gdrive read <fileId>');

  // First get file metadata to determine type
  const metaRes = await driveRequest(`/files/${fileId}?fields=name,mimeType,size`);
  if (!metaRes.ok) die(`Metadata failed: ${await metaRes.text()}`);
  const meta = await metaRes.json();

  const googleDocTypes = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing': 'image/svg+xml',
  };

  let content;
  if (googleDocTypes[meta.mimeType]) {
    // Export Google Workspace files
    const exportMime = googleDocTypes[meta.mimeType];
    const res = await driveRequest(
      `/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
    );
    if (!res.ok) die(`Export failed: ${await res.text()}`);
    content = await res.text();
  } else {
    // Download binary/text files
    const res = await driveRequest(`/files/${fileId}?alt=media`);
    if (!res.ok) die(`Download failed: ${await res.text()}`);

    if (meta.mimeType?.startsWith('text/') || meta.mimeType === 'application/json') {
      content = await res.text();
    } else {
      // Binary file — save to /tmp
      const buffer = Buffer.from(await res.arrayBuffer());
      const outPath = `/tmp/${meta.name}`;
      const { writeFileSync } = await import('fs');
      writeFileSync(outPath, buffer);
      out(`Binary file saved to: ${outPath} (${buffer.length} bytes)`);
      return;
    }
  }

  out(content);
}

async function cmdInfo(args) {
  const fileId = parseFolderId(args[0]) || args[0];
  if (!fileId) die('Usage: gdrive info <fileId>');

  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,createdTime,modifiedTime,owners,parents,webViewLink,shared',
  });

  const res = await driveRequest(`/files/${fileId}?${params}`);
  if (!res.ok) die(`Info failed: ${await res.text()}`);
  out(await res.json());
}

async function cmdUpload(args) {
  const filePath = args[0];
  const parentId = parseFolderId(args[1]);
  if (!filePath) die('Usage: gdrive upload <localPath> [parentFolderId]');

  const { readFileSync, statSync } = await import('fs');
  const { basename } = await import('path');

  const name = basename(filePath);
  const stat = statSync(filePath);
  const fileData = readFileSync(filePath);

  // Use multipart upload for files under 5MB, resumable for larger
  const metadata = { name };
  if (parentId) metadata.parents = [parentId];

  if (stat.size < 5 * 1024 * 1024) {
    // Simple multipart upload
    const boundary = '---nanoclaw-boundary---';
    const body = [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      'Content-Type: application/octet-stream\r\n\r\n',
    ].join('');

    const bodyBuffer = Buffer.concat([
      Buffer.from(body),
      fileData,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const res = await driveRequest(
      `/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        upload: true,
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: bodyBuffer,
      },
    );

    if (!res.ok) die(`Upload failed: ${await res.text()}`);
    out(await res.json());
  } else {
    die(`File too large for simple upload (${stat.size} bytes). Max 5MB via this tool.`);
  }
}

async function cmdMkdir(args) {
  const name = args[0];
  const parentId = parseFolderId(args[1]);
  if (!name) die('Usage: gdrive mkdir <name> [parentFolderId]');

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) metadata.parents = [parentId];

  const res = await driveRequest('/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) die(`Mkdir failed: ${await res.text()}`);
  out(await res.json());
}

async function cmdDelete(args) {
  const fileId = parseFolderId(args[0]) || args[0];
  if (!fileId) die('Usage: gdrive delete <fileId>');

  // Move to trash (not permanent delete)
  const res = await driveRequest(`/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });

  if (!res.ok) die(`Delete failed: ${await res.text()}`);
  out(`Moved to trash: ${fileId}`);
}

async function cmdShare(args) {
  const fileId = parseFolderId(args[0]) || args[0];
  const email = args[1];
  const role = args[2] || 'reader';
  if (!fileId || !email) die('Usage: gdrive share <fileId> <email> [reader|writer|commenter]');

  const res = await driveRequest(`/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'user',
      role,
      emailAddress: email,
    }),
  });

  if (!res.ok) die(`Share failed: ${await res.text()}`);
  out(`Shared ${fileId} with ${email} as ${role}`);
}

async function cmdMove(args) {
  const fileId = parseFolderId(args[0]) || args[0];
  const newParentId = parseFolderId(args[1]) || args[1];
  if (!fileId || !newParentId) die('Usage: gdrive move <fileId> <newParentFolderId>');

  // Get current parents to remove
  const metaRes = await driveRequest(`/files/${fileId}?fields=parents`);
  if (!metaRes.ok) die(`Failed to get parents: ${await metaRes.text()}`);
  const meta = await metaRes.json();
  const removeParents = (meta.parents || []).join(',');

  const res = await driveRequest(
    `/files/${fileId}?addParents=${newParentId}&removeParents=${removeParents}&fields=id,name,parents`,
    { method: 'PATCH' },
  );

  if (!res.ok) die(`Move failed: ${await res.text()}`);
  out(await res.json());
}

// --- Main ---

const COMMANDS = {
  list: cmdList,
  ls: cmdList,
  search: cmdSearch,
  find: cmdSearch,
  read: cmdRead,
  cat: cmdRead,
  info: cmdInfo,
  upload: cmdUpload,
  mkdir: cmdMkdir,
  delete: cmdDelete,
  rm: cmdDelete,
  share: cmdShare,
  move: cmdMove,
  mv: cmdMove,
};

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help') {
  out(`Google Drive CLI

Usage: node gdrive.mjs <command> [args...]

Commands:
  list [folderId]                    List files in folder (default: root)
  search <query>                     Full-text search across Drive
  read <fileId>                      Read/download file content
  info <fileId>                      Show file metadata
  upload <localPath> [folderId]      Upload file to Drive
  mkdir <name> [parentFolderId]      Create folder
  delete <fileId>                    Move file to trash
  share <fileId> <email> [role]      Share file (role: reader|writer|commenter)
  move <fileId> <newParentId>        Move file to different folder

File IDs: Use the ID from list/search output, or a Drive URL.
Google Docs/Sheets/Slides are exported as text/CSV automatically.`);
  process.exit(0);
}

if (!COMMANDS[cmd]) die(`Unknown command: ${cmd}. Run 'gdrive help' for usage.`);

try {
  await COMMANDS[cmd](args);
} catch (err) {
  die(err.message);
}
