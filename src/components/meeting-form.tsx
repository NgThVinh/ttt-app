"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, MapPin, Users, NotebookPen } from "lucide-react";
import ActionForm from "./action-form";
import { Calendar } from "./ui/calendar";
import { vietnamToday } from "@/lib/calendar";
import { scheduleMeeting } from "@/app/sessions/actions";
import { AnimatedDisclosure } from "./ui/animated-disclosure";
import { pollLocalTime, type PollMeetingDraft } from "@/lib/poll-draft";

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
  pollDraft,
}: {
  groups: { id: string; name: string }[];
  members: Member[];
  initialTime: string;
  suggestions: Record<string, { venue?: string }>;
  bankReady: boolean;
  events?: MeetingEvent[];
  pollDraft?: PollMeetingDraft;
}) {
  const id = useId();
  const router = useRouter();
  const [group, setGroup] = useState(pollDraft?.groupId || groups[0].id);
  const [starts, setStarts] = useState(
    pollDraft
      ? pollLocalTime(pollDraft.starts)
      : local(new Date(Date.parse(initialTime) + 86400000).toISOString()).slice(
          0,
          10,
        ) + "T18:00",
  );
  const [ends, setEnds] = useState(
    pollDraft ? pollLocalTime(pollDraft.ends) : starts.slice(0, 10) + "T20:00",
  );
  const [title, setTitle] = useState(pollDraft?.title || "");
  const [venue, setVenue] = useState(pollDraft?.venue || "");
  const [selected, setSelected] = useState<string[]>(pollDraft?.invitees || []);
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
        <ActionForm
          action={scheduleMeeting}
          label="Tạo lịch"
          disabled={badTime || missingBank}
          disabledReason={
            badTime
              ? "Chọn giờ kết thúc sau giờ bắt đầu, tối đa 7 ngày."
              : missingBank
                ? "Bổ sung ngân hàng trước khi nhận tính tiền."
                : undefined
          }
        >
          {pollDraft && (
            <>
              <input type="hidden" name="poll_id" value={pollDraft.pollId} />
              <input
                type="hidden"
                name="poll_option"
                value={pollDraft.optionId}
              />
              <input type="hidden" name="groupId" value={pollDraft.groupId} />
            </>
          )}
          <div className="meeting-basics">
            <div>
              <label htmlFor={`${id}-group`}>Nhóm</label>
              <select
                id={`${id}-group`}
                name="groupId"
                disabled={!!pollDraft}
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setSelected([]);
                  setTitle("");
                  setVenue("");
                  setSearch("");
                }}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-title`}>Tên buổi</label>
              <input
                id={`${id}-title`}
                name="title"
                value={actualTitle}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={160}
              />
            </div>
          </div>
          <div className="meeting-field">
            <Clock3 aria-hidden size={20} />
            <div className="meeting-when">
              <label htmlFor={`${id}-day`}>
                Ngày chơi
                <input
                  id={`${id}-day`}
                  type="date"
                  value={day}
                  required
                  onChange={(e) =>
                    moveStart(e.target.value + "T" + starts.slice(11))
                  }
                />
              </label>
              <label htmlFor={`${id}-start`}>
                Bắt đầu
                <input
                  id={`${id}-start`}
                  type="time"
                  value={starts.slice(11)}
                  required
                  onChange={(e) => moveStart(day + "T" + e.target.value)}
                />
              </label>
              <label htmlFor={`${id}-end`}>
                Kết thúc
                <input
                  id={`${id}-end`}
                  type="time"
                  value={ends.slice(11)}
                  required
                  onChange={(e) =>
                    setEnds(ends.slice(0, 10) + "T" + e.target.value)
                  }
                />
              </label>
              <details className="meeting-end-date">
                <summary>
                  {ends.slice(0, 10) !== day
                    ? `Kết thúc ${ends.slice(0, 10).split("-").reverse().join("/")}`
                    : "Kết thúc vào ngày khác"}
                </summary>
                <label htmlFor={`${id}-end-day`}>
                  Ngày kết thúc
                  <input
                    id={`${id}-end-day`}
                    type="date"
                    value={ends.slice(0, 10)}
                    min={day}
                    required
                    onChange={(e) =>
                      setEnds(e.target.value + "T" + ends.slice(11))
                    }
                  />
                </label>
              </details>
              <input type="hidden" name="starts" value={starts} />
              <input type="hidden" name="ends" value={ends} />
            </div>
          </div>
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
              {inGroup.length > 8 && (
                <input
                  aria-label="Tìm thành viên để mời"
                  placeholder="Tìm tên thành viên…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
              <div
                className="meeting-person-list"
                role="group"
                aria-label="Danh sách thành viên để mời"
                tabIndex={0}
                data-scroll="members"
              >
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
                      <span>{m.display_name}</span>
                    </label>
                  ))}
              </div>
              <button
                type="button"
                className="secondary invite-all"
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
                Mỗi người tự xác nhận tham gia sau khi nhận lời mời.
              </p>
            </fieldset>
          </div>
          <div className="meeting-collector">
            <label htmlFor={`${id}-collector`}>Người tính tiền</label>
            <select
              id={`${id}-collector`}
              name="collectorMode"
              value={collector}
              onChange={(e) => setCollector(e.target.value)}
            >
              <option value="unknown">Chọn sau</option>
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
          </div>
          <AnimatedDisclosure className="meeting-options" title="Thêm ghi chú">
            <label htmlFor={`${id}-note`}>
              <NotebookPen size={16} aria-hidden /> Ghi chú
            </label>
            <textarea
              id={`${id}-note`}
              name="note"
              rows={2}
              maxLength={2000}
              placeholder="Mang vợt, đến sớm 10 phút…"
            />
          </AnimatedDisclosure>
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
        <h3>Các buổi cùng ngày</h3>
        <div
          className="meeting-day-events"
          role="region"
          aria-label="Các buổi cùng ngày"
          tabIndex={0}
          data-scroll="day-events"
        >
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
        </div>
      </aside>
    </div>
  );
}
