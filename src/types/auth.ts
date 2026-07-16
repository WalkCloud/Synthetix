export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: UserRole;
}

export type TokenKind = "access" | "refresh";

export interface JWTPayload {
  userId: string;
  username: string;
  role: UserRole;
  kind: TokenKind;
}
