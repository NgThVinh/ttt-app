"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, MapPin, Users, NotebookPen } from "lucide-react";
import ActionForm from "./action-form";
import DateTimeField from "./ui/date-time-field";
import { Calendar } from "./ui/calendar";
import { vietnamToday } from "@/lib/calendar";
import { scheduleMeeting } from "@/app/sessions/actions";

export type MeetingEvent = {
  id: string;
  group_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
};
type Member = {
  id: string;
  group_id: string;
  display_name: string;
  user_id: string | null;
};
const local = (value: string) =>
  new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16);
const asUtc = (value: string) => Date.parse(value + ":00+07:00");
export default function MeetingForm({
  groups,
  members,
  initialTime,
  suggestions,
  bankReady,
  events = [],
}: {
  groups: { id: string; name: string }[];
  members: Member[];
  initialTime: string;
  suggestions: Record<string, { venue?: string }>;
  bankReady: boolean;
  events?: MeetingEvent[];
}) {
  const id = useId();
  const router = useRouter();
  const [group, setGroup] = useState(groups[0].id);
  const [starts, setStarts] = useState(
    local(new Date(Date.parse(initialTime) + 86400000).toISOString()).slice(
      0,
      10,
    ) + "T18:00",
  );
  const [ends, setEnds] = useState(starts.slice(0, 10) + "T20:00");
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [collector, setCollector] = useState("unknown");
  const inGroup = members.filter((m) => m.group_id === group);
  const day = starts.slice(0, 10);
  const name = groups.find((g) => g.id === group)?.name || "cùng nhóm";
  const autoTitle =
    `Buổi chơi ${name} · ${day.split("-").reverse().slice(0, 2).join("/")}`.slice(
      0,
      160,
    );
  const actualTitle = title || autoTitle;
  const actualVenue = venue || suggestions[group]?.venue || "Chưa chọn sân";
  const badTime =
    !starts ||
    !ends ||
    !Number.isFinite(asUtc(starts)) ||
    !Number.isFinite(asUtc(ends)) ||
    asUtc(ends) <= asUtc(starts) ||
    asUtc(ends) > asUtc(starts) + 7 * 86400000;
  const missingBank = collector === "self" && !bankReady;
  const groupEvents = events.filter((e) => e.group_id === group);
  const dayEvents = groupEvents.filter(
    (e) => local(e.starts_at).slice(0, 10) === day,
  );
  const counts: Record<string, number> = {};
  for (const e of groupEvents) {
    const d = local(e.starts_at).slice(0, 10);
    counts[d] = (counts[d] || 0) + 1;
  }
  function moveStart(next: string) {
    const duration = asUtc(ends) - asUtc(starts);
    setStarts(next);
    if (Number.isFinite(asUtc(next)))
      setEnds(
        local(
          new Date(
            asUtc(next) + (duration > 0 ? duration : 7200000),
          ).toISOString(),
        ),
      );
  }
  return (
    <div className="meeting-layout">
      <section className="meeting-editor panel">
        <div className="meeting-heading">
          <CalendarDays aria-hidden size={22} />
          <div>
            <h2>Lên lịch buổi chơi</h2>
            <p>Gửi lời mời, mỗi người tự nhận lời.</p>
          </div>
        </div>
        <ActionForm
          action={scheduleMeeting}
          label="Gửi lời mời và tạo lịch"
          disabled={badTime || missingBank}
          disabledReason={
            badTime
              ? "Chọn giờ kết thúc sau giờ bắt đầu, tối đa 7 ngày."
              : missingBank
                ? "Bổ sung ngân hàng trước khi nhận tính tiền."
                : undefined
          }
        >
          <label htmlFor={`${id}-group`}>Nhóm</label>
          <select
            id={`${id}-group`}
            name="groupId"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setSelected([]);
              setTitle("");
              setVenue("");
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-title`}>Tên buổi</label>
          <input
            id={`${id}-title`}
            name="title"
            value={actualTitle}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
          />
          <div className="meeting-field">
            <Clock3 aria-hidden size={20} />
            <div className="meeting-time-row">
              <DateTimeField
                id={`${id}-start`}
                name="starts"
                label="Bắt đầu"
                value={starts}
                onChange={moveStart}
                required
              />
              <DateTimeField
                id={`${id}-end`}
                name="ends"
                label="Kết thúc"
                value={ends}
                onChange={setEnds}
                required
              />
            </div>
          </div>
          <p className="field-hint">
            Giờ Việt Nam · Đổi giờ bắt đầu sẽ giữ thời lượng buổi.
          </p>
          <div className="meeting-field">
            <MapPin aria-hidden size={20} />
            <label htmlFor={`${id}-venue`}>
              Địa điểm
              <input
                id={`${id}-venue`}
                name="venue"
                value={actualVenue}
                onChange={(e) => setVenue(e.target.value)}
                required
                maxLength={200}
              />
            </label>
          </div>
          <div className="meeting-field">
            <Users aria-hidden size={20} />
            <fieldset className="meeting-invitees">
              <legend>
                Mời tham gia <small>({selected.length} người)</small>
              </legend>
              <input
                aria-label="Tìm thành viên để mời"
                placeholder="Tìm tên thành viên…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="meeting-person-list">
                {inGroup
                  .filter((m) =>
                    m.display_name
                      .toLocaleLowerCase("vi")
                      .includes(search.toLocaleLowerCase("vi")),
                  )
                  .map((m) => (
                    <label className="meeting-person" key={m.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(m.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, m.id]
                              : old.filter((v) => v !== m.id),
                          )
                        }
                      />
                      <span className="meeting-avatar" aria-hidden>
                        {m.display_name.slice(0, 1)}
                      </span>
                      <span>{m.display_name}</span>
                    </label>
                  ))}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setSelected(
                    selected.length === inGroup.length
                      ? []
                      : inGroup.map((m) => m.id),
                  )
                }
              >
                {selected.length === inGroup.length
                  ? "Bỏ chọn tất cả"
                  : "Mời cả nhóm"}
              </button>
              {selected.map((v) => (
                <input key={v} type="hidden" name="invitees" value={v} />
              ))}
              <p className="field-hint">
                Lời mời chưa phải xác nhận đi. Thành viên cũng có thể tham gia
                qua link buổi.
              </p>
            </fieldset>
          </div>
          <details className="meeting-options">
            <summary>Người tính tiền & ghi chú</summary>
            <label htmlFor={`${id}-collector`}>Người tính tiền</label>
            <select
              id={`${id}-collector`}
              name="collectorMode"
              value={collector}
              onChange={(e) => setCollector(e.target.value)}
            >
              <option value="unknown">Chọn sau — ai cũng có thể tự nhận</option>
              <option value="self">Tôi nhận tính tiền</option>
              <option value="nominee">Đề cử một người</option>
            </select>
            {collector === "nominee" ? (
              <>
                <label htmlFor={`${id}-nominee`}>Người được đề cử</label>
                <select id={`${id}-nominee`} name="nominee" required>
                  {inGroup
                    .filter((m) => m.user_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                </select>
                <p className="field-hint">
                  Chỉ nhận vai trò sau khi chính người đó xác nhận trong app.
                </p>
              </>
            ) : (
              <input type="hidden" name="nominee" value="" />
            )}
            {missingBank && (
              <p role="alert">
                <Link href="/me" target="_blank" rel="noopener noreferrer">
                  Bổ sung ngân hàng (tab mới)
                </Link>{" "}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => router.refresh()}
                >
                  Đã cập nhật · Kiểm tra lại
                </button>
              </p>
            )}
            <label htmlFor={`${id}-note`}>
              <NotebookPen size={16} aria-hidden /> Ghi chú
            </label>
            <textarea
              id={`${id}-note`}
              name="note"
              rows={3}
              maxLength={2000}
              placeholder="Mang vợt, đến sớm 10 phút…"
            />
          </details>
        </ActionForm>
      </section>
      <aside className="meeting-sidebar panel" aria-label="Tổng quan lịch">
        <h2>Lịch nhóm</h2>
        <Calendar
          value={day}
          today={vietnamToday(new Date(initialTime))}
          counts={counts}
          onChange={(d) => moveStart(d + "T" + (starts.slice(11) || "18:00"))}
        />
        <div className="meeting-summary">
          <strong>{actualTitle}</strong>
          <p>
            {starts.slice(11)} – {ends.slice(11)} · {actualVenue}
          </p>
          <p>{selected.length} lời mời · Chờ người nhận trả lời</p>
        </div>
        <h3>Các buổi cùng ngày</h3>
        {dayEvents.length ? (
          dayEvents.map((e) => {
            const overlap =
              asUtc(starts) < Date.parse(e.ends_at || e.starts_at) &&
              asUtc(ends) > Date.parse(e.starts_at);
            return (
              <div className="meeting-agenda" key={e.id}>
                <time>{local(e.starts_at).slice(11)}</time>
                <div>
                  <Link href={`/sessions/${e.id}`}>{e.title}</Link>
                  {overlap && (
                    <small className="field-error">
                      Trùng giờ với lịch đang chọn
                    </small>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <p className="field-hint">Nhóm chưa có buổi nào trong ngày này.</p>
        )}
        <p className="field-hint">
          Lịch và danh sách tham gia chỉ khóa khi người tính tiền chốt chi phí.
          Đây là lịch nhóm trong 3T.
        </p>
      </aside>
    </div>
  );
}
