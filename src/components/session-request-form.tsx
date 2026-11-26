"use client";
import Link from "@/components/app-link";
import { useState } from "react";
import ActionForm from "./action-form";
import { requestChange } from "@/app/approvals/actions";
import type { SessionDetail } from "@/lib/session-data";
export default function SessionRequestForm({
  session: s,
  members,
  canNominate,
}: {
  session: SessionDetail;
  members: { id: string; display_name: string; user_id: string | null }[];
  canNominate: boolean;
}) {
  const mine = s.attendees.find(
    (m) =>
      m.member_id === s.my_member_id && m.rsvp === "going" && !m.removed_at,
  );
  const options = [
    ...(mine ? [{ value: "weight", label: "Đề nghị hệ số" }] : []),
    ...(canNominate
      ? [{ value: "collector_nomination", label: "Đề cử người tính tiền" }]
      : []),
  ];
  const [kind, setKind] = useState(options[0]?.value || "weight");
  if (!options.length) return null;
  return (
    <section className="panel">
      <h2>Gửi yêu cầu trong buổi</h2>
      <p>
        <Link href="/approvals">Xem yêu cầu của tôi</Link>
      </p>
      <label htmlFor="request-kind">Loại yêu cầu</label>
      <select
        id="request-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        {options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ActionForm action={requestChange} label="Gửi yêu cầu">
        <input type="hidden" name="sid" value={s.id} />
        <input type="hidden" name="kind" value={kind} />
        {kind === "weight" && (
          <>
            <label htmlFor="request-weight">Hệ số mong muốn</label>
            <input
              id="request-weight"
              name="weight"
              required
              defaultValue="0.5"
            />
          </>
        )}
        {kind === "collector_nomination" && (
          <>
            <label htmlFor="request-member">Người được đề cử</label>
            <select id="request-member" name="member_id">
              {members
                .filter((m) => m.user_id && m.id !== s.collector_member_id)
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </select>
            <p>
              Chuyển vai trò cần sự đồng ý của người tính tiền hiện tại và người
              được đề cử.
            </p>
          </>
        )}
        <label htmlFor="request-reason">Lý do</label>
        <input id="request-reason" name="reason" required maxLength={500} />
      </ActionForm>
    </section>
  );
}
