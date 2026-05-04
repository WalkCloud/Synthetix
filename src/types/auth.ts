export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: string;
}

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
}
