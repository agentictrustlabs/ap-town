// The naming app's links, over the town's shared router.
export { Link, Router, useRoute } from '@ap-town/town-ui';
export const nameHref = (name: string): string => `/name/${encodeURIComponent(name).replace(/%40/g, '@')}`;
export const registerHref = (name: string): string => `/register/${encodeURIComponent(name)}`;
export const addressHref = (a: string): string => `/address/${a}`;
export const rootHref = (tld: string): string => `/root/${tld}`;
