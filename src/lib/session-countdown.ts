export function sessionCountdown(
  start: string,
  end: string | null | undefined,
  status: string,
  now: number,
) {
  if (status === "cancelled") return "Buổi đã hủy";
  const delta = Date.parse(start) - now;
  if (delta <= 0)
    return end && Date.parse(end) <= now
      ? "Đã kết thúc"
      : end
        ? "Đang diễn ra"
        : "Đã bắt đầu";
  const minutes = Math.ceil(delta / 60000),
    days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    mins = minutes % 60;
  return days
    ? `Còn ${days} ngày${hours ? ` ${hours} giờ` : ""}`
    : hours
      ? `Còn ${hours} giờ${mins ? ` ${mins} phút` : ""}`
      : `Còn ${mins} phút`;
}
