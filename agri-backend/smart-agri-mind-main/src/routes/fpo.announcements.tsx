import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Megaphone, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageTitle,
  shortDate,
  TextArea,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/announcements")({
  component: AnnouncementsPage,
});

const TEMPLATES = [
  {
    title: "Collection day",
    body: "Bring your crop to the collection centre on Friday between 8 and 11 AM. Carry your FPO member card.",
  },
  {
    title: "Payment released",
    body: "Payments for the last bulk sale have been sent to your bank accounts. Check My FPO in the AgriSense app.",
  },
  {
    title: "Quality check",
    body: "Dry your crop well before bringing it. Crop with high moisture may be graded lower.",
  },
];

function AnnouncementsPage() {
  const { t } = useI18n();
  const list = useFpoQuery(["announcements"], fpoApi.fpoAnnouncements);
  const [f, setF] = useState({ title: "", body: "" });
  const post = useFpoMutation(() => fpoApi.postAnnouncement(f), {
    success: "Announcement sent to your members",
    onSuccess: () => setF({ title: "", body: "" }),
  });

  return (
    <>
      <PageTitle
        title="Announcements"
        subtitle="Send notices to all your member farmers. They see them in Notifications and My FPO."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card title="New announcement">
          <div className="mb-4 flex flex-wrap gap-2">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.title}
                type="button"
                onClick={() => setF({ title: t(tpl.title), body: t(tpl.body) })}
                className="min-h-9 rounded-full border border-border px-3 text-sm hover:bg-secondary"
              >
                {t(tpl.title)}
              </button>
            ))}
          </div>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              post.mutate(undefined);
            }}
          >
            <Input
              id="an-title"
              label="Title"
              required
              minLength={3}
              maxLength={120}
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
            <TextArea
              id="an-body"
              label="Message"
              required
              minLength={3}
              maxLength={2000}
              rows={5}
              value={f.body}
              onChange={(e) => setF({ ...f, body: e.target.value })}
            />
            <Btn type="submit" size="lg" icon={<Send className="h-5 w-5" />} busy={post.isPending}>
              {t("Send to members")}
            </Btn>
          </form>
        </Card>
        <Card title="Sent announcements">
          <ErrorNote error={list.error} />
          {list.isLoading ? (
            <Loading />
          ) : !list.data?.length ? (
            <Empty icon={<Megaphone className="h-6 w-6" />} title="No announcements yet" />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.map((a) => (
                <li key={a.id} className="py-3">
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.author_name} · {shortDate(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
