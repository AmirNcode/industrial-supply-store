"use client";

import { useEffect } from "react";
import { identifyStat, tagStaffSession, trackStat, type StatsEventData, type StatsEventName } from "@/lib/statsEvents";

/**
 * Renders nothing; reports one event when a server-rendered page shows an
 * outcome (a search, an order just placed). Give it a `key` that changes with
 * the outcome so a new search on the same page reports again.
 *
 * Effects run twice in development's strict mode, so a local build may log
 * an event twice; production runs it once.
 */
export function StatsEvent({ name, data }: { name: StatsEventName; data?: StatsEventData }) {
  const json = JSON.stringify(data ?? null);
  useEffect(() => {
    trackStat(name, JSON.parse(json) ?? undefined);
  }, [name, json]);
  return null;
}

/** Renders nothing; marks the visit as a signed-in customer's (see identifyStat). */
export function StatsIdentify({ customerId }: { customerId: string }) {
  useEffect(() => {
    identifyStat(customerId);
  }, [customerId]);
  return null;
}

/** Renders nothing; tags the visit as staff's (see tagStaffSession). */
export function StatsStaffTag() {
  useEffect(() => {
    tagStaffSession();
  }, []);
  return null;
}

