import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare, Send } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";

export const Route = createFileRoute("/messages")({
  head: () => ({ meta: [{ title: "Messages — AgriSense" }] }),
  component: Messages,
});

function Messages() {
  return (
    <PortalLayout>
      <PageHeader eyebrow="Buyer communication" title="Messages" description="Keep supplier and order conversations together." />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]"><Panel className="p-0"><div className="border-b border-border p-5"><h2 className="font-serif text-xl">Conversations</h2></div><div className="divide-y divide-border"><button className="w-full bg-accent p-5 text-left"><p className="font-medium">Sahyadri supplier network</p><p className="mt-1 text-xs text-muted-foreground">Order #AG-1024 · 10 min ago</p></button><button className="w-full p-5 text-left hover:bg-secondary"><p className="font-medium">Verified farmer network</p><p className="mt-1 text-xs text-muted-foreground">Tomato requirement · Yesterday</p></button></div></Panel><Panel><div className="flex items-center gap-3 border-b border-border pb-5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageSquare className="h-5 w-5" /></span><div><h2 className="font-serif text-xl">Sahyadri supplier network</h2><p className="text-xs text-muted-foreground">Order #AG-1024 · Tomato</p></div><Pill tone="green">Active</Pill></div><div className="min-h-64 space-y-4 py-6 text-sm"><div className="max-w-md rounded-2xl bg-secondary p-4">Can you confirm tomorrow&apos;s pickup window?</div><div className="ml-auto max-w-md rounded-2xl bg-primary p-4 text-primary-foreground">Please confirm pickup between 8:00 and 10:00 AM.</div></div><div className="flex gap-3 border-t border-border pt-5"><input placeholder="Write a message..." className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary" /><button className="rounded-xl bg-primary px-4 text-primary-foreground"><Send className="h-4 w-4" /></button></div></Panel></div>
    </PortalLayout>
  );
}
