"use client";

import { useState } from "react";
import {
  EVIDENCE_LABELS,
  type BuyerIntelligenceViewModel,
  type BuyerPotentialClassification,
  type ContactAccessLevel,
  type LegitimacyClassification,
  type OutreachReadinessClassification,
} from "@/lib/buyerIntelligence/types";

type Tab = "overview" | "trade" | "sources";

const LEGITIMACY_LABELS: Record<LegitimacyClassification, string> = {
  verified: "Verified",
  strong_evidence: "Strong evidence",
  moderate_evidence: "Moderate evidence",
  weak_signal: "Weak signal",
  no_evidence_found: "No evidence found",
};

const CONTACT_ACCESS_LABELS: Record<ContactAccessLevel, string> = {
  company_only: "Company only",
  public_route: "Public contact route",
  named_contact: "Named contact",
  direct_contact: "Direct contact",
  credit_enriched: "Credit-enriched contact",
};

const POTENTIAL_LABELS: Record<BuyerPotentialClassification, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  insufficient_evidence: "Insufficient evidence",
};

const READINESS_LABELS: Record<OutreachReadinessClassification, string> = {
  needs_review: "Needs review",
  needs_contact: "Needs contact",
  ready_for_conversion: "Ready for conversion",
  ready_for_outreach: "Ready for outreach",
  suppressed: "Suppressed",
  not_eligible: "Not eligible",
};

function dateLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const dateOnly = value.slice(0, 10);
  const date = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function safeHttpHref(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function BuyerIntelligencePanel({
  model,
  researchSlot,
}: {
  model: BuyerIntelligenceViewModel;
  /**
   * BI3 — optional manual research action rendered in the Sources tab
   * header. Left as a slot so this pure view component doesn't need
   * to know about server actions, transitions, or routing.
   */
  researchSlot?: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <section aria-labelledby="buyer-intelligence-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium text-text-muted">Buyer Intelligence</div>
          <h2 id="buyer-intelligence-heading" className="mt-0.5 text-[16px] font-semibold text-text-primary">
            Company evidence
          </h2>
        </div>
        <div role="tablist" aria-label="Buyer Intelligence views" className="flex gap-1">
          {([
            ["overview", "Overview"],
            ["trade", "Trade Intelligence"],
            ["sources", "Sources"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "btn-secondary" : "btn-ghost"}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-[12px] p-4" style={{ backgroundColor: "var(--app-surface)" }}>
        {tab === "overview" ? <Overview model={model} /> : null}
        {tab === "trade" ? <TradeIntelligence model={model} /> : null}
        {tab === "sources" ? (
          <Sources model={model} researchSlot={researchSlot} />
        ) : null}
      </div>
    </section>
  );
}

function Overview({ model }: { model: BuyerIntelligenceViewModel }) {
  const { legitimacy, buyerPotential, contactAccess, contactAccessSummary, outreachReadiness, metrics, evidenceCounts } = model.overview;
  const hasTrade = metrics.shipmentCount > 0 || Boolean(metrics.lastObservedTrade);

  return (
    <div className="space-y-4" role="tabpanel">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <IntelligenceField label="Buyer legitimacy" value={LEGITIMACY_LABELS[legitimacy.classification]} />
        <IntelligenceField label="Buyer potential" value={POTENTIAL_LABELS[buyerPotential.classification]} />
        <IntelligenceField label="Contact access" value={CONTACT_ACCESS_LABELS[contactAccess]} />
        <IntelligenceField label="Outreach readiness" value={READINESS_LABELS[outreachReadiness.classification]} />
      </div>
      <p className="text-[13px] text-text-secondary leading-relaxed">{legitimacy.summary}</p>
      <div className="space-y-1 text-[12px] text-text-secondary">
        <p>{buyerPotential.summary}</p>
        <p>{contactAccessSummary}</p>
        <p>{outreachReadiness.summary}</p>
      </div>

      {hasTrade ? (
        <div className="grid sm:grid-cols-3 gap-4">
          <IntelligenceField label="Last observed trade" value={dateLabel(metrics.lastObservedTrade) ?? "Not recorded"} />
          <IntelligenceField label="Observed shipments" value={String(metrics.shipmentCount)} />
          <IntelligenceField
            label="India sourcing"
            value={
              metrics.indiaShipmentShare === undefined
                ? "Origin not recorded"
                : `${metrics.indiaShipmentCount} of ${metrics.shipmentCount} (${Math.round(metrics.indiaShipmentShare * 100)}%)`
            }
          />
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">No verified trade intelligence yet.</p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-text-muted">
        <span>{evidenceCounts[1]} verified trade</span>
        <span>{evidenceCounts[2]} business evidence</span>
        <span>{evidenceCounts[3]} discovery signals</span>
      </div>
      <p className="text-[11.5px] text-text-muted">
        Intelligence belongs to this Candidate record and remains separate from Buyer conversion.
      </p>
    </div>
  );
}

function TradeIntelligence({ model }: { model: BuyerIntelligenceViewModel }) {
  const rows = model.trade.rows;
  const hasVerifiedTrade = model.overview.metrics.shipmentCount > 0 || Boolean(model.overview.metrics.lastObservedTrade);
  if (!hasVerifiedTrade) {
    return <p className="text-[13px] text-text-muted" role="tabpanel">No verified trade intelligence yet.</p>;
  }

  return (
    <div className="space-y-4" role="tabpanel">
      <div className="grid sm:grid-cols-3 gap-4">
        <IntelligenceField label="Verified shipments" value={String(model.overview.metrics.shipmentCount)} />
        <IntelligenceField
          label="Last India trade"
          value={dateLabel(model.overview.metrics.lastObservedIndiaTrade) ?? "Not recorded"}
        />
        <IntelligenceField
          label="Known suppliers"
          value={String(model.overview.metrics.supplierCount)}
        />
      </div>

      <div className="grid md:grid-cols-3 gap-4 text-[12px] text-text-secondary">
        <ProjectionList
          label="Origin distribution"
          rows={model.overview.metrics.originCountryDistribution.map((row) => `${row.countryCode}: ${row.count}`)}
        />
        <ProjectionList
          label="Supplier projection"
          rows={model.suppliers.slice(0, 5).map((row) => `${row.name}${row.countryCode ? ` (${row.countryCode})` : ""} · ${row.verifiedShipmentCount}`)}
        />
        <ProjectionList
          label="Product projection"
          rows={model.products.slice(0, 5).map((row) => `${row.mdfProductIds[0] ?? row.normalizedCategories[0] ?? row.rawDescriptions[0] ?? row.key} · ${row.verifiedShipmentCount}`)}
        />
      </div>

      <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
        {rows.map((row) => {
          const route = [row.originCountryCode, row.destinationCountryCode].filter(Boolean).join(" → ");
          const product = row.productDescriptionRaw || row.normalizedProductCategory;
          const supplier = row.supplierNameRaw || row.supplierNameNormalized;
          return (
            <li key={row.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
                <span>{dateLabel(row.tradeDate) ?? "Date not provided"}</span>
                {route ? <span>{route}</span> : null}
                <span>{EVIDENCE_LABELS[row.evidenceLevel]}</span>
              </div>
              {product ? <p className="mt-1 text-[13px] text-text-primary">{product}</p> : null}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-secondary">
                {row.hsCodeRaw ? <span>HS {row.hsCodeRaw}</span> : null}
                {supplier ? <span>Supplier: {supplier}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {!model.projectionsComplete ? (
        <p className="text-[11.5px] text-text-muted">Supplier and product summaries reflect this page; more observations are available through keyset pagination.</p>
      ) : null}
    </div>
  );
}

function ProjectionList({ label, rows }: { label: string; rows: string[] }) {
  return (
    <div>
      <div className="text-[11px] text-text-muted">{label}</div>
      {rows.length ? <ul className="mt-1 space-y-1">{rows.map((row) => <li key={row}>{row}</li>)}</ul> : <p className="mt-1 text-text-muted">Not recorded</p>}
    </div>
  );
}

function Sources({
  model,
  researchSlot,
}: {
  model: BuyerIntelligenceViewModel;
  researchSlot?: React.ReactNode;
}) {
  if (model.sources.length === 0) {
    return (
      <div role="tabpanel" className="space-y-3">
        {researchSlot ? <div>{researchSlot}</div> : null}
        <p className="text-[13px] text-text-muted">No intelligence sources recorded yet.</p>
      </div>
    );
  }
  return (
    <div role="tabpanel" className="space-y-4">
      {researchSlot ? <div>{researchSlot}</div> : null}
      <ul className="space-y-4">
      {model.sources.map((source) => {
        const href = safeHttpHref(source.sourceUrl);
        return (
          <li key={source.id}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium text-text-primary">{source.providerId}</span>
              <span className="text-[12px] text-text-muted">{source.sourceType}</span>
              <span className="text-[12px] text-text-muted">{source.costClass}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-secondary">
              {source.evidence.map((evidence) => (
                <span key={`${evidence.evidenceLevel}:${evidence.evidenceType}`}>
                  {EVIDENCE_LABELS[evidence.evidenceLevel]}
                </span>
              ))}
              <span>Retrieved {dateLabel(source.retrievedAt)}</span>
              {source.observedAt ? <span>Observed {dateLabel(source.observedAt)}</span> : null}
              {source.safeSourceRef ? <span>Ref {source.safeSourceRef}</span> : null}
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="hover:text-brand-orange">
                  View source ↗
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
      </ul>
    </div>
  );
}

function IntelligenceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
