const messages = {
  used_link:
    "Link đăng nhập đã được dùng. Hãy bấm Tiếp tục với Google hoặc yêu cầu một link email mới.",
  expired_link:
    "Link đăng nhập đã hết hạn hoặc không còn hiệu lực. Hãy đăng nhập lại từ trang này.",
  wrong_browser:
    "Chưa hoàn tất được đăng nhập. Hãy bắt đầu lại và mở link trong cùng trình duyệt, cùng địa chỉ website.",
  cancelled:
    "Bạn chưa cho phép đăng nhập bằng Google. Có thể thử lại hoặc dùng link qua email.",
  sign_in_failed:
    "Chưa đăng nhập được. Hãy thử lại bằng Google hoặc yêu cầu link email mới.",
};

export function authErrorReason(code: unknown): keyof typeof messages {
  switch (code) {
    case "flow_state_already_used":
      return "used_link";
    case "flow_state_expired":
    case "flow_state_not_found":
    case "otp_expired":
      return "expired_link";
    case "bad_code_verifier":
    case "pkce_verifier_not_found":
      return "wrong_browser";
    case "access_denied":
      return "cancelled";
    default:
      return "sign_in_failed";
  }
}

export function authErrorMessage(reason: unknown): string {
  return typeof reason === "string" && Object.hasOwn(messages, reason)
    ? messages[reason as keyof typeof messages]
    : messages.sign_in_failed;
}
