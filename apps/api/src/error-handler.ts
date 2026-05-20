import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import type { Env } from './env.js';

interface ErrorResponseBody {
  error: string;
  message: string;
  statusCode: number;
  requestId: string;
}

export const buildErrorHandler = (env: Env) => {
  return (err: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    const statusCode = err.statusCode ?? 500;
    const requestId = request.id;

    request.log.error(
      { err, method: request.method, url: request.url, requestId },
      'request failed',
    );

    void reply.header('x-request-id', requestId);

    const isServerError = statusCode >= 500;
    const isProduction = env.NODE_ENV === 'production';

    const body: ErrorResponseBody = {
      error: err.name || (isServerError ? 'Internal Server Error' : 'Bad Request'),
      message: isServerError && isProduction ? 'Internal Server Error' : err.message,
      statusCode,
      requestId,
    };

    void reply.status(statusCode).send(body);
  };
};

export const buildNotFoundHandler = () => {
  return (request: FastifyRequest, reply: FastifyReply): void => {
    const requestId = request.id;
    void reply.header('x-request-id', requestId);
    const body: ErrorResponseBody = {
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
      statusCode: 404,
      requestId,
    };
    void reply.status(404).send(body);
  };
};
