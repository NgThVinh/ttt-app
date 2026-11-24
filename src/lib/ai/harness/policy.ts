export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";
export type PolicyFacts = {
  collector: boolean;
  hasPayments: boolean;
  affectsOthers: boolean;
  selfOnly: boolean;
};
const reads = new Set([
  "get_my_debts",
  "get_who_owes_me",
  "get_session_breakdown",
  "list_sessions",
  "get_group_summary",
  "get_poll_results",
  "get_upcoming",
]);
const selfWrites = new Set([
  "draft_rsvp",
  "draft_vote",
  "draft_mark_paid",
  "draft_note",
]);
const sharedWrites = new Set([
  "draft_session",
  "draft_planned_session",
  "draft_poll",
  "draft_close_poll_and_schedule",
  "draft_claim_collector",
  "draft_reminder",
  "draft_alias",
]);
const requests = new Set([
  "request_confirm_received",
  "request_expense_proposal",
  "request_leave_session",
  "request_join_session",
  "request_weight",
  "request_change_collector",
  "request_edit_settled_session",
  "request_remove_attendee",
  "request_invite_link",
  "request_bulk_reminder",
]);
/** Fail closed. Models cannot supply a tier or grant authority through parameters. */
export function classifyTool(name: string, facts: PolicyFacts): Tier {
  if (reads.has(name)) return "T0";
  if (selfWrites.has(name)) return facts.selfOnly ? "T1" : "T4";
  if (requests.has(name)) return "T3";
  if (name === "draft_expense")
    return !facts.collector ? "T4" : facts.hasPayments ? "T3" : "T2";
  if (name === "draft_edit_attendance")
    return facts.collector && !facts.hasPayments ? "T2" : "T3";
  if (sharedWrites.has(name)) return "T2";
  return "T4";
}
export function confirmationRoute(tier: Tier) {
  return tier === "T0"
    ? "read"
    : tier === "T4"
      ? "app-link"
      : tier === "T3"
        ? "app-approval"
        : "draft-confirmation";
}
