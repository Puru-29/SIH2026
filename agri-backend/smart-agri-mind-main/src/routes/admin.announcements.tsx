import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { Pager } from "@/components/admin/admin-ui";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageTitle,
  Select,
  shortDate,
  TextArea,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/announcements")({
  component: AnnouncementsPage,
});

const AUDIENCES = [
  { id: "all_farmers", label: "All farmers" },
  { id: "all_buyers", label: "All buyers" },
  { id: "all_fpos", label: "All FPOs" },
  { id: "all", label: "Everyone" },
];

function AnnouncementsPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const list = useFpoQuery(["admin", "announcements", page], () =>
    adminApi.announcements({ page, limit: 15 }),
  );
  const [f, setF] = useState({ audience: "all_farmers", district: "", title: "", body: "" });
  const post = useFpoMutation(() => adminApi.postAnnouncement(f), {
    success: "Advisory published",
    onSuccess: () => setF({ ...f, title: "", body: "" }),
  });
  return (
    <>
      <PageTitle
        title="Announcements and advisories"
        subtitle="Price advisories, weather alerts and notices. Users see them in Notifications."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card title="New advisory">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              post.mutate(undefined);
            }}
          >
            <Select
              id="ad-aud"
              label="Send to"
              value={f.audience}
              onChange={(e) => setF({ ...f, audience: e.target.value })}
            >
              {AUDIENCES.map((a) => (
                <option key={a.id} value={a.id}>
                  {t(a.label)}
                </option>
              ))}
            </Select>
            <Input
              id="ad-district"
              label="Only this district or state (optional)"
              value={f.district}
              onChange={(e) => setF({ ...f, district: e.target.value })}
              hint="Matches the farmer's location or the FPO's district. Leave empty for everyone."
            />
            <Input
              id="ad-title"
              label="Title"
              required
              minLength={3}
              maxLength={120}
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder="e.g. Heavy rain alert"
            />
            <TextArea
              id="ad-body"
              label="Message"
              required
              minLength={3}
              maxLength={2000}
              rows={5}
              value={f.body}
              onChange={(e) => setF({ ...f, body: e.target.value })}
            />
            <Btn type="submit" size="lg" icon={<Send className="h-5 w-5" />} busy={post.isPending}>
              {t("Publish")}
            </Btn>
          </form>
        </Card>
        <Card title="Published">
          <ErrorNote error={list.error} />
          {list.isLoading ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <Empty icon={<Megaphone className="h-6 w-6" />} title="Nothing published yet" />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {list.data.items.map((a) => (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{a.title}</p>
                      <Badge
                        label={
                          a.fpo_name
                            ? `FPO: ${a.fpo_name}`
                            : (AUDIENCES.find((x) => x.id === a.audience)?.label ?? a.audience)
                        }
                        tone={a.fpo_name ? "gray" : "olive"}
                      />
                      {a.district && <Badge label={a.district} tone="gray" />}
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-sm">{a.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.author} · {shortDate(a.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
              <Pager
                page={list.data.page}
                pages={list.data.pages}
                total={list.data.total}
                onPage={setPage}
              />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
