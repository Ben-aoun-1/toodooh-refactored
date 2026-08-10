/**
 * GREEN2 item 5 (ruled) — the owner venue picker renders whenever the owner holds MORE THAN ONE
 * venue, regardless of `fleet_owner` status: an individual owner CAN hold 2+ venues (QA-created,
 * or a hub push), and hiding the picker silently defaulted them to venues[0] (name-ascending) —
 * the INV-1-adjacent silent venue switch. ONE predicate for every owner surface.
 */
export const venuePickerVisible = (venueCount: number): boolean => venueCount > 1;
