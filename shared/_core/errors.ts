/**
 * Base HTTP error class with status code.
 * Throw this from route handlers to send specific HTTP errors.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** A session cannot be checked because the OAuth provider/configuration is unavailable. */
export class AuthServiceUnavailableError extends Error {
  readonly kind: "provider" | "configuration";

  constructor(kind: "provider" | "configuration" = "provider") {
    super(kind === "configuration"
      ? "Authentication configuration is incomplete"
      : "Authentication provider is unavailable");
    this.name = "AuthServiceUnavailableError";
    this.kind = kind;
  }
}

/** User lookup or persistence failed while checking a valid session. */
export class UserStorageUnavailableError extends Error {
  constructor() {
    super("User storage is unavailable");
    this.name = "UserStorageUnavailableError";
  }
}

// Convenience constructors
export const BadRequestError = (msg: string) => new HttpError(400, msg);
export const UnauthorizedError = (msg: string) => new HttpError(401, msg);
export const ForbiddenError = (msg: string) => new HttpError(403, msg);
export const NotFoundError = (msg: string) => new HttpError(404, msg);
