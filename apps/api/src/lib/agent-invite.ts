/**
 * SET-PW1 — the pending-invite handoff between admin account creation and better-auth's
 * `sendResetPassword` hook.
 *
 * An invited agent must receive ONE email that carries a REAL reset token. better-auth mints
 * that token inside `requestPasswordReset` and only ever exposes it through the
 * `sendResetPassword` hook, so the admin route parks the welcome payload here, calls
 * `requestPasswordReset`, and the hook picks the payload back up and renders the agent-welcome
 * template instead of the generic reset one. Minting the verification row by hand was the
 * alternative and was rejected: `internalAdapter` is not in better-auth's public types, so it
 * would need an `any` (banned), and it would duplicate a library internal we already only READ.
 *
 * Park and take always happen in the SAME process — `requestPasswordReset` invokes the hook
 * in-process — so this never needs to survive a restart or cross a worker boundary. Entries are
 * single-consumption and short-lived: if the send never happens the entry simply expires, and a
 * later ordinary password reset for the same address can never render the welcome template.
 */

export interface AgentInvite {
  agentCode: string;
  tempPassword: string;
  name: string;
}

/** An invite is consumed within one request; a minute is generous and bounds a leak. */
export const AGENT_INVITE_TTL_MS = 60_000;

const pending = new Map<string, { invite: AgentInvite; expiresAt: number }>();

const key = (email: string): string => email.trim().toLowerCase();

/** Park the welcome payload for `email`, to be rendered by the next reset email for it. */
export const parkAgentInvite = (
  email: string,
  invite: AgentInvite,
  now: number = Date.now(),
): void => {
  pending.set(key(email), { invite, expiresAt: now + AGENT_INVITE_TTL_MS });
};

/**
 * Take the parked invite for `email`, or null when there is none / it has expired. Consuming
 * removes it, so exactly one email can ever be rendered as a welcome.
 */
export const takeAgentInvite = (email: string, now: number = Date.now()): AgentInvite | null => {
  const k = key(email);
  const entry = pending.get(k);
  if (!entry) return null;
  pending.delete(k);
  return entry.expiresAt > now ? entry.invite : null;
};

/** Test seam — drops every parked invite. */
export const clearAgentInvites = (): void => {
  pending.clear();
};
