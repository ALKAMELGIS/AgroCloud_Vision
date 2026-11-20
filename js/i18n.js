/*
 * AgroCloud Vision — interface language (English / Arabic)
 *
 * Load in <head> before the page renders. English is left-to-right with the sidebar on
 * the left; Arabic is right-to-left, so the whole layout mirrors (sidebar on the right).
 * The map itself always stays left-to-right (Leaflet and the swipe divider need it).
 *
 * Translation: once the page is Arabic, every interface string (text, placeholder, title,
 * aria-label, option) is translated as it appears, from the dictionary below plus a few
 * patterns for numbers, units and dates. User data (field and farm names) is left as typed.
 * Switching language stores the choice and reloads the page.
 */
(function () {
  'use strict';

  let lang = 'en';
  try { lang = localStorage.getItem('lang') === 'ar' ? 'ar' : 'en'; } catch { /* storage off */ }
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';

  // ------------------------------------------------------------ dictionary (English → Arabic)

  const AR = {
    // shell and navigation
    'Workspace': 'مساحة العمل', 'Search': 'بحث', 'Fields': 'الحقول', 'Notifications': 'الإشعارات', 'Monitoring': 'المراقبة',
    'Leaderboard': 'ترتيب الحقول', 'Reports': 'التقارير', 'Weather': 'الطقس', 'Analytics': 'التحليلات', 'Forecast': 'التوقعات',
    'Operations': 'العمليات', 'Field activity log': 'سجل أنشطة الحقول', 'Scout tasks': 'مهام الكشف', 'Precision ag': 'الزراعة الدقيقة',
    'VRA maps': 'خرائط المعدل المتغير', 'Sowing': 'البذر', 'Vegetation': 'الغطاء النباتي', 'P&K': 'الفوسفور والبوتاسيوم', 'Map builder': 'منشئ الخرائط',
    'Soil sampling': 'أخذ عينات التربة', 'Log out': 'تسجيل الخروج', 'Collapse sidebar': 'طي الشريط الجانبي', 'Expand sidebar': 'توسيع الشريط الجانبي',
    'Create farm': 'إنشاء مزرعة', 'New farm': 'مزرعة جديدة', 'Farm name': 'اسم المزرعة', 'New farm name': 'اسم المزرعة الجديدة', 'Create': 'إنشاء',
    'Create group': 'إنشاء مجموعة', 'Add your first farm': 'أضف مزرعتك الأولى', 'Name it, then draw or import its fields on the map': 'سمّها، ثم ارسم حقولها أو استوردها على الخريطة',
    'A farm groups fields together. Switch between farms from the top of the sidebar': 'المزرعة تجمع الحقول معاً. بدّل بين المزارع من أعلى الشريط الجانبي',
    'Search fields, farms, places or actions': 'ابحث في الحقول والمزارع والأماكن والإجراءات', 'Go to': 'انتقال إلى', 'Actions': 'إجراءات', 'Farms': 'المزارع', 'Places': 'أماكن',
    'Language': 'اللغة', 'English': 'English', 'العربية': 'العربية', 'Back to fields': 'العودة إلى الحقول', 'Close': 'إغلاق', 'ESC': 'ESC',
    // map
    'Search location': 'البحث عن موقع', 'Search location or lat, lng': 'ابحث عن موقع أو خط عرض، طول', 'Close search': 'إغلاق البحث', 'Searching': 'جارٍ البحث',
    'No places found': 'لم يُعثر على أماكن', 'Search is not available right now': 'البحث غير متاح الآن',
    'Compare two dates or layers': 'قارن بين تاريخين أو طبقتين', 'Swipe': 'السحب', 'Side by side': 'جنباً إلى جنب', 'Stop comparing': 'إيقاف المقارنة',
    'Swipe: compare two layers with a divider': 'السحب: قارن طبقتين بخط فاصل', 'Side by side: compare two screens': 'جنباً إلى جنب: قارن شاشتين',
    'Drag to compare the two layers': 'اسحب لمقارنة الطبقتين', 'Zoom in': 'تكبير', 'Zoom out': 'تصغير', 'Zoom': 'تكبير إلى الحقل',
    'Measure distance or area': 'قياس مسافة أو مساحة', 'Measure a distance': 'قياس مسافة', 'Distance': 'المسافة', 'Area': 'المساحة', 'Clear': 'مسح',
    'Map credits': 'مصادر الخريطة', 'Imagery © Esri, Maxar, Earthstar Geographics · Leaflet': 'الصور © Esri, Maxar, Earthstar Geographics · Leaflet',
    'Drop to import field boundaries': 'أفلت الملف لاستيراد حدود الحقول', 'Pick a satellite date first': 'اختر تاريخ صورة فضائية أولاً',
    // imagery dock
    'Sentinel-2 source': 'مصدر Sentinel-2', 'Sentinel-2 · Sentinel Hub': 'Sentinel-2 · Sentinel Hub', 'Sentinel-2 · Earth Search': 'Sentinel-2 · Earth Search',
    'Layer': 'الطبقة', 'Natural colour': 'ألوان طبيعية', 'Contrast: stretch colours within each field': 'التباين: مدّ الألوان داخل كل حقل',
    'Show cloudy dates': 'إظهار التواريخ الغائمة', 'Hide imagery': 'إخفاء الصور', 'Period': 'الفترة', 'Earlier': 'الأقدم', 'Later': 'الأحدث',
    'Last 30 days': 'آخر 30 يوماً', 'Last 3 months': 'آخر 3 أشهر', 'Last 5 months': 'آخر 5 أشهر', 'Last 12 months': 'آخر 12 شهراً', 'cloud': 'سحب',
    'contrast': 'تباين', 'Searching Sentinel-2 dates': 'جارٍ البحث عن تواريخ Sentinel-2', 'Add fields to see satellite images': 'أضف حقولاً لرؤية الصور الفضائية',
    'Cloud or shadow': 'سحب أو ظل', 'Bare soil or stress': 'تربة عارية أو إجهاد', 'Sparse vegetation': 'غطاء نباتي متفرق', 'Moderate vegetation': 'غطاء نباتي متوسط',
    'Healthy vegetation': 'غطاء نباتي صحي', 'Dense vegetation': 'غطاء نباتي كثيف', 'Low chlorophyll': 'كلوروفيل منخفض', 'Moderate chlorophyll': 'كلوروفيل متوسط',
    'High chlorophyll': 'كلوروفيل مرتفع', 'Water stress': 'إجهاد مائي', 'Low water content': 'محتوى مائي منخفض', 'Moderate water content': 'محتوى مائي متوسط',
    'High water content': 'محتوى مائي مرتفع', 'Very high water content': 'محتوى مائي مرتفع جداً',
    // fields panel
    'Search fields': 'ابحث في الحقول', 'Sort fields': 'ترتيب الحقول', 'Name': 'الاسم', 'Check fields with risks': 'افحص الحقول المعرّضة للمخاطر',
    'All': 'الكل', 'High NDVI drop': 'انخفاض كبير في NDVI', 'NDVI drop': 'انخفاض NDVI', 'No data': 'لا توجد بيانات', 'No risks': 'لا مخاطر',
    'No crop': 'بدون محصول', 'Add fields': 'إضافة حقول', 'GIS layers': 'طبقات GIS', 'Recently deleted': 'المحذوفة مؤخراً', 'Restore': 'استرجاع',
    'Delete forever': 'حذف نهائي', 'Draw polygon': 'رسم مضلع', 'Draw circle': 'رسم دائرة', 'Select on map': 'التحديد على الخريطة', 'Upload file': 'رفع ملف',
    'Add GIS data': 'إضافة بيانات GIS', 'Draw a polygon field': 'ارسم حقلاً مضلعاً', 'Draw a pivot circle': 'ارسم دائرة محور', 'Select fields on the map': 'حدد الحقول على الخريطة',
    'Upload field boundaries': 'ارفع حدود الحقول', 'Show a file as a reference layer': 'اعرض ملفاً كطبقة مرجعية', 'Add GIS data layer': 'إضافة طبقة بيانات GIS',
    'GeoJSON, KML, KMZ, Shapefile, GDB, GeoPackage': 'GeoJSON, KML, KMZ, Shapefile, GDB, GeoPackage', 'Add as fields': 'إضافة كحقول', 'Remove': 'إزالة',
    'Done': 'تم', 'Select all': 'تحديد الكل', 'Import': 'استيراد', 'Import fields': 'استيراد الحقول', 'Reading file': 'جارٍ قراءة الملف', 'Farm': 'المزرعة',
    'Irrigation': 'الري', 'Not set': 'غير محدد', 'Center pivot': 'محور مركزي', 'Drip': 'تنقيط', 'Sprinkler': 'رشاشات', 'Flood': 'غمر', 'Rainfed': 'بعلي',
    'Cancel': 'إلغاء', 'Add': 'إضافة', 'Open': 'فتح', 'Change': 'تغيير', 'Calculate': 'احسب', 'Delete': 'حذف', 'Undo': 'تراجع',
    'Every field needs a name': 'كل حقل يحتاج إلى اسم', 'Add a farm first': 'أضف مزرعة أولاً',
    // new field and checks
    'New field': 'حقل جديد', 'Field name': 'اسم الحقل', 'Save field': 'حفظ الحقل', 'Discard new field': 'تجاهل الحقل الجديد',
    'Drag the white corners to adjust. Drag a small midpoint to add a corner': 'اسحب الزوايا البيضاء للتعديل. اسحب نقطة المنتصف الصغيرة لإضافة زاوية',
    'Checking the boundary': 'جارٍ فحص الحدود', 'No overlap with saved fields': 'لا تداخل مع الحقول المحفوظة', 'Overlaps a saved field': 'يتداخل مع حقل محفوظ',
    'the outline will be cleaned up on save': 'سيُصحَّح المخطط عند الحفظ', 'This field is already saved as': 'هذا الحقل محفوظ مسبقاً باسم',
    'Cut the overlap and save': 'قص التداخل واحفظ', 'Save with the overlap': 'احفظ مع التداخل', 'Keep editing': 'تابع التعديل',
    'The boundary crosses itself. Move the points so the edges do not cross': 'الحدود تتقاطع مع نفسها. حرّك النقاط حتى لا تتقاطع الأضلاع',
    'The boundary has no area. Its corners lie on one line': 'الحدود بلا مساحة. زواياها على خط واحد', 'The boundary is not a valid polygon': 'الحدود ليست مضلعاً صالحاً',
    'A field needs at least three corners': 'الحقل يحتاج ثلاث زوايا على الأقل', 'Could not save this field': 'تعذّر حفظ هذا الحقل',
    'Duplicates and fields with an invalid shape are always skipped': 'الحقول المكررة وذات الشكل غير الصالح تُتخطّى دائماً',
    'Cut overlaps and import': 'قص التداخلات واستورد', 'Import with overlaps': 'استورد مع التداخلات', 'There is nothing new to import': 'لا يوجد شيء جديد للاستيراد',
    'Earlier boundary restored': 'استُرجعت الحدود السابقة',
    // field panel
    'Edit boundary': 'تعديل الحدود', 'Overview': 'نظرة عامة', 'Crops': 'المحاصيل', 'Activities': 'الأنشطة', 'Save changes': 'حفظ التغييرات',
    'This season': 'هذا الموسم', 'No crop recorded for this season': 'لا يوجد محصول مسجل لهذا الموسم', 'Add crop': 'إضافة محصول', 'Latest activities': 'آخر الأنشطة',
    'Add activity': 'إضافة نشاط', 'Nothing logged yet': 'لم يُسجَّل شيء بعد', 'Weather at this field': 'الطقس في هذا الحقل', 'History': 'السجل',
    'Loading history': 'جارٍ تحميل السجل', 'History is not available': 'السجل غير متاح', 'Current boundary': 'الحدود الحالية', 'Show on map': 'عرض على الخريطة',
    'Restore this boundary': 'استرجع هذه الحدود', 'Field added': 'أُضيف الحقل', 'Boundary edited': 'عُدّلت الحدود', 'Renamed': 'أُعيدت التسمية',
    'Moved to another farm': 'نُقل إلى مزرعة أخرى', 'Irrigation changed': 'تغيّر نوع الري', 'Deleted': 'حُذف', 'Restored': 'استُرجع', 'imported': 'مستورد',
    'first recorded boundary': 'أول حدود مسجلة', 'overlap kept': 'أُبقي التداخل', 'outline cleaned up': 'صُحّح المخطط', 'not set': 'غير محدد',
    'Drag the white points to reshape': 'اسحب النقاط البيضاء لتعديل الشكل', 'Save boundary': 'حفظ الحدود', 'Loading forecast': 'جارٍ تحميل التوقعات',
    'Crop': 'المحصول', 'Variety': 'الصنف', 'Planting date': 'تاريخ الزراعة', 'Expected harvest': 'الحصاد المتوقع', 'Crop history': 'سجل المحاصيل',
    'No crops recorded for this field': 'لا محاصيل مسجلة لهذا الحقل', 'e.g. Alfalfa': 'مثال: برسيم', 'Activity': 'النشاط', 'Date': 'التاريخ', 'Product': 'المنتج',
    'Rate': 'المعدل', 'Unit': 'الوحدة', 'Notes': 'ملاحظات', 'Log activity': 'تسجيل نشاط', 'e.g. Urea 46%': 'مثال: يوريا 46%',
    'No activities logged for this field': 'لا أنشطة مسجلة لهذا الحقل', 'Irrigation not set': 'الري غير محدد',
    'Planted': 'مزروع', 'Germination': 'إنبات', 'Vegetative': 'نمو خضري', 'Flowering': 'إزهار', 'Fruiting': 'إثمار', 'Maturity': 'نضج', 'Harvested': 'محصود',
    'Fertilizer': 'تسميد', 'Fertilization': 'تسميد', 'Spraying': 'رش', 'Sowing / planting': 'بذر / زراعة', 'Tillage': 'حراثة', 'Harvest': 'حصاد',
    'Scouting': 'كشف ميداني', 'Pruning': 'تقليم', 'Other': 'أخرى',
    // analytics
    'Image date': 'تاريخ الصورة', 'Index values distribution': 'توزيع قيم المؤشر', 'Compare with an earlier date': 'قارن بتاريخ سابق', 'No comparison': 'بدون مقارنة',
    'NDVI over the season': 'NDVI خلال الموسم', 'New task': 'مهمة جديدة', 'Mean NDVI': 'متوسط NDVI', 'Biggest drops': 'أكبر انخفاض', 'Biggest gains': 'أكبر ارتفاع',
    'Best and worst fields by NDVI': 'أفضل وأسوأ الحقول حسب NDVI', 'No NDVI drops on the selected date': 'لا انخفاض في NDVI في التاريخ المحدد',
    'Download CSV': 'تنزيل CSV', 'Print or PDF': 'طباعة أو PDF', 'Download spreadsheet': 'تنزيل جدول البيانات', 'CSV': 'CSV',
    'New Sentinel-2 image': 'صورة Sentinel-2 جديدة', 'Weather analytics': 'تحليلات الطقس', 'Weather history is not available right now': 'سجل الطقس غير متاح الآن',
    'Forecast not available right now': 'التوقعات غير متاحة الآن', 'The forecast is not available right now': 'التوقعات غير متاحة الآن',
    'GDD base 0 °C': 'درجات النمو أساس 0 °م', 'GDD base 5 °C': 'درجات النمو أساس 5 °م', 'GDD base 10 °C': 'درجات النمو أساس 10 °م', 'Build chart': 'أنشئ الرسم البياني',
    'Productivity from the clearest dates of the period': 'الإنتاجية من أوضح تواريخ الفترة', 'Field': 'الحقل', 'Index': 'المؤشر', 'Method': 'الطريقة',
    'Zones': 'المناطق', 'Min zone, ha': 'أصغر منطقة، هكتار', 'K-means': 'K-means', 'Equal area': 'مساحات متساوية', 'Layers (up to 5)': 'الطبقات (حتى 5)',
    'Weight %': 'الوزن %', 'Sowing map': 'خريطة البذر', 'Vegetation map': 'خريطة الغطاء النباتي', 'P&K map': 'خريطة الفوسفور والبوتاسيوم',
    'Seeding rate by long-term productivity. Stronger zones get more seed by default': 'معدل البذر حسب الإنتاجية طويلة المدى. المناطق الأقوى تحصل على بذور أكثر افتراضياً',
    'Nitrogen or growth regulator by the crop’s condition on one image date. Weaker zones get more by default': 'نيتروجين أو منظم نمو حسب حالة المحصول في تاريخ صورة واحد. المناطق الأضعف تحصل على أكثر افتراضياً',
    'Phosphorus and potassium by productivity zone. Weaker zones get more by default': 'فوسفور وبوتاسيوم حسب منطقة الإنتاجية. المناطق الأضعف تحصل على أكثر افتراضياً',
    'Combine up to five index layers with weights. Zone 1 holds the highest combined values': 'ادمج حتى خمس طبقات مؤشرات بأوزان. المنطقة 1 تحمل أعلى القيم المجمعة',
    'Reads the clearest dates of this period; dates with more than 40% cloud over the field are left out': 'يقرأ أوضح تواريخ هذه الفترة؛ وتُستبعد التواريخ التي تزيد سحبها فوق الحقل عن 40%',
    'Create sampling map': 'إنشاء خريطة العينات', 'Grid': 'شبكة', 'By zones': 'حسب المناطق', 'Cell size': 'حجم الخلية',
    'Sampling points inside the field, away from its edges. Grid: one composite sample per cell. Zones: points per productivity zone': 'نقاط عينات داخل الحقل بعيداً عن أطرافه. الشبكة: عينة مركبة لكل خلية. المناطق: نقاط لكل منطقة إنتاجية',
    'No open tasks. Create one from the map or from an NDVI drop in a field’s Analytics': 'لا مهام مفتوحة. أنشئ واحدة من الخريطة أو من انخفاض NDVI في تحليلات الحقل',
    'Activity log': 'سجل الأنشطة', 'Activities by type': 'الأنشطة حسب النوع', 'All activities': 'كل الأنشطة', 'Previous month': 'الشهر السابق', 'Next month': 'الشهر التالي',
    'No activities logged this year': 'لا أنشطة مسجلة هذا العام', 'Log': 'السجل', 'Crop area': 'مساحة المحصول',
    'Sentinel-2 L2A, 10 m · Element84 Earth Search · clouds masked with the scene classification layer': 'Sentinel-2 L2A، 10 م · Element84 Earth Search · السحب مُقنّعة بطبقة تصنيف المشهد',
    // sign-in page
    'Sign in': 'تسجيل الدخول', 'Sign in to your account': 'سجّل الدخول إلى حسابك', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور',
    'Full name': 'الاسم الكامل', 'Organization or farm name': 'اسم المؤسسة أو المزرعة', 'Create an organization': 'أنشئ مؤسسة', 'No account yet?': 'لا تملك حساباً؟',
    'At least 8 characters': '8 أحرف على الأقل', 'e.g. Al Khatim Farms': 'مثال: مزارع الختم', 'Your farms and fields open on the map right after': 'تفتح مزارعك وحقولك على الخريطة مباشرة بعد ذلك',
    'e.g. North pivots': 'مثال: المحاور الشمالية',
    'Hide fields panel': 'إخفاء لوحة الحقول', 'Show fields panel': 'إظهار لوحة الحقول', 'Add layer': 'إضافة طبقة', 'ha': 'هكتار', 'owner': 'مالك', 'manager': 'مدير', 'gis_analyst': 'محلل GIS', 'agronomist': 'مهندس زراعي',
    'field_supervisor': 'مشرف حقل', 'viewer': 'مشاهد',
  };

  const MONTHS = { Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو', Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Sept: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر',
    January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', June: 'يونيو', July: 'يوليو', August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر' };
  const MONTH_RE = /\b(January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\b/g;

  /** Patterns for strings built from numbers; each returns Arabic or undefined. */
  const RULES = [
    [/^(\d+) fields?$/, (m) => `${m[1]} ${+m[1] === 1 ? 'حقل' : 'حقول'}`],
    [/^(\d+) corners$/, (m) => `${m[1]} زوايا`],
    [/^(\d+) activities this month$/, (m) => `${m[1]} نشاط هذا الشهر`],
    [/^(\d+) clearest NDVI dates$/, (m) => `أوضح ${m[1]} تواريخ NDVI`],
    [/^Activities (\d{4})$/, (m) => `الأنشطة ${m[1]}`],
    [/^~?(\d+)% (tile cloud|cloud over the tile)$/, (m) => `سحب ${m[1]}% على البلاطة`],
    [/^(\d+)% cloud$/, (m) => `سحب ${m[1]}%`],
    [/^([\d.,]+) ha clear$/, (m) => `${m[1]} هكتار صافية`],
    [/^1 ha \(about 2\.5 ac\)$/, () => '1 هكتار (حوالي 2.5 فدان)'],
    [/^(.+) saved$/, (m) => `حُفظ ${m[1]}`],
    [/^(.+) deleted$/, (m) => `حُذف ${m[1]}`],
    [/^(.+) restored$/, (m) => `استُرجع ${m[1]}`],
    [/^(\d+) fields? imported$/, (m) => `استُورد ${m[1]} ${+m[1] === 1 ? 'حقل' : 'حقول'}`],
    [/^(\d+) skipped$/, (m) => `تُخطّي ${m[1]}`],
    [/^Overlaps (\d+) saved fields$/, (m) => `يتداخل مع ${m[1]} حقول محفوظة`],
    [/^overlap of (.+) cut away$/, (m) => `قُصّ تداخل بمساحة ${m[1]}`],
    [/^overlap (.+) cut$/, (m) => `قُصّ تداخل ${m[1]}`],
    [/^Boundary saved$/, () => 'حُفظت الحدود'],
    [/^NDVI change between (.+) and each field's previous clear image on the same tile$/, (m) => `تغيّر NDVI بين ${m[1]} وآخر صورة صافية سابقة لكل حقل على نفس البلاطة`],
    [/^(\S+@\S+)$/, (m) => m[1]],
  ];

  const SEPARATORS = / (·|›|→|\/) /;
  const cache = new Map();

  /** Names the user typed (fields, farms) are never translated, even if they equal a UI word. */
  let namesFrom = null, names = new Set();
  function userNames() {
    try {
      // `state` is the workspace's global (classic script), present only on that page
      if (typeof state === 'undefined' || !state) return names;
      const key = state.fieldList || state.farms;
      if (key !== namesFrom) {
        namesFrom = key;
        names = new Set([...(state.fieldList || []), ...(state.farms || [])].map((x) => x && x.name).filter(Boolean));
      }
    } catch { /* not the workspace */ }
    return names;
  }

  function tr(input) {
    if (lang !== 'ar' || !input || !/[A-Za-z]/.test(input)) return input;
    const lead = input.match(/^\s*/)[0], tail = input.match(/\s*$/)[0];
    const s = input.trim();
    if (userNames().has(s)) return input;
    if (cache.has(s)) return lead + cache.get(s) + tail;
    let out;
    if (AR[s] !== undefined) out = AR[s];
    if (out === undefined) for (const [re, f] of RULES) { const m = s.match(re); if (m) { out = f(m); break; } }
    if (out === undefined && SEPARATORS.test(s)) {
      out = s.split(/( · | › | → | \/ )/).map((part, i) => (i % 2 ? part : tr(part))).join('');
    }
    if (out === undefined && /^[\d.,\s~%-]+ (ha|m²|mm|kg\/ha|L\/ha|t\/ha)$/.test(s)) out = s;
    if (out === undefined) out = s;
    out = out.replace(/(\d) ha\b/g, '$1 هكتار');
    if (/\d/.test(out)) out = out.replace(MONTH_RE, (mo) => MONTHS[mo] || mo);   // dates only, not names
    // keep percentages and number ranges in reading order inside Arabic text
    out = out.replace(/~?[\d.,]+%|[\d.,]+\s?[–-]\s?[\d.,]+/g, (m) => '\u2066' + m + '\u2069');
    cache.set(s, out);
    return lead + out + tail;
  }

  // ------------------------------------------------------------ apply to the page

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP = 'script,style,textarea,code,pre,.leaflet-tile-container,[translate="no"],.notranslate';
  function translateNode(node) {
    if (node.nodeType === 3) {
      const p = node.parentElement;
      if (!p || p.closest(SKIP)) return;
      const v = node.nodeValue; const t = tr(v);
      if (t !== v) node.nodeValue = t;
      return;
    }
    if (node.nodeType !== 1 || node.closest(SKIP)) return;
    ATTRS.forEach((a) => { const v = node.getAttribute(a); if (v) { const t = tr(v); if (t !== v) node.setAttribute(a, t); } });
    node.querySelectorAll('*').forEach((el) => {
      if (el.closest(SKIP)) return;
      ATTRS.forEach((a) => { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } });
    });
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) translateNode(w.currentNode);
  }

  function start() {
    if (lang !== 'ar') return;
    translateNode(document.body);
    document.title = tr(document.title);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  function setLang(next) {
    try { localStorage.setItem('lang', next === 'ar' ? 'ar' : 'en'); } catch { /* storage off */ }
    location.reload();
  }

  window.I18n = { lang, t: tr, setLang, rtl: lang === 'ar' };
})();
