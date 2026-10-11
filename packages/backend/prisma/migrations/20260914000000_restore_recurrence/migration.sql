CREATE TABLE "Recurrence" (
    "id" TEXT NOT NULL,
    "isMultiDay" BOOLEAN,
    "recurringStartDate" TEXT NOT NULL,
    "recurringEndDate" TEXT NOT NULL,
    "recurringDays" INTEGER[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Recurrence_pkey" PRIMARY KEY ("id")
);

-- Keep every legacy ID; only classify shapes with unambiguous evidence.
WITH parsed AS (
    SELECT b."recurrenceId", b.id, b."startTime", b."endTime", p."carId", p.date,
           CASE WHEN p.date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                     AND LEFT(p.date, 4) <> '0000'
                THEN MAKE_DATE(LEFT(p.date, 4)::INTEGER, SUBSTRING(p.date, 6, 2)::INTEGER, 1)
                     + RIGHT(p.date, 2)::INTEGER - 1 END AS day
    FROM "Booking" b
    JOIN "DateCarBooking" p ON p.id = b."parentId"
    WHERE b."recurrenceId" IS NOT NULL
), ordered AS (
    SELECT *,
           ROW_NUMBER() OVER series AS position,
           LAG(day) OVER series AS previous_day,
           LAG("endTime") OVER series AS previous_end
    FROM parsed
    WINDOW series AS (PARTITION BY "recurrenceId" ORDER BY date, "startTime", id)
), classified AS (
    SELECT "recurrenceId",
           MIN(date) AS start_date,
           MAX(date) AS end_date,
           COALESCE(
             ARRAY_AGG(DISTINCT (EXTRACT(ISODOW FROM day)::INTEGER - 1)
                       ORDER BY (EXTRACT(ISODOW FROM day)::INTEGER - 1))
               FILTER (WHERE day IS NOT NULL AND TO_CHAR(day, 'YYYY-MM-DD') = date),
             ARRAY[]::INTEGER[]
           ) AS weekdays,
           COUNT(*) AS entries,
           COUNT(DISTINCT "carId") = 1 AND COUNT(DISTINCT date) = COUNT(*)
             AND BOOL_AND(COALESCE(TO_CHAR(day, 'YYYY-MM-DD') = date, FALSE))
             AND BOOL_AND("startTime" >= 0 AND "endTime" <= 1440 AND "startTime" < "endTime") AS valid,
           BOOL_AND(position = 1 OR
                    ("startTime" = 0 AND previous_end = 1440 AND day = previous_day + 1)) AS joined,
           BOOL_AND("startTime" = 0 AND "endTime" = 1440) AS all_full_day,
           MIN("startTime") = MAX("startTime") AND MIN("endTime") = MAX("endTime") AS same_times,
           BOOL_AND("startTime" > 0 AND "endTime" < 1440) AS interior_times
    FROM ordered
    GROUP BY "recurrenceId"
)
INSERT INTO "Recurrence" ("id", "isMultiDay", "recurringStartDate", "recurringEndDate",
                          "recurringDays", "updatedAt")
SELECT "recurrenceId",
       CASE
         WHEN "recurrenceId" = '' THEN NULL
         WHEN valid AND entries >= 2 AND joined AND NOT all_full_day THEN TRUE
         WHEN valid AND (interior_times OR (entries >= 2 AND same_times AND NOT all_full_day)) THEN FALSE
         ELSE NULL
       END,
       start_date, end_date, weekdays, CURRENT_TIMESTAMP
FROM classified;

CREATE INDEX "Booking_recurrenceId_idx" ON "Booking"("recurrenceId");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_recurrenceId_fkey"
  FOREIGN KEY ("recurrenceId") REFERENCES "Recurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "DateCarBooking" p SET "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
    SELECT 1 FROM "Booking" b WHERE b."parentId" = p.id AND b."recurrenceId" IS NOT NULL
);
