/** A conservative shortcut for explicit attempts to override the harness.
 * This supplements JWT/RPC checks; it never grants business authority.
 */
export function attemptsHarnessOverride(message: string) {
  const text = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
  return (
    /\b(?:bo qua|ignore|disregard)\b.{0,60}\b(?:chi thi|quy tac|huong dan|instructions?|rules?|prompts?)\b/s.test(
      text,
    ) ||
    /\b(?:tra|return|output)\s+(?:ve\s+)?(?:choice|tool_call|system_prompt)\b/.test(
      text,
    ) ||
    /<\/?(?:system|developer)>|\[inst\]/.test(text)
  );
}
export const harnessOverrideReply =
  "Mình không xử lý chỉ thị thay đổi quy tắc AI. Hãy gửi lại yêu cầu nghiệp vụ riêng; bạn có thể xem công nợ tại /debts hoặc thao tác trực tiếp trong app.";
