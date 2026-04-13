type HttpError = Error & { statusCode: number };

function createHttpError(statusCode: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

export function unauthorized(msg = "Unauthorized"): HttpError {
  return createHttpError(401, msg);
}

export function badRequest(msg = "Bad Request"): HttpError {
  return createHttpError(400, msg);
}

export function forbidden(msg = "Forbidden"): HttpError {
  return createHttpError(403, msg);
}

export function notFound(msg = "Not Found"): HttpError {
  return createHttpError(404, msg);
}

export function conflict(msg = "Conflict"): HttpError {
  return createHttpError(409, msg);
}

export function preconditionFailed(msg = "Precondition Failed"): HttpError {
  return createHttpError(412, msg);
}
