import { refreshSession, setAuthCookies } from "@/lib/auth/session";
import { errorResponse, successResponse } from "@/lib/api-helpers";

export async function POST() {
  try {
    const result = await refreshSession();
    if (!result) {
      return errorResponse({ code: "unauthorized", message: "Invalid or expired refresh token" }, 401);
    }

    const { accessToken, refreshToken, user } = result;
    const response = successResponse(user);
    await setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
