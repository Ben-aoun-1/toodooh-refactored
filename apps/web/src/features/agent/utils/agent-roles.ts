/**
 * P2 — the two agent roles share one workspace (/agent). screenhost_agent refers screen owners;
 * screencast_agent refers advertisers/agencies. Routing (AgentRoute, AdvertiserRoute,
 * resolveHomeRoute) and the layout's role label both key off this module so the role matrix has
 * one source of truth.
 */
export const AGENT_ROLES = ['screenhost_agent', 'screencast_agent'] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export function isAgentRole(role: string | null | undefined): role is AgentRole {
  return role === 'screenhost_agent' || role === 'screencast_agent';
}

/** Sidebar/header label. Mirrors the admin account-creation labels (CreateAdmin). */
export function agentRoleLabel(role: string | null | undefined): string {
  if (role === 'screencast_agent') return 'Agent ScreenCast';
  return 'Agent ScreenHost';
}
