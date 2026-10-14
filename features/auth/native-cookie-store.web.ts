// Browsers own their cookie jar; web sign-out revokes the cookie session on the server.
export async function clearNativeCookies(): Promise<void> {}
