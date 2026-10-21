/** Application-level error with an HTTP status and a stable machine code. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);

export const tooManyRequests = (message: string) =>
  new AppError(429, 'rate_limited', message);

export const serviceUnavailable = (message: string) =>
  new AppError(503, 'service_unavailable', message);
