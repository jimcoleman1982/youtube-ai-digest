import type { Config } from "@netlify/functions";
import { getLastCheck, getSummariesIndex, getUsageLog, getChannels } from "./lib/blobs.js";

export default async function handler() {
  const [lastCheck, index, usageLog, channels] = await Promise.all([
    getLastCheck(),
    getSummariesIndex(),
    getUsageLog(),
    getChannels(),
  ]);

  const today = new Date().toISOString().split("T")[0];
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Videos today
  const videosToday = index.filter(
    (s) => s.processedAt.split("T")[0] === today
  ).length;

  // Monthly usage
  const monthlyLog = usageLog.filter((e) => e.date.startsWith(currentMonth));
  const monthlyCost = monthlyLog.reduce((sum, e) => sum + e.estimatedCost, 0);
  const monthlyAdHocCost = monthlyLog
    .filter((e) => e.isAdHoc)
    .reduce((sum, e) => sum + e.estimatedCost, 0);
  const monthlyScheduledCost = monthlyCost - monthlyAdHocCost;

  // Average cost per video
  const avgCostPerVideo =
    monthlyLog.length > 0 ? monthlyCost / monthlyLog.length : 0;

  // Projected monthly cost
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0
  ).getDate();
  const projectedMonthlyCost =
    dayOfMonth > 0 ? (monthlyCost / dayOfMonth) * daysInMonth : 0;

  return new Response(
    JSON.stringify({
      lastCheck,
      totalChannels: channels.length,
      videosToday,
      totalVideosProcessed: index.length,
      monthlyCost: Math.round(monthlyCost * 10000) / 10000,
      monthlyScheduledCost: Math.round(monthlyScheduledCost * 10000) / 10000,
      monthlyAdHocCost: Math.round(monthlyAdHocCost * 10000) / 10000,
      avgCostPerVideo: Math.round(avgCostPerVideo * 10000) / 10000,
      projectedMonthlyCost: Math.round(projectedMonthlyCost * 100) / 100,
      monthlyVideosProcessed: monthlyLog.length,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

export const config: Config = {
  path: "/api/status",
  method: "GET",
};
