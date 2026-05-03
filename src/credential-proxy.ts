/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, IncomingMessage, Server } from 'http';
import { request as httpRequest, RequestOptions } from 'http';
import { request as httpsRequest } from 'https';

import { readEnvFile } from './env.js';
import { log } from './log.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(port: number, host = '127.0.0.1'): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken = secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> = {
          ...(req.headers as Record<string, string>),
          host: upstreamUrl.host,
          'content-length': body.length,
        };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const requestPath = req.url || '/';
        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: requestPath,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            // Buffer the full response so we can extract usage data
            const responseChunks: Buffer[] = [];
            upRes.on('data', (c) => responseChunks.push(c));
            upRes.on('end', () => {
              const responseBody = Buffer.concat(responseChunks);
              res.writeHead(upRes.statusCode!, upRes.headers);
              res.end(responseBody);
              extractAndLogUsage(responseBody.toString(), upRes, requestPath);
            });
          },
        );

        upstream.on('error', (err) => {
          log.error('Credential proxy upstream error', { err, url: req.url });
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      log.info('Credential proxy started', { port, host, authMode });
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}

/** Extract token usage from a proxy response and log it to the DB. */
function extractAndLogUsage(body: string, upRes: IncomingMessage, requestPath: string): void {
  const statusCode = upRes.statusCode || 0;
  if (statusCode < 200 || statusCode >= 300) return;

  const contentType = (upRes.headers['content-type'] as string) || '';
  let model: string | null = null;
  let inputTokens = 0,
    outputTokens = 0,
    cacheWriteTokens = 0,
    cacheReadTokens = 0;

  if (contentType.includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'message_start' && event.message) {
          model = event.message.model || null;
          if (event.message.usage) {
            inputTokens += event.message.usage.input_tokens || 0;
            cacheWriteTokens += event.message.usage.cache_creation_input_tokens || 0;
            cacheReadTokens += event.message.usage.cache_read_input_tokens || 0;
          }
        }
        if (event.type === 'message_delta' && event.usage) {
          outputTokens += event.usage.output_tokens || 0;
        }
      } catch {
        /* skip malformed events */
      }
    }
  } else {
    try {
      const json = JSON.parse(body);
      model = json.model || null;
      if (json.usage) {
        inputTokens = json.usage.input_tokens || 0;
        outputTokens = json.usage.output_tokens || 0;
        cacheWriteTokens = json.usage.cache_creation_input_tokens || 0;
        cacheReadTokens = json.usage.cache_read_input_tokens || 0;
      }
    } catch {
      return;
    }
  }

  if (inputTokens + outputTokens === 0) return;

  // Lazy import to avoid circular dep at startup
  import('./db/api-usage.js')
    .then(({ logApiUsage, estimateCost }) => {
      logApiUsage({
        timestamp: new Date().toISOString(),
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cache_read_input_tokens: cacheReadTokens,
        estimated_cost_usd: estimateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
        request_path: requestPath,
        status_code: statusCode,
      });
    })
    .catch(() => {
      /* ignore logging errors */
    });
}
