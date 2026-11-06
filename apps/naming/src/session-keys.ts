// The browser storage a Home's sign-out touches, named once: the app reads these and the Worker's /sso-logout page clears them.
export const SESSION_KEY = 'names.session';
export const PENDING_KEY = 'names.connect.pending';
/** In localStorage, so every tab sees it: when a Home last signed this browser out. */
export const SIGNED_OUT_KEY = 'names.signed-out';
