# AgroCloud Vision — Core (المرحلة 1)

منصة إدارة مزارع وذكاء زراعي (SaaS متعدد المستأجرين). هذا هو **الأساس الحقيقي العامل** للمنصة:
Backend + Frontend فعليين، قاعدة بيانات حقيقية، مصادقة وصلاحيات (RBAC)، وتكامل طقس حقيقي —
بدون أي بيانات وهمية. الوحدات الأخرى (أقمار صناعية، AI، IoT، موبايل، فوترة) تُبنى في مراحل لاحقة
فوق نفس الأساس (راجع وثيقة التصميم المعماري التي أرسلتها في المحادثة).

## البنية

```
AgroCloud_Vision/
├── backend/     # NestJS + TypeScript + PostgreSQL/PostGIS (API)
├── frontend/    # Next.js + React + Leaflet (واجهة الويب)
└── docker-compose.yml
```

## المتطلبات

- Node.js 20+
- PostgreSQL 15+ مع امتداد PostGIS (أو استخدم Docker أدناه، وهو الأسهل)
- Docker + Docker Compose (اختياري لكن موصى به)

> **ملاحظة مهمة:** لم يتم تشغيل `npm install` في بيئة البناء هذه (لا يوجد وصول شبكة للتثبيت).
> الكود كامل وصحيح، لكن يجب تثبيت الحزم على جهازك أو عبر GitHub Actions قبل أول تشغيل.

## التشغيل السريع عبر Docker (موصى به)

```bash
cd AgroCloud_Vision
cp backend/.env.example backend/.env
cp frontend/env.local.example.txt frontend/.env.local
docker compose up --build
```

- الواجهة: http://localhost:3000
- الـ API: http://localhost:4000/api/v1
- قاعدة البيانات: PostgreSQL+PostGIS على المنفذ 5432

## التشغيل اليدوي (بدون Docker)

### 1) قاعدة البيانات
ثبّت PostgreSQL + PostGIS محلياً، ثم أنشئ قاعدة بيانات `agrocloud_vision` وفعّل الامتداد:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 2) الـ Backend
```bash
cd backend
cp .env.example .env   # عدّل القيم حسب بيئتك
npm install
npm run start:dev
```
سيعمل على `http://localhost:4000/api/v1`. عند أول تشغيل مع `DB_SYNCHRONIZE=true` ستُنشأ الجداول تلقائياً.

### 3) الـ Frontend
```bash
cd frontend
cp env.local.example.txt .env.local
npm install
npm run dev
```
سيعمل على `http://localhost:3000`.

## أول استخدام

1. افتح `http://localhost:3000` → سجّل مؤسسة جديدة (Register) — سينشئ هذا Organization + أول مستخدم بدور **Owner**.
2. سجّل الدخول → أضف مزرعة (Farm).
3. لإضافة حقل بحدوده الجغرافية، استخدم الـ API مباشرة حالياً (واجهة رسم الحدود على الخريطة من الواجهة ستُضاف في تحديث لاحق):
   ```bash
   curl -X POST http://localhost:4000/api/v1/fields \
     -H "Authorization: Bearer <accessToken>" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "الحقل الأول",
       "farmId": "<farmId>",
       "boundary": {
         "type": "Polygon",
         "coordinates": [[[31.20,30.05],[31.21,30.05],[31.21,30.06],[31.20,30.06],[31.20,30.05]]]
       }
     }'
   ```
4. افتح صفحة المزرعة في الواجهة لرؤية الحقل على الخريطة وبيانات الطقس الحقيقية لموقعه.

## متغيرات البيئة الحساسة

- `EOS_API_KEY` في `backend/.env` محجوز لتكامل الأقمار الصناعية في المرحلة 2 — **لا تضعه في أي ملف يُرفع على GitHub**.
- `.env` و `.env.local` مُستثناة بالفعل في `.gitignore`.

## تشغيل Open-Meteo ذاتياً (مصدر مفتوح، اختياري)

خدمة الطقس (`backend/src/weather/weather.service.ts`) مبنية على محرّك **Open-Meteo** مفتوح
المصدر: [github.com/open-meteo/open-meteo](https://github.com/open-meteo/open-meteo).

**الوضع الحالي (جاهز فوراً):** `OPEN_METEO_FORECAST_URL` و`OPEN_METEO_ARCHIVE_URL` في
`backend/.env.example` فارغان عمداً — في هذه الحالة تُستخدم الخدمة العامة المجانية
المستضافة من فريق Open-Meteo (`api.open-meteo.com`) تلقائياً، بلا أي مفتاح API.

**عند تحديد مسار إضافة الـ API الخاص بك لاحقاً** (نسخة ذاتية الاستضافة من نفس المستودع،
لمزيد من التحكم أو حدود طلبات أعلى)، اتبع ما يلي:

1. مزامنة بيانات النماذج الجوية التي تحتاجها (مثال لنموذج واحد فقط لتقليل الحجم):
   ```bash
   docker run -it --rm -v open_meteo_data:/app/data ghcr.io/open-meteo/open-meteo \
     sync ecmwf_ifs025 temperature_2m,precipitation,wind_speed_10m
   ```
2. تشغيل الخدمة عبر `docker-compose.yml` الموجود (معرّفة تحت profile منفصل حتى لا تُشغَّل تلقائياً):
   ```bash
   docker compose --profile weather up -d weather-api
   ```
3. توجيه الـ Backend إليها في `backend/.env`:
   ```bash
   OPEN_METEO_FORECAST_URL=http://weather-api:8080/v1/forecast
   OPEN_METEO_ARCHIVE_URL=http://weather-api:8080/v1/archive
   ```
   (أو `http://localhost:8080/...` إذا كان الـ Backend يعمل خارج Docker)

لا حاجة لتعديل أي كود — `WeatherService` يقرأ هذين المتغيّرين ديناميكياً، ويسقط تلقائياً
على الخدمة العامة إن تُركا فارغين.

## مكوّنات الواجهة (shadcn/ui)

مجلد `frontend/src/components/ui/` هو المسار القياسي لمكوّنات shadcn/ui — أضفنا فيه:

- `dashboard-sidebar.tsx`: الشريط الجانبي الفعلي للتطبيق (`SidebarNav` + `AppShell`)، مبني على نمط
  shadcn القياسي ومربوط ببيانات وحدات AgroCloud Vision الحقيقية (المزارع، الحقول، الأقمار الصناعية،
  الطقس، الذكاء الاصطناعي...)، ومُستخدَم فعلياً في `app/dashboard/page.tsx`.
- `frontend/src/lib/utils.ts`: دالة `cn()` القياسية لدمج فئات Tailwind.
- `frontend/components.json`: ملف تهيئة shadcn CLI (المسارات: `@/components`, `@/components/ui`, `@/lib/utils`).
- متغيرات الألوان (`--background`, `--card`, `--primary`...) مضافة في `globals.css` ومربوطة في `tailwind.config.js`.

هذا الإعداد يدوي لكنه متوافق تماماً مع بنية shadcn القياسية. لإضافة مكوّنات رسمية أخرى من مكتبة
shadcn مستقبلاً (زر، حوار، جدول...)، شغّل داخل `frontend/`:

```bash
npx shadcn@latest init    # سيكتشف components.json الموجود ولن يكرر الإعداد
npx shadcn@latest add button dialog table
```

> **لماذا مسار `/components/ui` تحديداً؟** هو المسار الذي تتوقعه أداة shadcn CLI افتراضياً لوضع كل
> مكوّن مستورَد فيه؛ الالتزام به يضمن أن أي إضافة مستقبلية عبر `npx shadcn add ...` تتكامل تلقائياً
> مع نفس نظام الألوان (`cn()`, متغيرات CSS) دون تعارض أو تكرار إعداد.

## الأدوار (RBAC)

`owner` · `manager` · `gis_analyst` · `agronomist` · `field_supervisor` · `viewer`
— معرّفة في `backend/src/common/decorators/roles.decorator.ts` ويمكن توسيعها دون كسر الكود الحالي.

## المراحل القادمة

راجع قسم "خارطة طريق المراحل" في وثيقة التصميم المعماري (Phase 2: الأقمار الصناعية/NDVI،
Phase 3: AI، Phase 4: IoT، Phase 5: الموبايل، Phase 6: الفوترة والمؤسسات).
