export async function logout() {
  try {
    await fetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
}
