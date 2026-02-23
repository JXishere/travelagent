// Slack webhook notifications — fire-and-forget, never blocks the user

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

function post(payload: object): void {
  if (!WEBHOOK_URL) return;
  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("[slack] Failed to send notification:", err));
}

export function notifyNewSpot(spot: {
  name: string;
  area?: string;
  city?: string;
  categories?: string[];
  must_go?: boolean;
  needs_review?: boolean;
  contributor_phone: string;
}): void {
  const tier = spot.must_go ? "must-go" : "verified";
  const flag = spot.needs_review ? " | *needs review*" : "";
  const cats = spot.categories?.join(", ") ?? "—";
  const location = [spot.area, spot.city].filter(Boolean).join(", ");

  post({
    text: `New spot added: *${spot.name}* (${location})\nCategories: ${cats} | Tier: ${tier}${flag}\nContributor: ${spot.contributor_phone}`,
  });
}

export function notifyMergedSpot(spot: {
  name: string;
  area?: string;
  city?: string;
  newFields: string[];
  contributor_phone: string;
}): void {
  const location = [spot.area, spot.city].filter(Boolean).join(", ");
  const fields = spot.newFields.join(", ") || "general intel";

  post({
    text: `Intel merged into: *${spot.name}* (${location})\nNew info: ${fields}\nContributor: ${spot.contributor_phone}`,
  });
}
