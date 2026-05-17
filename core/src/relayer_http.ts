import http from 'node:http';

import type { Logger } from 'pino';

import { appendActivity, readRecentActivity } from './activity_log.js';
import type { LocalIntentRecord, MatchingRelayer } from './matching_relayer.js';
import { assetIdFromSymbol, hexToBytes32 } from './obsidian_bytes.js';

type IntentBody = {
  commitmentHex: string;
  assetIdHex?: string;
  assetSymbol?: string;
  side: 'BUY' | 'SELL';
  maxPrice?: string;
  minPrice?: string;
};

function parseIntentBody(body: unknown): IntentBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('JSON body required');
  }
  const o = body as Record<string, unknown>;
  if (typeof o.commitmentHex !== 'string' || typeof o.side !== 'string') {
    throw new Error('commitmentHex and side required');
  }
  if (o.side !== 'BUY' && o.side !== 'SELL') {
    throw new Error('side must be BUY or SELL');
  }
  return body as IntentBody;
}

function bodyToRecord(body: IntentBody): { commitment: Uint8Array; record: LocalIntentRecord } {
  const commitment = hexToBytes32(body.commitmentHex);
  const assetId = body.assetIdHex
    ? hexToBytes32(body.assetIdHex)
    : assetIdFromSymbol(body.assetSymbol ?? 'wETH');

  const record: LocalIntentRecord = { assetId, side: body.side };
  if (body.side === 'BUY') {
    if (!body.maxPrice) {
      throw new Error('maxPrice required for BUY');
    }
    record.maxPrice = BigInt(body.maxPrice);
  } else {
    if (!body.minPrice) {
      throw new Error('minPrice required for SELL');
    }
    record.minPrice = BigInt(body.minPrice);
  }
  return { commitment, record };
}

export function startRelayerHttpServer(
  relayer: MatchingRelayer,
  logger: Logger,
  port: number,
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/activity') {
      const limit = Number(url.searchParams.get('limit') ?? '200');
      const events = readRecentActivity(Number.isFinite(limit) ? limit : 200);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logPath: process.env['OBSIDIAN_ACTIVITY_LOG'], events }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/activity') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          const source = parsed.source === 'ui' || parsed.source === 'relayer' || parsed.source === 'cli'
            ? parsed.source
            : 'ui';
          const type = typeof parsed.type === 'string' ? parsed.type : '';
          if (!type) {
            throw new Error('type required');
          }
          const { source: _s, type: _t, ...rest } = parsed;
          appendActivity({ source, type, ...rest });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/intent') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const parsed = parseIntentBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          const { commitment, record } = bodyToRecord(parsed);
          relayer.registerLocalIntent(commitment, record);
          appendActivity({
            source: 'ui',
            type: 'intent.registered',
            commitmentHex: parsed.commitmentHex,
            side: parsed.side,
            maxPrice: parsed.maxPrice,
            minPrice: parsed.minPrice,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(
      { port, endpoints: ['GET /health', 'GET /activity', 'POST /activity', 'POST /intent'] },
      'Relayer HTTP API (shared intent pool + activity log for multi-browser dev)',
    );
  });

  return server;
}
