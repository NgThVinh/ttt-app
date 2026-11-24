export type Rsvp = "going" | "not_going" | "pending";
export type SessionOverview = {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  ends_at?: string | null;
  status: string;
  revision?: string;
  group_name?: string;
  going?: number;
  pending?: number;
  my_rsvp?: Rsvp;
};

export const sessionDay = (instant: string) =>
  new Date(Date.parse(instant) + 7 * 3600000).toISOString().slice(0, 10);
export const sessionTime = (instant: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(instant));
export const sessionDate = (instant: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(instant));
export const sessionStatus: Record<string, string> = {
  planned: "Sắp tới",
  played: "Đang thu tiền",
  settled: "Đã thu đủ",
  cancelled: "Đã hủy",
};
