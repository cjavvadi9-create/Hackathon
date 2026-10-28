import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { TRPCError } from "@trpc/server";
import type { Request } from "express";
import {
  AuthServiceUnavailableError,
  HttpError,
  UserStorageUnavailableError,
} from "../../shared/_core/errors.js";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

type RequestAuthenticator = (req: Request) => Promise<User | null>;

export function createContextFactory(authenticate: RequestAuthenticator) {
  return async (opts: CreateExpressContextOptions): Promise<TrpcContext> => {
    let user: User | null = null;

    try {
      user = await authenticate(opts.req);
    } catch (error) {
      // An absent/invalid session is expected for public tRPC procedures.
      if (error instanceof HttpError && (error.statusCode === 401 || error.statusCode === 403)) {
        user = null;
      } else if (error instanceof AuthServiceUnavailableError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.kind === "configuration"
            ? "Authentication is not configured. Check MANUS_PROJECT_ID, MANUS_OAUTH_API_URL, and MANUS_JWT_SECRET."
            : "The authentication service is unavailable. Try signing in again later.",
        });
      } else if (error instanceof UserStorageUnavailableError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "User storage is unavailable. Check the server database connection.",
        });
      } else {
        // Do not include unexpected error details or credentials in responses.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to verify this session. Try signing in again.",
        });
      }
    }

    return {
      req: opts.req,
      res: opts.res,
      user,
    };
  };
}

export const createContext = createContextFactory(req => sdk.authenticateRequest(req));
