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
 *
 * Usage tracking:
 *   Buffers API responses to extract token usage data from the response body.
 *   Supports both non-streaming (JSON) and streaming (SSE) responses.
 *   Logs usage to SQLite for cost tracking and reporting.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { estimateCost, logApiUsage } from './db.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

/**
 * Extract usage data from an API response and log it.
 * Handles both non-streaming (JSON) and streaming (SSE) responses.
 */
function extractAndLogUsage(
  body: string,
  upRes: IncomingMessage,
  requestPath: string,
): void {
  const statusCode = upRes.statusCode || 0;
  // Only track successful responses
  if (statusCode < 200 || statusCode >= 300) return;

  const contentType = upRes.headers['content-type'] || '';
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  if (contentType.includes('text/event-stream')) {
    // SSE streaming response — parse events for usage data
    // Usage comes in message_delta and message_start events
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
            cacheWriteTokens +=
              event.message.usage.cache_creation_input_tokens || 0;
            cacheReadTokens +=
              event.message.usage.cache_read_input_tokens || 0;
          }
        }
        if (event.type === 'message_delta' && event.usage) {
          outputTokens += event.usage.output_tokens || 0;
        }
      } catch {
        // Skip unparseable events
      }
    }
  } else {
    // Non-streaming JSON response
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
      return; // Not valid JSON, skip
    }
  }

  // Only log if we got token data
  if (inputTokens + outputTokens === 0) return;

  const cost = estimateCost(
    model,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
  );

  logApiUsage({
    timestamp: new Date().toISOString(),
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheWriteTokens,
    cache_read_input_tokens: cacheReadTokens,
    estimated_cost_usd: cost,
    request_path: requestPath,
    status_code: statusCode,
  });
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
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

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);

            // Track usage for messages API responses
            const isMessagesApi =
              req.url?.includes('/v1/messages') &&
              req.method === 'POST';
            if (isMessagesApi) {
              const responseChunks: Buffer[] = [];
              upRes.on('data', (chunk: Buffer) => {
                responseChunks.push(chunk);
                res.write(chunk);
              });
              upRes.on('end', () => {
                res.end();
                try {
                  extractAndLogUsage(
                    Buffer.concat(responseChunks).toString('utf-8'),
                    upRes,
                    req.url || '',
                  );
                } catch {
                  // Never let usage tracking break the proxy
                }
              });
            } else {
              upRes.pipe(res);
            }
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
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
      logger.info({ port, host, authMode }, 'Credential proxy started');
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
