export const localAccounts = [
  { id: "an", email: "an@local.3t.test", name: "An", label: "An · Admin nhóm" },
  {
    id: "binh",
    email: "binh@local.3t.test",
    name: "Bình",
    label: "Bình · Thành viên",
  },
  {
    id: "chi",
    email: "chi@local.3t.test",
    name: "Chi",
    label: "Chi · Thành viên",
  },
  {
    id: "guest",
    email: "guest@local.3t.test",
    name: "Khách",
    label: "Khách · Chưa có nhóm",
  },
];

export function isLoopbackUrl(value, protocols = ["http:"]) {
  try {
    const url = new URL(value);
    return (
      protocols.includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function allowsLocalLogin({ nodeEnv, flag, apiUrl, appUrl, vercel }) {
  return (
    nodeEnv === "development" &&
    flag === "1" &&
    !vercel &&
    isLoopbackUrl(apiUrl) &&
    isLoopbackUrl(appUrl)
  );
}

export function allowsLocalRequest(host, origin, appUrl) {
  try {
    if (!isLoopbackUrl(appUrl)) return false;
    const configured = new URL(appUrl);
    const target = new URL(`http://${host}`);
    return (
      isLoopbackUrl(target.href) &&
      target.port === configured.port &&
      (!origin ||
        (isLoopbackUrl(origin) && new URL(origin).host === target.host))
    );
  } catch {
    return false;
  }
}
