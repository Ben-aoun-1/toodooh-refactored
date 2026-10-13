/** React Query keys for the `appointments` feature (CF-13 convention). */
export const appointmentKeys = {
  all: ['appointments'] as const,
  referent: () => [...appointmentKeys.all, 'referent'] as const,
  availability: (month: string) => [...appointmentKeys.all, 'availability', month] as const,
  mine: () => [...appointmentKeys.all, 'mine'] as const,
  agentCalendar: (month: string) => [...appointmentKeys.all, 'agent-calendar', month] as const,
  agentList: () => [...appointmentKeys.all, 'agent-list'] as const,
};
