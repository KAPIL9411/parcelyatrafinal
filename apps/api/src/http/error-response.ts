import { ZodError } from 'zod';

import { AppError, errorEnvelope, type ErrorEnvelopeBody } from '../lib/errors.ts';

/**
 * The one error-to-response mapping.
 *
 * `app.ts` (Fastify, Node/Render) and the Workers HTTP layer both call this, so a validation
 * failure, a Zod issue, a throttled request and an unexpected crash produce the same status and the
 * same envelope on both hosts. The contract is `api/ERROR_CATALOG.md`.
 */
export interface ErrorResult {
  status: number;
  body: ErrorEnvelopeBody;
  /** Which log line the caller should write, or null when the error is a client mistake. */
  log: 'application' | 'unhandled' | null;
}

export function renderError(err: unknown, requestId: string): ErrorResult {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: errorEnvelope(err.code, err.message, requestId, err.details),
      log: err.status >= 500 ? 'application' : null,
    };
  }

  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return {
      status: 400,
      body: errorEnvelope('VALIDATION_FAILED', 'Please check the highlighted fields.', requestId, { fields }),
      log: null,
    };
  }

  if ((err as { validation?: unknown } | null)?.validation) {
    return {
      status: 400,
      body: errorEnvelope('VALIDATION_FAILED', 'Please check the highlighted fields.', requestId),
      log: null,
    };
  }

  const statusCode = (err as { statusCode?: number } | null)?.statusCode;
  if (statusCode === 429) {
    return {
      status: 429,
      body: errorEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', requestId),
      log: null,
    };
  }
  if (statusCode === 413) {
    return {
      status: 413,
      body: errorEnvelope('PAYLOAD_TOO_LARGE', 'That request is too large.', requestId),
      log: null,
    };
  }
  if (statusCode === 415) {
    return {
      status: 415,
      body: errorEnvelope('VALIDATION_FAILED', 'Send JSON.', requestId),
      log: null,
    };
  }
  if (statusCode && statusCode < 500) {
    return {
      status: statusCode,
      body: errorEnvelope('VALIDATION_FAILED', 'That request could not be processed.', requestId),
      log: null,
    };
  }

  return {
    status: 500,
    body: errorEnvelope('INTERNAL_ERROR', 'Something went wrong on our side.', requestId),
    log: 'unhandled',
  };
}

/** An error shaped like Fastify's body-parser failures, for the shared mapping above. */
export function httpError(statusCode: 400 | 413 | 415, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}
