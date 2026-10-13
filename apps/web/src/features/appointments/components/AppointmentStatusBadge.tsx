import { APPOINTMENT_STATUS_CLASS, APPOINTMENT_STATUS_FR } from '../lib/appointments';
import type { AppointmentStatus } from '../services/appointments.service';

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${APPOINTMENT_STATUS_CLASS[status]}`}
    >
      {APPOINTMENT_STATUS_FR[status]}
    </span>
  );
}
