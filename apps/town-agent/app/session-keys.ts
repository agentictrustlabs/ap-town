// The browser storage a Home's sign-out touches, named once: the app reads these and the Worker's /sso-logout page clears them.
export const SESSION_KEY = 'ap-town.home-session';
/** The leg in flight: which Home, and the PKCE verifier only this tab knows. Dropped the moment it lands. */
export const PENDING_KEY = 'ap-town.connecting';
/** In localStorage, so every tab sees it: when a Home last signed this browser out. */
export const SIGNED_OUT_KEY = 'ap-town.signed-out';
