# דיווח נוכחות פרטי דרך WhatsApp

החל ממיגרציה 022 נוספו סיכום ואישור/ביטול דו־כיווניים באותו Webhook ובאותו תור שליחה. הוראות ההרחבה, הרשאות ותבניות נמצאות ב־[whatsapp-attendance-bot.md](whatsapp-attendance-bot.md). הסעיפים להלן מתארים גם את מסלול האישור המקורי באפליקציה, שנשאר פעיל.

## החיבור שנמצא

הספק הקיים הוא **Meta WhatsApp Cloud API**, דרך `src/lib/whatsapp/client.ts`. השליחה משתמשת ב־Graph API ובאותם `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`. אין Twilio או ספק נוסף.

מפת הקוד הקיים: `src/lib/whatsapp/*` (לקוח, תבניות, תזמון, תור התראות, טלפונים והרשאות cron); `src/app/api/whatsapp/{trigger,settings,notifications}/route.ts`; `src/app/api/webhooks/whatsapp/route.ts`; `src/app/api/cron/whatsapp-notifications/route.ts`; `src/features/settings/components/whatsapp-{settings-card,notifications-page}.tsx`; `src/app/(dashboard)/settings/whatsapp-notifications/page.tsx`; `supabase/functions/whatsapp-notifications/{index.ts,deno.json}`; מיגרציה 010. החדשים מתועדים בהמשך.

ה־Webhook הקיים טיפל בסטטוסי מסירה בלבד. הוא הורחב לקליטת הודעות, תוך שמירה על GET לאימות Meta ועל עדכוני סטטוס ההתראות הקיימות. לא נוסף Webhook מתחרה. ה־cron הקיים הורחב לעיבוד תור הנוכחות והאישורים, וה־Edge Function הקיים ממשיך לקרוא לו.

המערכת משתמשת באותם `events`, `employees`, `event_assignments`, וב־`attendance-service.ts` ו־`attendance.ts` שהתווספו במיגרציה 019. שירותי האירועים נמצאים ב־`features/events/services`, שיבוצים ב־`features/event-staffing/services`, וחישובי שכר ב־`features/event-staffing/calculations.ts` ו־`features/payroll/utils/payroll-calculations.ts`. לא נוספו טבלאות עובדים/אירועים/נוכחות מתחרות.

## הגדרות נדרשות

1. להחיל את **020_whatsapp_attendance_inbox.sql** אחרי 019 והתלויות שלה. המיגרציה יוצרת תור קליטה, הרשאות שולחים, outbox אישורים ו־audit. היא לא משנה שעות קיימות. לא הוחלה אוטומטית על Supabase המרוחק.
2. להגדיר בשרת **WHATSAPP_APP_SECRET** מתוך אפליקציית Meta. בבדיקת `.env.local` נמצא שהוא **חסר**. `WHATSAPP_VERIFY_TOKEN` אינו תחליף ל־App Secret. ה־POST כעת מסרב לכל בקשה בלי סוד חתימה, גם בפיתוח; אין מעקף אימות.
3. ב־Meta להגדיר את אותו callback קיים: `https://<app>/api/webhooks/whatsapp`, לאמת באמצעות ה־Verify Token הקיים, ולהפעיל subscription לשדה **messages** עבור החשבון והמספר הקיימים. לוודא הרשאת `whatsapp_business_messaging`, שהאפליקציה מחוברת ל־WABA הנכון ושהיא במצב המתאים לקבלת הודעות אמיתיות. מצב ההרשמה החיצוני לא אומת מתוך המאגר.
4. לוודא שה־cron/Edge Function הקיים קורא `/api/cron/whatsapp-notifications` עם `Authorization: Bearer <CRON_SECRET>` בקביעות, למשל כל דקה. כל קריאה מטפלת בדיווח אחד ואישור אחד נוסף להתראות הרגילות. הגדלת תדירות/מספר workers אפשרית: claim משתמש ב־SKIP LOCKED. המסלול מוגדר עם maxDuration=300; יש לוודא שתוכנית האירוח מאפשרת זאת.
5. כ־owner לפתוח **Tayo AI → דיווחי נוכחות מ־WhatsApp → הרשאת שולחי דיווחים**. לשייך מספר נייד ישראלי לחשבון owner/manager קיים ולשמור לאחר אימות הבעלות על המספר מול אותו מנהל. מספר עובד בטבלת employees לבדו אינו הרשאת ניהול. אפשר להשבית מספר בלי למחוק את ההיסטוריה. הרשימה מציגה חשבונות מתוך 1,000 משתמשי האימות הראשונים; יש להרחיב pagination אם יידרש היקף גדול יותר.
6. `OPENAI_API_KEY` ופרטי Supabase הקיימים משמשים לפענוח. בבדיקת שמות משתני הסביבה נמצאו מוגדרים פרטי Meta לשליחה, Verify Token, Cron Secret, Supabase ו־OpenAI, בלי להדפיס ערכים.

## תהליך ורמת אמינות

- חתימת `X-Hub-Signature-256` נבדקת על **הבתים המקוריים**, עם App Secret ו־timing-safe comparison. מתקבלים רק דיווחי טקסט פרטיים עם `from` תקין ולמספר Meta המוגדר. הודעות מדיה, הודעות ללא מספר טלפון (למשל זיהוי BSUID בלבד) ושולחים לא מורשים אינם מעובדים. רשימת הטלפונים מוגדרת דרך UI ישראלי; אין ניחוש זהות לפי שם WhatsApp.
- גוף Webhook מוגבל ל־3 MiB; כשל בשמירה עמידה מחזיר 503 כדי ש־Meta תנסה שוב. הודעות מורשות נשמרות לפני ACK. `provider_message_id` ייחודי מונע קליטה כפולה. קיימת מגבלת 30 הודעות בשעה לכל שולח מורשה; מעבר למכסה ה־Webhook מחזיר כשל זמני כדי ש־Meta תנסה את המסירה שוב מאוחר יותר; דיווחים שכבר נקלטו ממשיכים להיות מזוהים ככפולים.
- תור PostgreSQL עם lease של שתי דקות, token לכל claim, עד חמישה ניסיונות ו־backoff. worker שנפל ניתן להחלפה לאחר פקיעת lease; worker ישן אינו יכול לעדכן את ניסיון העיבוד החדש. כשל סופי מוצג באפליקציה וניתן לנסות שוב ידנית.
- עיבוד נפרד מה־Webhook משתמש ב־OpenAI Structured Outputs ובוולידציה הדטרמיניסטית הקיימת: תאריך ללא שנה מחפש אירועים אמיתיים, עמימות מחייבת בחירה, אין השלמת שעת יציאה, חצות לפי Asia/Jerusalem, שמות ותפקידים מופרדים, כפילויות והתנגשויות נחסמות. השולח ו־role שלו נבדקים שוב לפני הפענוח ובזמן האישור.
- כברירת מחדל **אין שמירה אוטומטית של שעות**. הדיווח נשמר כ־review, כולל פלט מובנה ותצוגה, ונגיש מחדש לאחר רענון. משתמש owner/manager מאומת באפליקציה פותח תצוגה חדשה, מתקן עובדים ושעות, ומאשר. יצירת שיבוץ חדש מחייבת את אישור השיבוץ הנפרד שכבר קיים בכרטיס. לא נוצרים עובדים או אירועים חדשים.
- אישור נעשה דרך `approve_whatsapp_attendance` כעסקה אטומית: בדיקת reviewer ושולח, בדיקת snapshot ושמירת שעות באמצעות `confirm_ai_attendance`, מעבר ל־approved, audit ויצירת outbox אישור יחיד. אין הפעלה מחדש של הפעולה העסקית לצורך retry של הודעת אישור. API הנוכחות הרגיל אינו מאשר הצעה שמקושרת לדיווח WhatsApp.
- השכר נשאר מחושב לפי נתוני השיבוץ וכללי המערכת הקיימים. מסכי manager ותוכן אישור WhatsApp אינם מכילים נתוני שכר. לאחר אישור מתרעננים React Query ומסכי האירוע/שכר.
- GET של תיבת הדיווחים זמין ל־owner/manager בלבד; הגדרת שולחים ל־owner בלבד. הדפדפן אינו מקבל גישה ישירה לטבלאות או ל־RPC הפרטיים. שינויים בהגדרות, דחייה, retry ואישור מתועדים.

## הודעת אישור

לאחר שמירה מוצלחת בלבד נוצר אישור בתור נפרד, שנשלח דרך **אותו לקוח Meta ואותו מספר**. בתוך חלון השירות של Meta נשלחת הודעת טקסט ללא שכר. מחוץ לחלון נדרשת תבנית מאושרת:

- ליצור ב־Meta תבנית אישור נוכחות בשפה המתאימה, **ללא פרמטרים**, ולשים את שמה ב־`WHATSAPP_TEMPLATE_ATTENDANCE_RECEIPT`.
- `WHATSAPP_TEMPLATE_LANGUAGE_CODE` קובע שפה, ברירת מחדל `he`.
- ללא תבנית כשהחלון סגור, השעות נשארות שמורות והאפליקציה מציגה שנדרשת תבנית לאישור. לאחר ההגדרה אפשר לנסות שליחה מחדש מההיסטוריה.
- מזהה הודעה שמתקבל מ־Meta מציין קבלה לשליחה; סטטוס מסירה/קריאה מתעדכן מה־Webhook. שליחה ל־Meta היא at-least-once: אם Meta קיבלה הודעה והשרת נפל לפני שמירת מזהה ההודעה, ניסיון חוזר עלול לשלוח **אישור כפול**, אך לא לשמור שעות שוב. אין הבטחת exactly-once מול API חיצוני בלי תמיכת idempotency שלו.

## שמירה אוטומטית עתידית

כבויה כברירת מחדל, ונדרשים **שני תנאים**: owner מסמן אישור עבור מספר מסוים ב־UI, וגם השרת מוגדר עם `WHATSAPP_ATTENDANCE_AUTO_SAVE_ENABLED=true`. אין להפעיל את משתנה השרת בשלב אישור ידני.

גם לאחר הפעלה: רק אירוע יחיד, עובדים מזוהים חד־משמעית, שורות ללא שגיאות, עובדים שכבר משובצים וכל שעותיהם הקודמות ריקות. אין יצירת שיבוצים אוטומטית או דריסה אוטומטית של שעות קיימות. בדיקת הרשאת השולח ו־auto_save חוזרת ב־transaction. כל מקרה אחר נשאר לבדיקה באפליקציה.

## בדיקת דיווח אמיתי

1. להכין סביבת בדיקה עם אירוע קיים בקסנאדו בתאריך המבוקש ושמונה עובדים קיימים. להוסיף מראש שיבוצים, או לאשר הוספתם בכרטיס.
2. להחיל מיגרציות, להגדיר חתימה ו־subscription, ולרשום מספר מנהל דרך owner באפליקציה.
3. לשלוח מהמספר האישי את דוגמת ההגעה/יציאה בהודעה אחת למספר העסקי הקיים.
4. להריץ/להמתין ל־cron. לפתוח Tayo AI ולוודא שהדיווח „ממתין לאישור”, שהאירוע הנכון נבחר, ושיש שמונה עובדים; נדב עם הערת פתיחה, רועי לוי רק כשההתאמה ודאית, והיציאות למחרת.
5. לאשר ולבדוק `event_assignments`, מסך האירוע והשכר. להמתין לקריאת cron נוספת לאישור WhatsApp ולוודא סטטוס מסירה.
6. לשלוח שוב את **אותו Webhook**/message ID ולוודא שאין קליטה נוספת; הדבקת אותה רשימה בהודעה חדשה אמורה לעדכן/לשחזר תוצאה בלי שיבוץ כפול. לבדוק גם שני מאשרים במקביל, שליחת דיווח ממספר לא מורשה ושינוי שעות ידני לפני אישור.
7. לבדוק כיבוי הרשאת שולח אחרי הקליטה: הדיווח אינו יכול להישמר. לבדוק כשל OpenAI, התאוששות lease, שדות חסרים ועמימות. לא אמורות להשתנות שעות לפני אישור.

בדיקות אוטומטיות: בדיקות חתימות ו־Webhook, API והרשאות, worker והודעות אישור; בדיקות PostgreSQL מקומי ב־`attendance-db.test.ts` מחילות 019 ו־020 ובודקות dedupe, leases, אישור אטומי, outbox והרשאות. אין בבדיקות שליחה אמיתית ל־WhatsApp או כתיבה למסד המרוחק.

## קבצים שנוספו או עודכנו במימוש

- `supabase/migrations/020_whatsapp_attendance_inbox.sql`
- `src/app/api/webhooks/whatsapp/route.ts`
- `src/app/api/cron/whatsapp-notifications/route.ts`
- `src/app/api/whatsapp/attendance/route.ts`
- `src/lib/whatsapp/client.ts`
- `src/lib/whatsapp/webhook.ts`
- `src/lib/whatsapp/attendance-worker.ts`
- `src/features/ai-assistant/whatsapp-inbox-http.ts`
- `src/features/ai-assistant/whatsapp-inbox.tsx`
- `src/features/ai-assistant/attendance-service.ts`
- `src/features/ai-assistant/attendance-card.tsx`
- `src/app/(dashboard)/ai-assistant/page.tsx`
- `src/lib/whatsapp/webhook.test.ts`
- `src/lib/whatsapp/attendance-worker.test.ts`
- `src/features/ai-assistant/whatsapp-inbox-http.test.ts`
- `src/features/ai-assistant/attendance-db.test.ts`
- `src/features/ai-assistant/attendance-http.test.ts`
- `docs/whatsapp-attendance.md`

TypeScript, build ו־lint על הקבצים ששונו עברו. בדיקות הנוכחות, התור, Webhook ו־API עברו, כולל PostgreSQL מקומי וגלגול לאחור כשה־outbox נכשל. בסוויטה הכללית נותרו שתי בדיקות תבניות WhatsApp קיימות שנכשלו עוד לפני השינוי: `hello_world has no body parameters` ו־`owner custom work-time parameters may include salary`; המימוש והתבניות שלהן לא שונו כאן.

מקור לתמיכת קבלת ההודעות ולמבנה האירועים: [Meta webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview).

## תיקון שמירת הרשאת שולח — מיגרציה 021

הטופס „שמירת הרשאת שולח” שולח `POST /api/whatsapp/attendance` עם `action=configure`. השרת מאמת session דרך Supabase, מוודא role מסוג owner, מנרמל את המספר וקורא דרך service role ל־`configure_whatsapp_attendance_sender(p_actor,p_phone,p_user,p_enabled,p_auto)`. מקור `p_actor` הוא המשתמש המאומת בלבד. הקוד אינו יוצר עובד או אירוע ואינו קורא ל־OpenAI או ל־Meta בפעולה זו.

באבחון קריאה בלבד של פרויקט Supabase המחובר ב־`.env.local` נמצאו כל הטבלאות והעמודות הצפויות, אימות admin הצליח, ו־`checkpoint_ai_turn` ממיגרציה 018 ו־`confirm_ai_attendance` ממיגרציה 019 היו זמינים. לעומת זאת `configure_whatsapp_attendance_sender` ו־`review_whatsapp_attendance` לא נחשפו במטא־דאטה, וחתימת `approve_whatsapp_attendance` הכילה שלושה פרמטרים, לעומת ארבעה בקובץ 020 המקומי. בדיקת GET בעסקה לקריאה בלבד עם פרמטרים סינתטיים לא תקינים החזירה **404 / PGRST202** עבור פונקציית השמירה. משמעות הממצא: חוזה ה־RPC חסר או אינו מעודכן במטמון הסכמה; אין להסיק שהטבלאות חסרות או להריץ את 020 מחדש באופן עיוור.

ה־catch הישן ב־`whatsapp-inbox-http.ts` סיווג כל חריגה כ־503 והסתיר את הקוד הזה. כעת השגיאות ממוינות: חסר RPC/טבלה/עמודה או כשל פנימי → 500 עם קוד בטוח; הרשאות → 403; קלט לא תקין → 422; חשבון שנמחק או עדכון מתנגש → 409; timeout → 504; בעיית זמינות חיבור אמיתית → 503. תגובת כשל מכילה `requestId`, קוד אפליקציה וקוד PostgreSQL/PostgREST מסונן. ה־UI מציג את ההסבר ואת מזהה הבדיקה. לוג השרת כולל רק מזהה בדיקה, שלב קבוע, סטטוס וקודים; אין בו טלפון, אימייל, מזהה משתמש, גוף בקשה או שגיאת מסד גולמית.

להחיל רק את **`supabase/migrations/021_whatsapp_sender_configuration_repair.sql`** בפרויקט Supabase הנכון. הקובץ:

- בודק שטבלאות 020 קיימות, בלי ליצור טבלאות עסקיות חלופיות או למחוק מידע.
- יוצר או מחליף באופן אידמפוטנטי את פונקציות ניהול השולחים והסקירה, ומעניק את הרשאות השירות הדרושות בלבד. הרשאת role נבדקת שוב בתוך הפונקציה; משתמש היעד חייב להיות owner/manager קיים.
- משאיר את הטבלאות עם RLS ואת ה־RPC חסום ל־anon/authenticated. רק השירות בשרת רשאי להפעילו.
- שומר עדכון והרשאת שולח יחד עם audit באותה עסקה. נעילות profile דורשות הרשאת UPDATE על עמודה אחת; ניתן grant לעמודת id ל־service_role בלבד לצורך `FOR SHARE`, ללא עדכון ערכי profile או תפקידים בפונקציה.
- שולח `NOTIFY pgrst, 'reload schema'` לאחר השלמת העסקה. אפשר להחיל את 021 שוב בלי לשנות רשומות קיימות.

המיגרציה ממוקדת בניהול השולחים והסקירה. היא אינה מחליפה את פונקציית אישור הנוכחות הפעילה ואינה משנה צ'אט, webhook, הודעות או שעות עבודה. חתימת האישור הישנה שנמצאה דורשת בדיקה נפרדת לפני הפעלת אפשרות השמירה האוטומטית העתידית; ההגדרה נשארת כבויה כברירת מחדל.

שמירת הרשאה עצמה אינה תלויה ב־018 או בקריאה לפונקציות 019. התקנת כלל 020 כן תלויה בטבלת `ai_attendance_imports` ממיגרציה 019 עבור קישורי דיווחים להצעות. אין צורך במשתנה סביבה חדש לשמירת הרשאה: נדרשים פרטי Supabase הקיימים ובפרט `SUPABASE_SERVICE_ROLE_KEY` בשרת, לצד משתמש owner מחובר. `WHATSAPP_APP_SECRET`, פרטי שליחת Meta ו־`OPENAI_API_KEY` משמשים לפעולות אחרות ואינם נדרשים לקריאת configure.

בדיקה בטוחה, ללא כתיבות או הדפסת רשומות:

```
node --env-file=.env.local scripts/check-whatsapp-attendance-schema.mjs
```

הסקריפט בודק עמודות עם `limit(0)`, אימות admin ומטא־דאטה של RPC. אין להעביר פלט הכולל נתוני עסק; הסקריפט עצמו מדפיס רק שמות וקודי מצב. המידע משקף את פרויקט Supabase המוגדר מקומית; יש לוודא שזה גם הפרויקט המוגדר ב־Production.

אימות Production לאחר החלת 021 ופריסת טיפול השגיאות:

1. לוודא שה־RPC configure מופיע עם חמשת שמות הפרמטרים המדויקים וש־review מופיע. אם נותר PGRST202, לבדוק את פרויקט היעד ואת רענון מטמון PostgREST.
2. להיכנס כ־owner, לבחור משתמש owner/manager קיים ולשמור את המספר האישי המורשה. לצפות ל־HTTP 200 ו־`saved:true`, ולהודעת „הרשאת השולח נשמרה בהצלחה”.
3. לרענן ולוודא שהמספר נשאר ברשימה. לעדכן enabled של אותו מספר ולוודא שהרשומה מתעדכנת במקום להיווצר כפילות.
4. לוודא ש־manager אינו יכול להגדיר הרשאות ושמשתמש יעד ללא role מתאים נדחה. במקרה כשל לחפש ב־Vercel Logs את `requestId` בלבד ולהשוות לקוד המוצג באפליקציה; אין להדביק מספר מלא או מפתח בלוגים.

בדיקות התיקון כוללות PostgreSQL מקומי עם הסרת שתי הפונקציות רק ב־fixture כדי לדמות את המצב המרוחק, שתי החלות של 021, שמירת רשומות קיימות, הרשאות מינימליות בפועל (ללא grant גורף), upsert, audit אטומי והרשאות owner/manager/anon. בדיקות API מוודאות סיווג קודים ושהתגובה והלוג אינם מכילים את הקלט או פרטי שגיאת SQL.

בבדיקה המרוחקת גם קריאת טבלת השולחים ללא session נחסמה עם 42501. לא שונו נתונים או סכמה מרוחקים במהלך האבחון. 021 נוצרה ונבדקה מקומית בלבד ויש להחילה בסביבת היעד. בדיקות הפרויקט: 191 מתוך 193 עברו; שתי הכושלות הן בדיקות תבניות WhatsApp הישנות, מחוץ לתיקון זה.
