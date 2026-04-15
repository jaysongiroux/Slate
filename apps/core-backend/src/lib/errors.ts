type HttpError = Error & { statusCode: number; code?: string };

function createHttpError(statusCode: number, message: string, code?: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function unauthorized(msg = "Unauthorized", code?: string): HttpError {
  return createHttpError(401, msg, code);
}

export function badRequest(msg = "Bad Request", code?: string): HttpError {
  return createHttpError(400, msg, code);
}

export function forbidden(msg = "Forbidden", code?: string): HttpError {
  return createHttpError(403, msg, code);
}

export function notFound(msg = "Not Found", code?: string): HttpError {
  return createHttpError(404, msg, code);
}

export function conflict(msg = "Conflict", code?: string): HttpError {
  return createHttpError(409, msg, code);
}

export function preconditionFailed(msg = "Precondition Failed", code?: string): HttpError {
  return createHttpError(412, msg, code);
}
