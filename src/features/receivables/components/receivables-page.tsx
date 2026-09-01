"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  Download,
  LoaderCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getIsraelDateOnly } from "@/features/dashboard/utils/dashboard-date-range";
import {
  formatDate,
  formatMoney,
  translateStoredValue,
} from "@/lib/hebrew";

import { useReceivables } from "../hooks/use-receivables";
import type {
  ReceivableEvent,
  ReceivablesScope,
} from "../types";

import { calculateReceivableEvent } from "../utils/receivables-calculations";

import {
  calculateReceivablesSummary,
  filterReceivables,
  groupByVenue,
  unpaidEvents,
  unsettledVenueEvents,
} from "../utils/receivables-policy";

import {
  customerExportEvents,
  venueExportEvents,
} from "../exporters/export-policy";

type DetailsMode = "venue" | "customer";

type OpenDetails = {
  title: string;
  events: ReceivableEvent[];
  mode: DetailsMode;
} | null;

const statusLabels = {
  paid: "שולם",
  partial: "שולם חלקית",
  unpaid: "לא שולם",
} as const;

export function ReceivablesPage() {
  const query = useReceivables();

  const [scope, setScope] =
    useState<ReceivablesScope>("current");

  const [venueId, setVenueId] = useState("");
  const [eventType, setEventType] = useState("");

  const [details, setDetails] =
    useState<OpenDetails>(null);

  const [exportNotice, setExportNotice] =
    useState("");

  const today = getIsraelDateOnly();

  /*
   * כל האירועים שכבר התקיימו.
   */
  const allEvents = useMemo(
    () =>
      (query.data ?? [])
        .map(calculateReceivableEvent)
        .filter(
          (event) =>
            event.eventDate <= today,
        ),
    [query.data, today],
  );

  /*
   * האירועים המסוננים לטבלאות.
   *
   * כולל:
   * תקופה
   * אולם
   * סוג אירוע
   */
  const filtered = useMemo(
    () =>
      filterReceivables(
        allEvents,
        scope,
        today,
        venueId,
        eventType,
      ),
    [
      allEvents,
      scope,
      today,
      venueId,
      eventType,
    ],
  );

  /*
   * אירועים עבור כרטיסי האולמות וה-Excel.
   *
   * כן מכבדים:
   * - תקופה
   * - סוג אירוע
   *
   * לא מסננים לפי venueId כדי שכל
   * כרטיסי האולמות ימשיכו להופיע.
   */
  const venueScopeEvents = useMemo(
    () =>
      filterReceivables(
        allEvents,
        scope,
        today,
        "",
        eventType,
      ),
    [
      allEvents,
      scope,
      today,
      eventType,
    ],
  );
  const uptownHallFeeTotals = useMemo(() => {
  const uptownEvents = allEvents.filter(
    (event) =>
      event.venueName.trim() === "אפטאון" &&
      event.venueHallFeeGuestCount > 0,
  );

  return {
    chargedGuestCount: uptownEvents.reduce(
      (sum, event) =>
        sum + event.venueHallFeeGuestCount,
      0,
    ),
    hallFee: uptownEvents.reduce(
      (sum, event) =>
        sum + event.venueHallFee,
      0,
    ),
  };
}, [allEvents]);

  if (query.isLoading) {
    return (
      <div className="grid min-h-96 place-items-center">
        <LoaderCircle className="animate-spin" />
        <span className="sr-only">
          טוען יתרות לגבייה
        </span>
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        onRetry={() => query.refetch()}
      />
    );
  }

  /*
   * הסיכום העליון נשאר הסיכום הכללי.
   */
  const summary =
    calculateReceivablesSummary(
      allEvents,
      allEvents,
      today,
    );

  /*
   * כל האולמות לצורך ה-select.
   */
  const availableVenues =
    groupByVenue(allEvents);

   

  /*
   * כרטיסי האולמות מכבדים את התקופה.
   */
  const venueCards =
    groupByVenue(venueScopeEvents);

  /*
   * טבלת האולם מכבדת גם את venueId.
   */
  const venueRows =
    groupByVenue(filtered);

  /*
   * יתרות לקוחות.
   */
  const customerRows = filtered.filter(
    (event) =>
      event.payerType === "client",
  );

  const eventTypes = [
    ...new Set(
      allEvents.map(
        (event) => event.eventType,
      ),
    ),
  ].sort((a, b) =>
    translateStoredValue(a).localeCompare(
      translateStoredValue(b),
      "he",
    ),
  );

  /*
   * ייצוא אולם לפי התקופה שנבחרה.
   */
  const exportVenue = async (
    id: string,
    name: string,
  ) => {
    const rows = venueExportEvents(
      venueScopeEvents,
      today,
      id,
    );

    if (!rows.length) {
      setExportNotice(
        "אין התחשבנות מול אולם זה בתקופה שנבחרה",
      );
      return;
    }

    setExportNotice("");

    const { exportVenueWorkbook } =
      await import(
        "../exporters/venue-receivables-excel"
      );

    exportVenueWorkbook(
      id,
      name,
      venueScopeEvents,
      today,
    );
  };

  const exportCustomers = async () => {
    const rows = customerExportEvents(
      allEvents,
      today,
    );

    if (!rows.length) {
      setExportNotice(
        "אין יתרות לקוחות פתוחות לייצוא",
      );
      return;
    }

    setExportNotice("");

    const { exportCustomerWorkbook } =
      await import(
        "../exporters/customer-receivables-excel"
      );

    exportCustomerWorkbook(
      rows,
      today,
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* HEADER */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            כספים
          </p>

          <h2 className="mt-1 text-2xl font-semibold">
            יתרות לגבייה
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            היתרות מבוססות רק על אירועים
            שהתקיימו עד היום ועל תשלומים
            שנרשמו בפועל.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void exportCustomers()
          }
        >
          <Download />
          ייצוא יתרות לקוחות
        </Button>
      </header>

      {exportNotice && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {exportNotice}
        </p>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="יתרה כוללת לגבייה"
          value={
            summary.totalOpenBalance
          }
        />

        <Kpi
          label="יתרה מאולמות"
          value={summary.venueBalance}
        />

        <Kpi
          label="יתרה מלקוחות"
          value={
            summary.customerBalance
          }
        />

        <Kpi
          label="גבייה בחודש הנוכחי"
          value={
            summary.currentMonthReceivables
          }
        />
      </div>

      {/* VENUE CARDS */}
      <section>
        <h3 className="mb-3 text-lg font-semibold">
          יתרה לפי אולם
        </h3>

        {venueCards.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {venueCards.map(
              (venue) => {
                const settlement =
                  venue.venueSettlement;

                return (
                  <div
                    key={venue.venueId}
                    className={`rounded-xl border bg-card p-4 shadow-sm transition ${
                      venueId ===
                      venue.venueId
                        ? "border-primary ring-2 ring-primary/15"
                        : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setVenueId(
                          venue.venueId,
                        );
                        setDetails(null);
                      }}
                      className="w-full text-right"
                    >
                      <p className="font-medium">
                        {venue.venueName}
                      </p>

                      <p
                        className={`mt-2 text-xl font-semibold ${
                          settlement > 0
                            ? "text-red-600"
                            : settlement < 0
                              ? "text-amber-600"
                              : "text-emerald-600"
                        }`}
                      >
                        {settlement > 0
                          ? "לקבל מהאולם: "
                          : settlement < 0
                            ? "לשלם לאולם: "
                            : "יתרה מול האולם: "}

                        {formatMoney(
                          Math.abs(
                            settlement,
                          ),
                        )}
                      </p>

                     {venue.hallFee > 0 && (
  <p className="mt-1 text-xs text-muted-foreground">
    עמלות אולם בתקופה:{" "}
    {formatMoney(venue.hallFee)}
  </p>
)}

{venue.venueName.trim() === "אפטאון" && (
  <div className="mt-3 border-t border-border pt-3">
    <p className="text-sm font-semibold">
      אורחים שחויבו בעמלה עד כה:{" "}
      {uptownHallFeeTotals.chargedGuestCount.toLocaleString(
        "he-IL"
      )}
    </p>

    <p className="mt-1 text-xs text-muted-foreground">
      סה״כ עמלות אפטאון עד כה:{" "}
      {formatMoney(
        uptownHallFeeTotals.hallFee
      )}
    </p>
  </div>
)}

<p className="mt-2 text-xs text-muted-foreground">
  {venue.eventCount} אירועים בהתחשבנות
</p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {venue.eventCount}{" "}
                        אירועים בהתחשבנות
                      </p>
                    </button>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() =>
                        void exportVenue(
                          venue.venueId,
                          venue.venueName,
                        )
                      }
                    >
                      <Download />
                      ייצוא דוח אקסל
                    </Button>
                  </div>
                );
              },
            )}
          </div>
        ) : (
          <Empty text="אין התחשבנות מול אולמות בתקופה שנבחרה" />
        )}
      </section>

      {/* FILTERS */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            תקופה

            <select
              value={scope}
              onChange={(event) => {
                setScope(
                  event.target
                    .value as ReceivablesScope,
                );

                setDetails(null);
              }}
              className={selectClass}
            >
              <option value="current">
                החודש הנוכחי
              </option>

              <option value="previous">
                החודש הקודם
              </option>

              <option value="next">
                החודש הבא — תחזית לא מוצגת
              </option>

              <option value="all">
                הכול עד היום
              </option>
            </select>
          </label>

          <label className="text-sm">
            אולם

            <select
              value={venueId}
              onChange={(event) => {
                setVenueId(
                  event.target.value,
                );
                setDetails(null);
              }}
              className={selectClass}
            >
              <option value="">
                כל האולמות
              </option>

              {availableVenues.map(
                (venue) => (
                  <option
                    key={venue.venueId}
                    value={
                      venue.venueId
                    }
                  >
                    {venue.venueName}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="text-sm">
            סוג אירוע

            <select
              value={eventType}
              onChange={(event) => {
                setEventType(
                  event.target.value,
                );
                setDetails(null);
              }}
              className={selectClass}
            >
              <option value="">
                כל סוגי האירועים
              </option>

              {eventTypes.map(
                (type) => (
                  <option
                    key={type}
                    value={type}
                  >
                    {translateStoredValue(
                      type,
                    )}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        {venueId && (
          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const venue =
                  availableVenues.find(
                    (item) =>
                      item.venueId ===
                      venueId,
                  );

                if (venue) {
                  void exportVenue(
                    venue.venueId,
                    venue.venueName,
                  );
                }
              }}
            >
              <Download />
              ייצוא אקסל לאולם שנבחר
            </Button>
          </div>
        )}
      </section>

      {/* TABLES */}
      <div className="grid gap-6 xl:grid-cols-2">
        <VenueTable
          rows={venueRows}
          onOpen={(
            venueName,
            events,
          ) =>
            setDetails({
              title: `התחשבנות מול אולם — ${venueName}`,
              events:
                unsettledVenueEvents(
                  events,
                ),
              mode: "venue",
            })
          }
        />

        <CustomerTable
          rows={customerRows}
          onOpen={(customer) =>
            setDetails({
              title: `אירועים פתוחים — ${customer.clientName}`,
              events: unpaidEvents(
                customerRows.filter(
                  (event) =>
                    event.clientName ===
                      customer.clientName &&
                    event.clientPhone ===
                      customer.clientPhone,
                ),
              ),
              mode: "customer",
            })
          }
        />
      </div>

      {details && (
        <Details
          details={details}
          onClose={() =>
            setDetails(null)
          }
        />
      )}
    </div>
  );
}

/* =========================================================
   VENUE TABLE
   ========================================================= */

function VenueTable({
  rows,
  onOpen,
}: {
  rows: ReturnType<
    typeof groupByVenue
  >;

  onOpen: (
    name: string,
    events: ReceivableEvent[],
  ) => void;
}) {
  const eventRows = rows.flatMap(
    (venue) =>
      venue.events.map(
        (event) => ({
          venue,
          event,
        }),
      ),
  );

  return (
    <section>
      <h3 className="mb-3 text-lg font-semibold">
        לפי אולם
      </h3>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-right text-sm">
          <thead className="bg-muted/50">
            <tr>
              {[
                "אולם",
                "אירוע",
                "משלם",
                "אורחים",
                "יתרה לפני עמלה",
                "עמלה לאולם",
                "יתרה מול האולם",
              ].map((label) => (
                <th
                  className="px-4 py-3 font-medium"
                  key={label}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {eventRows.map(
              ({ venue, event }) => (
                <tr
                  key={event.id}
                  className="border-t border-border"
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() =>
                        onOpen(
                          venue.venueName,
                          venue.events,
                        )
                      }
                    >
                      {venue.venueName}
                    </button>
                  </td>

                  <td className="px-4 py-3">
                    <Link
                      className="hover:underline"
                      href={`/events?event=${event.id}`}
                    >
                      {formatDate(
                        event.eventDate,
                      )}{" "}
                      · {event.clientName}
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    {event.payerType ===
                    "venue"
                      ? "אולם"
                      : "לקוח"}
                  </td>

                  <td className="px-4 py-3">
                    {event.guestCount.toLocaleString(
                      "he-IL",
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {formatMoney(
                      event.venueSettlementBeforeHallFee,
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {event.venueHallFee >
                    0
                      ? `-${formatMoney(
                          event.venueHallFee,
                        )}`
                      : "—"}
                  </td>

                  <td className="px-4 py-3">
                    <SettlementBalance
                      value={
                        event.venueSettlement
                      }
                    />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>

        {!eventRows.length && (
          <Empty text="אין התחשבנות מול אולמות בתקופה שנבחרה" />
        )}
      </div>
    </section>
  );
}

/* =========================================================
   CUSTOMER TABLE
   ========================================================= */

function CustomerTable({
  rows,
  onOpen,
}: {
  rows: ReceivableEvent[];

  onOpen: (
    event: ReceivableEvent,
  ) => void;
}) {
  return (
    <section>
      <h3 className="mb-3 text-lg font-semibold">
        לפי לקוח
      </h3>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[600px] text-right text-sm">
          <thead className="bg-muted/50">
            <tr>
              {[
                "לקוח",
                "אירוע",
                "סטטוס",
                "יתרה",
              ].map((label) => (
                <th
                  className="px-4 py-3 font-medium"
                  key={label}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((event) => (
              <tr
                key={event.id}
                className="border-t border-border"
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() =>
                      onOpen(event)
                    }
                  >
                    {event.clientName}
                  </button>
                </td>

                <td className="px-4 py-3">
                  <Link
                    className="hover:underline"
                    href={`/events?event=${event.id}`}
                  >
                    {formatDate(
                      event.eventDate,
                    )}{" "}
                    ·{" "}
                    {translateStoredValue(
                      event.eventType,
                    )}
                  </Link>
                </td>

                <td className="px-4 py-3">
                  {
                    statusLabels[
                      event.paymentStatus
                    ]
                  }
                </td>

                <td className="px-4 py-3">
                  <Balance
                    value={
                      event.outstanding
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!rows.length && (
          <Empty text="אין יתרות לקוחות פתוחות בתקופה שנבחרה" />
        )}
      </div>
    </section>
  );
}

/* =========================================================
   DETAILS
   ========================================================= */

function Details({
  details,
  onClose,
}: {
  details: NonNullable<OpenDetails>;
  onClose: () => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">
          {details.title}
        </h3>

        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          סגירה
        </Button>
      </div>

      {details.events.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {details.events.map(
            (event) => (
              <Link
                key={event.id}
                href={`/events?event=${event.id}`}
                className="rounded-lg border border-border p-4 transition hover:border-primary/40"
              >
                <p className="font-medium">
                  {formatDate(
                    event.eventDate,
                  )}{" "}
                  ·{" "}
                  {translateStoredValue(
                    event.eventType,
                  )}
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {event.clientName} ·{" "}
                  {event.venueName}
                </p>

                {details.mode ===
                "venue" ? (
                  <VenueEventDetails
                    event={event}
                  />
                ) : (
                  <CustomerEventDetails
                    event={event}
                  />
                )}

                <p className="mt-3 text-xs text-muted-foreground">
                  משלם:{" "}
                  {event.payerType ===
                  "venue"
                    ? "אולם"
                    : "לקוח"}
                </p>
              </Link>
            ),
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-emerald-600">
          אין יתרה פתוחה
        </p>
      )}
    </section>
  );
}

function VenueEventDetails({
  event,
}: {
  event: ReceivableEvent;
}) {
  return (
    <dl className="mt-3 space-y-2 rounded-md bg-muted/60 p-3 text-sm">
      <DetailRow
        label="יתרה לפני עמלה"
        value={formatMoney(
          event.venueSettlementBeforeHallFee,
        )}
      />

      {event.venueHallFee > 0 && (
  <DetailRow
    label={`עמלה לאולם (${event.venueHallFeePerGuest} ₪ × ${event.venueHallFeeGuestCount.toLocaleString(
      "he-IL"
    )} אורחים לחיוב)`}
    value={`-${formatMoney(
      event.venueHallFee
    )}`}
  />
)}

      <DetailRow
        label="יתרה מול האולם"
        value={formatMoney(
          event.venueSettlement,
        )}
        emphasized
      />

      {event.venueSettlement <
        0 && (
        <p className="text-xs font-medium text-amber-700">
          לתשלום לאולם:{" "}
          {formatMoney(
            Math.abs(
              event.venueSettlement,
            ),
          )}
        </p>
      )}

      {event.venueSettlement >
        0 && (
        <p className="text-xs font-medium text-red-600">
          לקבל מהאולם:{" "}
          {formatMoney(
            event.venueSettlement,
          )}
        </p>
      )}
    </dl>
  );
}

function CustomerEventDetails({
  event,
}: {
  event: ReceivableEvent;
}) {
  return (
    <dl className="mt-3 space-y-2 rounded-md bg-muted/60 p-3 text-sm">
      <DetailRow
        label="יתרה לגבייה מהלקוח"
        value={formatMoney(
          event.outstanding,
        )}
        emphasized
      />

      <DetailRow
        label="סטטוס"
        value={
          statusLabels[
            event.paymentStatus
          ]
        }
      />
    </dl>
  );
}

/* =========================================================
   SMALL COMPONENTS
   ========================================================= */

function DetailRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 ${
        emphasized
          ? "border-t border-border pt-2 font-semibold"
          : ""
      }`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Kpi({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p
        className={`mt-2 text-lg font-semibold ${
          value > 0
            ? "text-red-600"
            : value < 0
              ? "text-amber-600"
              : "text-emerald-600"
        }`}
      >
        {formatMoney(value)}
      </p>
    </div>
  );
}

function Balance({
  value,
}: {
  value: number;
}) {
  return (
    <span
      className={`font-medium ${
        value > 0
          ? "text-red-600"
          : "text-emerald-600"
      }`}
    >
      {formatMoney(value)}
    </span>
  );
}

function SettlementBalance({
  value,
}: {
  value: number;
}) {
  if (value > 0) {
    return (
      <div>
        <span className="font-semibold text-red-600">
          {formatMoney(value)}
        </span>

        <p className="mt-0.5 text-xs text-muted-foreground">
          לקבל מהאולם
        </p>
      </div>
    );
  }

  if (value < 0) {
    return (
      <div>
        <span className="font-semibold text-amber-600">
          -{formatMoney(
            Math.abs(value),
          )}
        </span>

        <p className="mt-0.5 text-xs text-muted-foreground">
          לשלם לאולם
        </p>
      </div>
    );
  }

  return (
    <span className="font-medium text-emerald-600">
      {formatMoney(0)}
    </span>
  );
}

function Empty({
  text = "אין יתרה פתוחה",
}: {
  text?: string;
}) {
  return (
    <p className="p-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function ErrorState({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-96 place-items-center rounded-xl border border-dashed border-destructive/40 bg-card p-8 text-center">
      <div>
        <AlertCircle className="mx-auto text-destructive" />

        <p className="mt-3">
          לא ניתן לטעון את היתרות
          לגבייה.
        </p>

        <Button
          className="mt-4"
          onClick={onRetry}
        >
          נסה שוב
        </Button>
      </div>
    </div>
  );
}

const selectClass =
  "mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3";