import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AttendanceCard } from "./attendance-card";
import { buildAttendanceRows, type AttendancePreview } from "./attendance";
import { employees, extracted } from "./attendance-fixture";

test("attendance UI renders editable eight-row preview and a distinct confirmation, disabled until validated", () => {
  const preview: AttendancePreview = {
    extracted, employees, eventId: "event", events: [{ id: "event", event_date: "2026-11-12", venue_id: "venue", venueName: "קסנאדו", client_name: "לקוח" }],
    rows: buildAttendanceRows(extracted, employees, [], "2026-11-12"), issues: ["נדרש אישור נפרד להוספת עובדים שאינם משובצים"],
  };
  const render = (p: AttendancePreview) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(AttendanceCard, { initial: p, onBusyChange: () => undefined })));
  const initial = render(preview);
  assert.match(initial, /8 עובדים מזוהים/); assert.match(initial, /קסנאדו/); assert.match(initial, /2026-11-12/);
  assert.equal((initial.match(/type="time"/g) ?? []).length, 16);
  assert.match(initial, /למחרת/); assert.match(initial, /מאשר בנפרד/);
  assert.match(initial, /disabled="">אשר ושמור את כל השעות/);
  assert.doesNotMatch(initial, /₪|hourly_rate|fixed_pay/);
  const ready = render({ ...preview, issues: [], proposalId: "proposal" });
  assert.doesNotMatch(ready, /disabled="">אשר ושמור את כל השעות/);
  assert.match(ready, />אשר ושמור את כל השעות<\/button>/);
  const incomplete = render({ ...preview, proposalId: "proposal", rows: [{ ...preview.rows[0], issues: ["חסרה יציאה"] }] });
  assert.match(incomplete, /disabled="">אשר ושמור את כל השעות/);
});
