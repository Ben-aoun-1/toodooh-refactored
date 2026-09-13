import { randomBytes } from 'node:crypto';

// SIM-0 — pure naming for sandbox databases. A sandbox is `<main>_sim_<8 hex>` on the SAME
// server as the main database, so `\l` shows ownership at a glance and the boot sweep can
// recognise orphans by prefix. Never user-supplied.

export const mainDatabaseName = (databaseUrl: string): string =>
  new URL(databaseUrl).pathname.replace(/^\//, '');

export const sandboxPrefix = (mainName: string): string => `${mainName}_sim_`;

export const sandboxDatabaseName = (
  mainName: string,
  random: () => string = () => randomBytes(4).toString('hex'),
): string => `${sandboxPrefix(mainName)}${random()}`;

const withPathname = (url: string, pathname: string): string => {
  const u = new URL(url);
  u.pathname = pathname;
  return u.toString();
};

export const sandboxUrl = (mainUrl: string, dbName: string): string =>
  withPathname(mainUrl, `/${dbName}`);

/** Same server, the maintenance DB — CREATE/DROP DATABASE cannot target the connected one. */
export const maintenanceUrl = (mainUrl: string): string => withPathname(mainUrl, '/postgres');

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
