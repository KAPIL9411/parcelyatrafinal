import { Buffer } from 'node:buffer';

import { Hono, type Context } from 'hono';
import type { FastifyBaseLogger } from 'fastify';

import { config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { AppError, errorEnvelope } from '../lib/errors.ts';
import { renderError, httpError } from './error-response.ts';
import { WindowLimiter, windowMs, type LimitRule, type LimitVerdict } from './rate-limit.ts';
import {
  applyCors,
  applyPreflight,
  applySecurityHeaders,
  isPreflight,
  type HeaderWriter,
} from './security.ts';
import { writeLimitApplies } from './write-limit.ts';

/**
 * A Fastify-shaped HTTP layer on top of Hono.
 *
 * Why this exists: Fastify cannot run on Cloudflare Workers. Its router (`find-my-way`) compiles a
 * matcher per route with `new Function`, and the Workers runtime forbids code generation from
 * strings. The route modules themselves, however, only use a small, regular slice of Fastify:
 *
 *   app.get/post/put/patch/delete, app.register({prefix}), app.addHook('preHandler'),
 *   app.addContentTypeParser, app.db, app.log,
 *   req.params/body/query/headers/log/id/ip/url/server/routeOptions,
 *   reply.code/status/header/type/getHeader/send
 *
 * This module implements exactly that slice over Hono's router (which builds regular expressions at
 * registration time and never evaluates strings), so `registerRoutes()` — the same function Fastify
 * uses — can run unchanged on both hosts. Anything outside the slice throws at boot instead of
 * silently behaving differently.
 *
 * What is deliberately reimplemented rather than reused: CORS, security headers, rate limiting and
 * body parsing, because those live in Fastify plugins. `test/hono-parity.test.ts` sends the same
 * requests through both hosts and compares status, selected headers and bodies.
 */

const DEFAULT_BODY_LIMIT = 1_048_576;

export type CompatHandler = (req: CompatRequest, reply: CompatReply) => unknown;

export interface CompatRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  log: FastifyBaseLogger;
  ip: string;
  auth?: unknown;
  server: unknown;
  routeOptions: { config: Record<string, unknown> };
  socket: { remoteAddress?: string };
  raw: Request;
}

interface RouteOptions {
  preHandler?: CompatHandler | CompatHandler[];
  bodyLimit?: number;
  config?: {
    rateLimit?: false | { max?: number; timeWindow?: string | number };
    [key: string]: unknown;
  };
}

interface ContentTypeParser {
  parseAs: 'string' | 'buffer';
  bodyLimit?: number;
  fn: (req: CompatRequest, body: string | Buffer, done: (err: Error | null, result?: unknown) => void) => void;
}

interface RouteDef {
  method: string;
  path: string;
  handler: CompatHandler;
  opts: RouteOptions;
  scope: CompatScope;
  /** Scope hooks (root → leaf) followed by the route's own `preHandler`. */
  hooks: CompatHandler[];
}

export class CompatReply implements HeaderWriter {
  statusCode = 200;
  payload: unknown;
  sent = false;
  private headers = new Map<string, string | string[]>();

  code(status: number): this {
    this.statusCode = status;
    return this;
  }

  status(status: number): this {
    return this.code(status);
  }

  header(name: string, value: string | string[] | number): this {
    this.headers.set(name.toLowerCase(), typeof value === 'number' ? String(value) : value);
    return this;
  }

  type(value: string): this {
    return this.header('content-type', value);
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers.get(name.toLowerCase());
  }

  removeHeader(name: string): this {
    this.headers.delete(name.toLowerCase());
    return this;
  }

  send(payload?: unknown): this {
    this.payload = payload;
    this.sent = true;
    return this;
  }

  toResponse(headOnly: boolean): Response {
    const headers = new Headers();
    for (const [name, value] of this.headers) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else headers.set(name, value);
    }

    const status = this.statusCode;
    const bodyAllowed = status !== 204 && status !== 205 && status !== 304;
    // Fastify serialises the payload for a HEAD request and then drops the body, so the response
    // still carries `content-type` and `content-length`. Do the same rather than omitting them.
    const serialized =
      bodyAllowed && this.payload !== undefined ? serialize(this.payload, headers) : null;

    if (headOnly && serialized !== null && !headers.has('content-length')) {
      headers.set(
        'content-length',
        String(typeof serialized === 'string' ? Buffer.byteLength(serialized) : serialized.byteLength),
      );
    }

    return new Response(headOnly ? null : serialized, { status, headers });
  }
}

function serialize(payload: unknown, headers: Headers): Uint8Array | string {
  if (payload instanceof Uint8Array) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    return payload;
  }
  if (typeof payload === 'string') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
    return payload;
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return JSON.stringify(payload);
}

function joinPath(prefix: string, path: string): string {
  if (!path) return prefix || '/';
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = path.startsWith('/') ? path : `/${path}`;
  return `${left}${right}` || '/';
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Path segments are not form-encoded: a literal `+` stays `+`. */
function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Node's `querystring.parse` semantics: duplicate keys become arrays, `+` is a space. */
function parseQuery(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!search || search === '?') return out;

  for (const part of search.slice(1).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeComponent(eq === -1 ? part : part.slice(0, eq));
    const value = decodeComponent(eq === -1 ? '' : part.slice(eq + 1));

    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

function headersToRecord(headers: Headers): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

const defaultJsonParser: ContentTypeParser = {
  parseAs: 'string',
  fn: (_req, body, done) => {
    const text = String(body);
    if (text === '') return done(httpError(400, 'Body cannot be empty'));
    try {
      done(null, JSON.parse(text));
    } catch {
      done(httpError(400, 'Invalid JSON'));
    }
  },
};

const defaultTextParser: ContentTypeParser = {
  parseAs: 'string',
  fn: (_req, body, done) => done(null, String(body)),
};

export class CompatScope {
  readonly prefix: string;
  readonly hooks: CompatHandler[] = [];
  readonly parsers = new Map<string, ContentTypeParser>();

  constructor(
    readonly app: CompatApp,
    readonly parent: CompatScope | null,
    prefix: string,
  ) {
    this.prefix = joinPath(parent?.prefix ?? '', prefix);
  }

  get db(): Db {
    return this.app.db;
  }

  get log(): FastifyBaseLogger {
    return this.app.log;
  }

  /** Fastify sets `req.server` to the encapsulated instance that registered the route. */
  get server(): CompatScope {
    return this;
  }

  chain(): CompatScope[] {
    const scopes: CompatScope[] = [];
    let current: CompatScope | null = this;
    while (current) {
      scopes.unshift(current);
      current = current.parent;
    }
    return scopes;
  }

  get(path: string, handler: CompatHandler): this;
  get(path: string, opts: RouteOptions, handler: CompatHandler): this;
  get(path: string, optsOrHandler: RouteOptions | CompatHandler, maybeHandler?: CompatHandler): this {
    return this.route('GET', path, optsOrHandler, maybeHandler);
  }

  post(path: string, handler: CompatHandler): this;
  post(path: string, opts: RouteOptions, handler: CompatHandler): this;
  post(path: string, optsOrHandler: RouteOptions | CompatHandler, maybeHandler?: CompatHandler): this {
    return this.route('POST', path, optsOrHandler, maybeHandler);
  }

  put(path: string, handler: CompatHandler): this;
  put(path: string, opts: RouteOptions, handler: CompatHandler): this;
  put(path: string, optsOrHandler: RouteOptions | CompatHandler, maybeHandler?: CompatHandler): this {
    return this.route('PUT', path, optsOrHandler, maybeHandler);
  }

  patch(path: string, handler: CompatHandler): this;
  patch(path: string, opts: RouteOptions, handler: CompatHandler): this;
  patch(path: string, optsOrHandler: RouteOptions | CompatHandler, maybeHandler?: CompatHandler): this {
    return this.route('PATCH', path, optsOrHandler, maybeHandler);
  }

  delete(path: string, handler: CompatHandler): this;
  delete(path: string, opts: RouteOptions, handler: CompatHandler): this;
  delete(path: string, optsOrHandler: RouteOptions | CompatHandler, maybeHandler?: CompatHandler): this {
    return this.route('DELETE', path, optsOrHandler, maybeHandler);
  }

  private route(
    method: string,
    path: string,
    optsOrHandler: RouteOptions | CompatHandler,
    maybeHandler?: CompatHandler,
  ): this {
    const opts: RouteOptions = typeof optsOrHandler === 'function' ? {} : (optsOrHandler ?? {});
    const handler = typeof optsOrHandler === 'function' ? optsOrHandler : maybeHandler;
    if (!handler) throw new TypeError(`compat: ${method} ${path} has no handler`);

    const scopeHooks = this.chain().flatMap((scope) => scope.hooks);
    const routeHooks = opts.preHandler
      ? Array.isArray(opts.preHandler)
        ? opts.preHandler
        : [opts.preHandler]
      : [];

    this.app.addRoute({
      method,
      path: joinPath(this.prefix, path),
      handler,
      opts,
      scope: this,
      hooks: [...scopeHooks, ...routeHooks],
    });
    return this;
  }

  /**
   * Fastify plugins are either `async (instance, opts)` or `(instance, opts, done)`. Route modules
   * use the first form; the second is supported so a callback-style plugin does not silently do
   * nothing.
   */
  async register(plugin: unknown, opts: { prefix?: string } & Record<string, unknown> = {}): Promise<this> {
    if (typeof plugin !== 'function') {
      throw new TypeError('compat: only function plugins are supported on the Workers HTTP layer');
    }
    if (this.app.isReady) {
      throw new Error('compat: register() after ready() is not supported');
    }

    const scope = new CompatScope(this.app, this, opts.prefix ?? '');
    const fn = plugin as (instance: CompatScope, options: unknown, done?: (err?: Error) => void) => unknown;

    if (fn.length >= 3) {
      await new Promise<void>((resolve, reject) => {
        fn(scope, opts, (err?: Error) => (err ? reject(err) : resolve()));
      });
    } else {
      await fn(scope, opts);
    }
    return this;
  }

  addHook(name: string, handler: CompatHandler): this {
    // Hooks are part of the security surface: a hook that is silently skipped would, for example,
    // register admin routes without authentication. Refuse at boot instead.
    if (name !== 'preHandler') {
      throw new Error(
        `compat: the Workers HTTP layer supports only the 'preHandler' hook (got '${name}')`,
      );
    }
    this.hooks.push(handler);
    return this;
  }

  addContentTypeParser(
    types: string | string[],
    opts: { parseAs?: 'string' | 'buffer'; bodyLimit?: number },
    fn: ContentTypeParser['fn'],
  ): this {
    const parser: ContentTypeParser = {
      parseAs: opts.parseAs ?? 'string',
      bodyLimit: opts.bodyLimit,
      fn,
    };
    for (const type of Array.isArray(types) ? types : [types]) {
      this.parsers.set(type.toLowerCase(), parser);
    }
    return this;
  }

  decorate(name: string, value: unknown): this {
    if (name in this) throw new Error(`compat: '${name}' is already decorated`);
    (this as unknown as Record<string, unknown>)[name] = value;
    return this;
  }

  async ready(): Promise<void> {
    await this.app.ready();
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}

export interface CompatAppOptions {
  db: Db;
  log: FastifyBaseLogger;
  origins?: readonly string[];
  production?: boolean;
}

export class CompatApp {
  readonly db: Db;
  readonly log: FastifyBaseLogger;
  readonly origins: readonly string[];
  readonly production: boolean;
  readonly root: CompatScope;
  readonly limiter = new WindowLimiter();

  private routes: RouteDef[] = [];
  private hono: Hono | null = null;

  constructor(options: CompatAppOptions) {
    this.db = options.db;
    this.log = options.log;
    this.origins = options.origins ?? [];
    this.production = options.production ?? config.NODE_ENV === 'production';
    this.root = new CompatScope(this, null, '');

    this.root.parsers.set('application/json', defaultJsonParser);
    this.root.parsers.set('text/plain', defaultTextParser);

    // Mirrors the write budget in `app.ts`: a stricter per-IP limit layered on top of the read
    // limit, skipping health checks (polled by the platform) and webhooks (signed by the provider).
    if (config.RATE_LIMIT_ENABLED) {
      this.root.addHook('preHandler', async (req, reply) => {
        if (!writeLimitApplies(req)) return;

        const verdict = this.limiter.hit(`w:${req.ip}`, {
          max: config.RATE_LIMIT_WRITE_PER_MINUTE,
          windowMs: 60_000,
        });
        if (verdict.allowed) return;

        reply.header('retry-after', String(verdict.resetSeconds));
        reply.header('x-ratelimit-limit', String(verdict.limit));
        reply.header('x-ratelimit-remaining', '0');
        reply.header('x-ratelimit-reset', String(verdict.resetSeconds));
        reply
          .code(429)
          .send(errorEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', req.id));
      });
    }
  }

  get isReady(): boolean {
    return this.hono !== null;
  }

  addRoute(route: RouteDef): void {
    if (this.isReady) throw new Error('compat: route registered after ready()');
    this.routes.push(route);
  }

  async ready(): Promise<void> {
    if (this.hono) return;

    const hono = new Hono();
    for (const route of this.routes) {
      hono.on(route.method, route.path, (c: Context) => this.handle(c, route));
    }
    hono.all('*', (c: Context) => this.handleNotFound(c));
    this.hono = hono;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready();
    return this.hono!.fetch(request);
  }

  private handleNotFound(c: Context): Response {
    const requestId = crypto.randomUUID();
    const reply = new CompatReply();
    applySecurityHeaders(reply, this.production);
    applyCors(c.req.raw, reply, this.origins);

    // A CORS preflight targets a path that only has a GET/POST route, so the router never matches
    // it. Answering here is what `@fastify/cors` does with its own `OPTIONS` hook.
    if (isPreflight(c.req.raw)) {
      applyPreflight(c.req.raw, reply, this.origins);
      reply.code(204).send();
      return reply.toResponse(false);
    }

    reply.code(404).send(errorEnvelope('NOT_FOUND', 'We could not find that.', requestId));
    return reply.toResponse(c.req.method === 'HEAD');
  }

  private async handle(c: Context, route: RouteDef): Promise<Response> {
    const request = c.req.raw;
    const requestId = crypto.randomUUID();
    const log = this.log.child({ reqId: requestId });
    const reply = new CompatReply();

    applySecurityHeaders(reply, this.production);
    applyCors(request, reply, this.origins);

    if (isPreflight(request)) {
      applyPreflight(request, reply, this.origins);
      reply.code(204).send();
      return reply.toResponse(false);
    }

    const req = this.buildRequest(c, route, requestId, log);

    try {
      const verdict = this.checkRateLimit(req, route, reply);
      if (verdict && !verdict.allowed) {
        reply.header('retry-after', String(verdict.resetSeconds));
        reply.code(429).send(errorEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', requestId));
        return reply.toResponse(request.method === 'HEAD');
      }

      // Fastify parses the body before preHandler hooks run, so a malformed body answers 400 even
      // when the caller is also unauthenticated.
      await this.parseBody(req, route);

      for (const hook of route.hooks) {
        await hook(req, reply);
        // `reply.send()` in a preHandler is what stops Fastify from running the handler. Returning
        // a value from the hook does not, and treating it as if it did once let a rate-limited write
        // still execute.
        if (reply.sent) return reply.toResponse(request.method === 'HEAD');
      }

      const result = await route.handler(req, reply);
      if (!reply.sent && result !== undefined) reply.send(result);
      return reply.toResponse(request.method === 'HEAD');
    } catch (err) {
      const rendered = renderError(err, requestId);
      if (rendered.log === 'application') {
        log.error({ err, code: (err as AppError).code }, 'application error');
      } else if (rendered.log === 'unhandled') {
        log.error({ err }, 'unhandled error');
      }
      reply.code(rendered.status).send(rendered.body);
      return reply.toResponse(false);
    }
  }

  private buildRequest(
    c: Context,
    route: RouteDef,
    requestId: string,
    log: FastifyBaseLogger,
  ): CompatRequest {
    const request = c.req.raw;
    const url = new URL(request.url);
    const ip =
      request.headers.get('cf-connecting-ip') ??
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      '127.0.0.1';

    const params: Record<string, string> = { ...c.req.param() };
    if (route.path.endsWith('/*')) {
      // Hono does not expose a trailing wildcard through `param()`. find-my-way decodes params, so
      // decode the remainder here too; the route (`files.ts`) then decodes it again, exactly as it
      // does on Fastify.
      const prefix = route.path.slice(0, -1);
      const path = c.req.path;
      params['*'] = decodePathParam(path.startsWith(prefix) ? path.slice(prefix.length) : '');
    }

    return {
      id: requestId,
      method: request.method.toUpperCase(),
      url: `${url.pathname}${url.search}`,
      headers: headersToRecord(request.headers),
      params,
      query: parseQuery(url.search),
      body: undefined,
      log,
      ip,
      server: route.scope,
      routeOptions: { config: (route.opts.config ?? {}) as Record<string, unknown> },
      socket: { remoteAddress: ip },
      raw: request,
    };
  }

  private checkRateLimit(
    req: CompatRequest,
    route: RouteDef,
    reply: CompatReply,
  ): LimitVerdict | null {
    const routeLimit = route.opts.config?.rateLimit;
    if (routeLimit === false) return null;

    let rule: LimitRule | null = null;
    if (routeLimit && typeof routeLimit === 'object') {
      rule = {
        max: routeLimit.max ?? config.RATE_LIMIT_READ_PER_MINUTE,
        windowMs: windowMs(routeLimit.timeWindow, 60_000),
      };
    } else if (config.RATE_LIMIT_ENABLED) {
      rule = { max: config.RATE_LIMIT_READ_PER_MINUTE, windowMs: 60_000 };
    }
    if (!rule) return null;

    // @fastify/rate-limit keeps one bucket per route, keyed by the client. Include the method and
    // path so a route limit on `/auth/refresh` cannot drain the budget of an unrelated route.
    const verdict = this.limiter.hit(`r:${route.method}:${route.path}:${req.ip}`, rule);
    reply.header('x-ratelimit-limit', String(verdict.limit));
    reply.header('x-ratelimit-remaining', String(verdict.remaining));
    reply.header('x-ratelimit-reset', String(verdict.resetSeconds));
    return verdict;
  }

  private async parseBody(req: CompatRequest, route: RouteDef): Promise<void> {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;

    const raw = req.raw;
    const contentType = raw.headers.get('content-type');
    const declaredLength = raw.headers.get('content-length');

    // No declared type and no declared body: nothing to parse. Clients only set content-type when
    // they send a body.
    if (!contentType) {
      if (declaredLength !== null || raw.headers.has('transfer-encoding')) {
        throw httpError(415, 'a request body needs a content-type');
      }
      return;
    }

    const mediaType = contentType.split(';')[0]!.trim().toLowerCase();
    const parser = this.findParser(route.scope, mediaType);
    if (!parser) throw httpError(415, `unsupported content-type ${mediaType}`);

    const limit = route.opts.bodyLimit ?? parser.bodyLimit ?? DEFAULT_BODY_LIMIT;
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (Number.isFinite(declared) && declared > limit) throw httpError(413, 'body too large');
    }

    const bytes = await raw.arrayBuffer();
    if (bytes.byteLength > limit) throw httpError(413, 'body too large');

    const payload = parser.parseAs === 'buffer' ? Buffer.from(bytes) : new TextDecoder().decode(bytes);
    req.body = await new Promise<unknown>((resolve, reject) => {
      parser.fn(req, payload, (err, result) => {
        if (!err) return resolve(result);
        // Do not invent a status here. Fastify reports a custom parser's bare `Error` (the webhook
        // parser's `JSON.parse` failure) as a 500, and the shared `renderError` must see it that
        // way; the parsers that *do* mean 400 (the default JSON parser) set `statusCode` themselves.
        reject(err);
      });
    });
  }

  private findParser(scope: CompatScope, mediaType: string): ContentTypeParser | null {
    const [type] = mediaType.split('/');
    // Nearest scope wins: a plugin that overrides `application/json` (webhooks.ts) only affects its
    // own routes, exactly as Fastify's encapsulation does.
    for (const current of scope.chain().reverse()) {
      const exact = current.parsers.get(mediaType);
      if (exact) return exact;
      const wildcard = current.parsers.get(`${type}/*`);
      if (wildcard) return wildcard;
      const any = current.parsers.get('*/*');
      if (any) return any;
    }
    return null;
  }
}

export function createCompatApp(options: CompatAppOptions): CompatScope {
  return new CompatApp(options).root;
}
