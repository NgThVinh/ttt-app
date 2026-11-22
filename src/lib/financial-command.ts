import { z } from "zod";
import type { supabase } from "./supabase";
export type FinancialCommand =
  | "create_session"
  | "add_expense"
  | "apply_financial_change"
  | "finish_session"
  | "claim_collector"
  | "payment_action"
  | "decide_session_request";
export async function runFinancialCommand(
  db: Awaited<ReturnType<typeof supabase>>,
  requestKey: unknown,
  command: FinancialCommand,
  body: Record<string, unknown>,
) {
  const key = z.uuid().safeParse(requestKey);
  if (!key.success)
    return { data: null, error: { message: "Mã yêu cầu không hợp lệ." } };
  return db.rpc("execute_financial_command", {
    command_name: command,
    request_key: key.data,
    body,
  });
}
