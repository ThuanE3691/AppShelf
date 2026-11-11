import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { SiteStatus } from "@appshelf/db";
import { cancelPlanAction, renewPlanAction } from "@/app/actions/sites";
import { AutoRefresh, Countdown, SecretValue } from "@/components/live-widgets";
import { CancelPlanButton, RenewPlanButton } from "@/components/plan-buttons";
import { getCurrentUser } from "@/lib/auth";
import { TEMPLATES } from "@/lib/config";
import { canCancel, canRenew, getDashboardSites, type DashboardSite } from "@/lib/dashboard";
import { formatTimeLeft } from "@/lib/time-left";

export const metadata: Metadata = { title: "Dashboard" };

const STATUS_STYLE: Record<SiteStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-sky-50 text-sky-800 ring-sky-200" },
  provisioning: { label: "Setting up", className: "bg-sky-50 text-sky-800 ring-sky-200" },
  active: { label: "Live", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  archived: { label: "Archived", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  deleting: { label: "Deleting", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  deleted: { label: "Deleted", className: "bg-slate-100 text-slate-500 ring-slate-200" },
  failed: { label: "Failed", className: "bg-rose-50 text-rose-800 ring-rose-200" },
};

const NOTICES: Record<string, string> = {
  success: "Payment received. Your site is being set up; this page updates by itself.",
  renewed: "Plan renewed. Your site is being restored.",
  cancelled: "Plan cancelled. The licence is inactive and the site is being archived. Renew any time before it expires.",
};

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${className}`}>
      {children}
    </span>
  );
}

function SiteCard({ entry, now }: { entry: DashboardSite; now: Date }) {
  const { site, license, lastJob } = entry;
  const status = STATUS_STYLE[site.status];
  const template = TEMPLATES.find((t) => t.id === site.template);
  const isGone = site.status === "deleted" || site.status === "deleting";
  const jobPending = lastJob && (lastJob.status === "queued" || lastJob.status === "running");

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{site.title}</h2>
            <Badge className={status.className}>{status.label}</Badge>
            <Badge
              className={
                license.status === "active"
                  ? "bg-brand-50 text-brand-700 ring-brand-100"
                  : "bg-slate-100 text-slate-600 ring-slate-200"
              }
            >
              Licence {license.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {template?.name ?? site.template} template · created{" "}
            {site.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
          </p>
          {isGone ? (
            <p className="mt-3 font-mono text-sm text-slate-400 line-through">{site.url}</p>
          ) : (
            <a href={site.url} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all font-mono text-sm text-brand-700 hover:underline">
              {site.url} ↗
            </a>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canCancel(entry) && <CancelPlanButton action={cancelPlanAction} siteId={site.id} siteTitle={site.title} />}
          {canRenew(entry, now) && <RenewPlanButton action={renewPlanAction} siteId={site.id} />}
        </div>
      </div>

      <dl className="grid gap-px border-t border-slate-200 bg-slate-200 text-sm sm:grid-cols-3">
        <div className="bg-slate-50 px-6 py-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Deletes in</dt>
          <dd className="mt-1 font-medium text-slate-800">
            {isGone ? "—" : <Countdown expiresAt={site.expiresAt.toISOString()} initialText={formatTimeLeft(site.expiresAt.getTime() - now.getTime())} />}
          </dd>
        </div>
        <div className="bg-slate-50 px-6 py-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">WordPress admin (demo)</dt>
          <dd className="mt-1 space-y-1 text-slate-800">
            {site.wpAdminUser && site.wpAdminPassword && !isGone ? (
              <>
                <div>
                  <span className="text-slate-500">User </span>
                  <code className="font-mono text-xs">{site.wpAdminUser}</code>
                </div>
                <div>
                  <span className="text-slate-500">Password </span>
                  <SecretValue value={site.wpAdminPassword} label="WordPress admin password" />
                </div>
                <a href={`${site.url}wp-admin/`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:underline">
                  Open wp-admin ↗
                </a>
              </>
            ) : (
              <span className="text-slate-500">{isGone ? "—" : "Shown once the site is live"}</span>
            )}
          </dd>
        </div>
        <div className="bg-slate-50 px-6 py-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Last background job</dt>
          <dd className="mt-1 text-slate-800">
            {lastJob ? (
              <>
                <code className="font-mono text-xs">{lastJob.type}</code>{" "}
                <span className={lastJob.status === "failed" ? "text-rose-700" : "text-slate-500"}>· {lastJob.status}</span>
                {jobPending && <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" aria-hidden />}
              </>
            ) : (
              <span className="text-slate-500">—</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; plan?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");
  const { checkout, plan } = await searchParams;
  const entries = await getDashboardSites(user.id);
  const now = new Date();
  const busy = entries.some(
    (e) =>
      e.site.status === "pending" ||
      e.site.status === "provisioning" ||
      e.lastJob?.status === "queued" ||
      e.lastJob?.status === "running",
  );
  const noticeKey = checkout ?? plan;
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      {busy && <AutoRefresh />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your sites</h1>
          <p className="mt-1 text-sm text-slate-500">Signed in as {user.email}</p>
        </div>
        <Link href="/sites/new" className="btn btn-primary">
          + New site
        </Link>
      </div>

      {notice && (
        <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      <div className="mt-8 space-y-6">
        {entries.length === 0 ? (
          <div className="card flex flex-col items-center px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">No sites yet</h2>
            <p className="mt-2 max-w-sm text-sm text-slate-600">
              Pick a template, pay with the Stripe test card and your WordPress site appears here.
            </p>
            <Link href="/sites/new" className="btn btn-primary mt-6">
              Get your first site
            </Link>
          </div>
        ) : (
          entries.map((entry) => <SiteCard key={entry.site.id} entry={entry} now={now} />)
        )}
      </div>
    </div>
  );
}
