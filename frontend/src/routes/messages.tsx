import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getSession } from "@/services/session";
import { useConversation, useConversations, useSendMessage } from "@/hooks/use-market";
import { ErrorNote, Loading } from "@/components/fpo/fpo-ui";
import { timeAgo } from "@/lib/deal-format";

export const Route = createFileRoute("/messages")({
  validateSearch: (search: Record<string, unknown>): { with?: number } => {
    const w = Number(search["with"]);
    return Number.isFinite(w) && w > 0 ? { with: w } : {};
  },
  head: () => ({ meta: [{ title: "Messages — AgriSense" }] }),
  component: Messages,
});

const ROLE_LABEL: Record<string, string> = { farmer: "Farmer", buyer: "Buyer", fpo: "FPO" };

function Messages() {
  const { t } = useI18n();
  const me = getSession()?.userId;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const conversations = useConversations();
  const list = conversations.data ?? [];
  const activeId = search.with ?? list[0]?.user_id;
  const thread = useConversation(activeId);
  const send = useSendMessage();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messages = thread.data?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeId]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !activeId) return;
    send.mutate(
      { userId: activeId, body },
      {
        onSuccess: () => setDraft(""),
        onError: (err) => toast.error(t("Could not send message"), { description: err.message }),
      },
    );
  }

  const partner = thread.data?.partner;
  const showNew = activeId && !list.some((c) => c.user_id === activeId);

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Messages"
        title="Messages"
        description="Talk to buyers, farmers and FPOs about lots and orders. New messages appear every few seconds."
      />
      <ErrorNote error={conversations.error} />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Panel className="p-0">
          <div className="border-b border-border p-5">
            <h2 className="font-serif text-xl">{t("Conversations")}</h2>
          </div>
          {conversations.isLoading ? (
            <div className="p-5">
              <Loading />
            </div>
          ) : list.length === 0 && !showNew ? (
            <p className="p-5 text-sm text-muted-foreground">
              {t(
                "No conversations yet. Use the Message button on a lot, buyer or order to start one.",
              )}
            </p>
          ) : (
            <div className="max-h-[560px] divide-y divide-border overflow-y-auto">
              {showNew && partner && (
                <div className="w-full bg-accent p-5 text-left">
                  <p className="font-medium">{partner.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("New conversation")}</p>
                </div>
              )}
              {list.map((c) => (
                <button
                  key={c.user_id}
                  onClick={() => void navigate({ search: { with: c.user_id }, replace: true })}
                  className={cn(
                    "w-full p-5 text-left hover:bg-secondary",
                    c.user_id === activeId && "bg-accent",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.unread > 0 && (
                      <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
                        {c.unread}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {c.last_from_me ? `${t("You")}: ` : ""}
                    {c.last_body}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t(ROLE_LABEL[c.role] ?? c.role)} · {t(timeAgo(c.last_at))}
                  </p>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          {!activeId ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-8 w-8" />
              {t("Choose a conversation.")}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border pb-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-serif text-xl">{partner?.name ?? "…"}</h2>
                  <p className="text-xs text-muted-foreground">
                    {partner ? t(ROLE_LABEL[partner.role] ?? partner.role) : ""}
                  </p>
                </div>
                {thread.isFetching && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <Pill tone="green">{t("Live")}</Pill>
              </div>
              <div className="max-h-[440px] min-h-64 space-y-3 overflow-y-auto py-6 text-sm">
                {thread.error ? (
                  <p className="text-destructive">{thread.error.message}</p>
                ) : thread.isLoading ? (
                  <Loading />
                ) : messages.length === 0 ? (
                  <p className="text-muted-foreground">{t("No messages yet. Say hello.")}</p>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === me;
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "max-w-md rounded-2xl p-3",
                          mine ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p
                          className={cn(
                            "mt-1 text-[11px]",
                            mine ? "text-primary-foreground/70" : "text-muted-foreground",
                          )}
                        >
                          {m.transaction_id ? `${t("Order")} #${m.transaction_id} · ` : ""}
                          {m.lot_id ? `LOT-${m.lot_id} · ` : ""}
                          {t(timeAgo(m.created_at))}
                          {mine && m.read_at ? ` · ${t("Seen")}` : ""}
                        </p>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>
              <form onSubmit={submit} className="flex gap-3 border-t border-border pt-5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={2000}
                  placeholder={t("Write a message...")}
                  aria-label={t("Message")}
                  className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={send.isPending || !draft.trim()}
                  aria-label={t("Send")}
                  className="rounded-xl bg-primary px-4 text-primary-foreground disabled:opacity-60"
                >
                  {send.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            </>
          )}
        </Panel>
      </div>
    </PortalLayout>
  );
}
