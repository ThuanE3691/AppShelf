import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { SiteStatus } from "@appshelf/db";
import { cancelPlanAction, renewPlanAction } from "@/app/actions/sites";
import { ArrowUpRight, Plus } from "@/components/icons";
import { AutoRefresh, Countdown, SecretValue } from "@/components/live-widgets";
import { CancelPlanButton, RenewPlanButton } from "@/components/plan-buttons";
import { getCurrentUser } from "@/lib/auth";
import { TEMPLATES } from "@/lib/config";
import { canCancel, canRenew, getDashboardSites, type DashboardSite } from "@/lib/dashboard";
import { formatTimeLeft } from "@/lib/time-left";

export const metadata: Metadata = { title: "Dashboard" };

// Square status tags; every pair passes WCAG AA as text on its tint.
const STATUS_STYLE: Record<SiteStatus, { label: string; className: string }> = {
  pending: { label: "Queued", className: "border-info-700 bg-info-100 text-info-700" },
  provisioning: { label: "Setting up", className: "border-info-700 bg-info-100 text-info-700" },
  active: { label: "Live", className: "border-ok-700 bg-ok-100 text-ok-700" },
  archived: { label: "Archived", className: "border-ink-950 bg-ink-100 text-ink-950" },
  deleting: { label: "Deleting", className: "border-ink-950 bg-signal-500 text-ink-950" },
  deleted: { label: "Deleted", className: "border-ink-500 bg-white text-ink-600" },
  failed: { label: "Failed", className: "border-danger-700 bg-danger-100 text-danger-700" },
};

const NOTICES: Record<string, string> = {
  success: "Payment received. Your site is being set up; this page updates by itself.",
  renewed: "Plan renewed. Your site is being restored.",
  cancelled: "Plan cancelled. The licence is inactive and the site is being archived. Renew any time before it expires.",
};

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`label inline-flex items-center border-2 px-2 py-0.5 font-bold ${className}`}>{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-white px-5 py-4">
      <dt className="label text-ink-600">{label}</dt>
      <dd className="mt-2 text-sm text-ink-950">{children}</dd>
    </div>
  );
}

function SiteCard({ entry, now }: { entry: DashboardSite; now: Date }) {
  const { site, license, lastJob } = entry;
  const status = STATUS_STYLE[site.status];
  const template = TEMPLATES.find((t) => t.id === site.template);
  const isGone = site.status === "deleted" || site.status === "deleting";
  const jobPending = lastJob && (lastJob.status === "queued" || lastJob.status === "running");

  return (
    <article className="tag" aria-labelledby={`site-${site.id}`}>
      <div className="surface-ink flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-ink-950 px-5 py-2 text-white">
        <span className="label">SKU {template?.sku ?? "WP-01"}</span>
        <span className="label truncate text-ink-300">/{site.slug}/</span>
      </div>
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={status.className}>{status.label}</Badge>
            <Badge
              className={
                license.status === "active"
                  ? "border-ink-950 bg-signal-500 text-ink-950"
                  : "border-ink-500 bg-white text-ink-600"
              }
            >
              Licence {license.status}
            </Badge>
          </div>
          <h2 id={`site-${site.id}`} className="mt-3 truncate text-2xl font-bold">
            {site.title}
          </h2>
          <p className="label mt-1 text-ink-600">
            {template?.name ?? site.template} template · created{" "}
            {site.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
          </p>
          {isGone ? (
            <p className="mt-3 font-mono text-sm break-all text-ink-500 line-through">{site.url}</p>
          ) : (
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="text-link mt-3 inline-flex items-center gap-1.5 font-mono text-sm font-medium break-all"
            >
              {site.url}
              <ArrowUpRight />
            </a>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canCancel(entry) && <CancelPlanButton action={cancelPlanAction} siteId={site.id} siteTitle={site.title} />}
          {canRenew(entry, now) && <RenewPlanButton action={renewPlanAction} siteId={site.id} />}
        </div>
      </div>

      <dl className="grid gap-0.5 border-t-2 border-ink-950 bg-ink-950 sm:grid-cols-3">
        <Field label="Deletes in">
          {isGone ? (
            "—"
          ) : (
            <span className="font-mono text-base font-bold tabular-nums">
              <Countdown
                expiresAt={site.expiresAt.toISOString()}
                initialText={formatTimeLeft(site.expiresAt.getTime() - now.getTime())}
              />
            </span>
          )}
        </Field>
        <Field label="WordPress admin (demo)">
          {site.wpAdminUser && site.wpAdminPassword && !isGone ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="label w-16 text-ink-600">User</span>
                <code className="font-mono text-xs">{site.wpAdminUser}</code>
              </div>
              <div className="flex items-start gap-2">
                <span className="label w-16 shrink-0 pt-1.5 text-ink-600">Pass</span>
                <SecretValue value={site.wpAdminPassword} label="WordPress admin password" />
              </div>
              <a
                href={`${site.url}wp-admin/`}
                target="_blank"
                rel="noreferrer"
                className="text-link inline-flex items-center gap-1.5 text-xs"
              >
                Open wp-admin
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <span className="text-ink-600">{isGone ? "—" : "Shown once the site is live"}</span>
          )}
        </Field>
        <Field label="Last background job">
          {lastJob ? (
            <span className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <span className="font-bold">{lastJob.type}</span>
              <span className={lastJob.status === "failed" ? "text-danger-700" : "text-ink-600"}>{lastJob.status}</span>
              {jobPending && <span className="h-2 w-2 animate-blink bg-info-700" aria-hidden />}
            </span>
          ) : (
            <span className="text-ink-600">—</span>
          )}
        </Field>
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
    <div className="page py-(--spacing-section)">
      {busy && <AutoRefresh />}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-ink-950 pb-6">
        <div>
          <p className="label text-ink-600">Your shelf · {entries.length} {entries.length === 1 ? "site" : "sites"}</p>
          <h1 className="mt-3 text-3xl font-bold">Your sites</h1>
          <p className="mt-2 font-mono text-sm break-all text-ink-600">Signed in as {user.email}</p>
        </div>
        <Link href="/sites/new" className="btn btn-primary">
          <Plus />
          New site
        </Link>
      </div>

      {notice && (
        <p role="status" className="mt-6 flex items-start gap-3 border-2 border-ok-700 bg-ok-100 px-4 py-3 text-sm text-ok-700">
          <span className="label shrink-0 bg-ok-700 px-1.5 py-0.5 text-white">Notice</span>
          <span className="font-medium">{notice}</span>
        </p>
      )}

      <div className="mt-10 space-y-10">
        {entries.length === 0 ? (
          <div className="border-2 border-dashed border-ink-950 bg-white px-6 py-16">
            <p className="label text-ink-600">Bin empty</p>
            <h2 className="mt-3 text-2xl font-bold">No sites yet</h2>
            <p className="mt-2 max-w-sm text-ink-700">
              Pick a template, pay with the Stripe test card and your WordPress site appears here.
            </p>
            <Link href="/sites/new" className="btn btn-primary mt-8">
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
