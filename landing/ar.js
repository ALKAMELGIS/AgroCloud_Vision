/*
 * AgroSyntra One — Arabic copy for the public pages (index.html, main.html).
 * Loaded right after js/i18n.js; it adds these strings to the shared dictionary.
 * Keys are the exact English text of one text node, so keep sentences in one node
 * (no inline tags inside a sentence) when editing the pages.
 */
window.I18n && I18n.add({
  // header and navigation
  'Product': 'المنتج', 'Tools': 'الأدوات', 'How it works': 'طريقة العمل', 'Who it is for': 'لمن صُمّم', 'Questions': 'أسئلة',
  'Sign in': 'تسجيل الدخول', 'Start free': 'ابدأ مجاناً', 'Main': 'القائمة الرئيسية',

  // hero
  'AgroSyntra One — Satellite crop monitoring for every field': 'AgroSyntra One — مراقبة المحاصيل بالأقمار الصناعية لكل حقل',
  'See every field from space, and act on what changed': 'شاهد كل حقل من الفضاء، وتصرّف فيما تغيّر',
  'AgroSyntra One reads Sentinel-2 imagery for each of your fields, masks the clouds inside the field and shows where the crop is ahead or falling behind. Your team works from the same map, in English or Arabic.':
    'يقرأ AgroSyntra One صور Sentinel-2 لكل حقل من حقولك، ويحجب السحب داخل حدود الحقل، ويبيّن أين يتقدّم المحصول وأين يتأخر. ويعمل فريقك على الخريطة نفسها، بالعربية أو الإنجليزية.',
  'Free during early access. No card needed.': 'مجاني خلال فترة الإطلاق المبكر، دون بطاقة دفع.',
  'The AgroSyntra One workspace: fields on the map with their vegetation index': 'مساحة عمل AgroSyntra One: الحقول على الخريطة مع مؤشر الغطاء النباتي',
  '−0.11 since 10 Nov': '⁦−0.11⁩ منذ 10 نوفمبر', 'Sentinel-2 · 10 m': 'Sentinel-2 · 10 م',
  'Jun': 'يونيو', 'Jul': 'يوليو', 'Aug': 'أغسطس', 'Sep': 'سبتمبر', 'Oct': 'أكتوبر', 'Nov': 'نوفمبر',
  'NDVI this season': 'NDVI هذا الموسم', 'Jun – Nov': 'يونيو – نوفمبر',

  // motion scenes (landing/scenes.js)
  'A satellite pass over five pivots: the analysis of the selected field, as in the workspace': 'مرور قمر صناعي فوق خمسة محاور: تحليل الحقل المختار كما في مساحة العمل',
  'Fields seen from a satellite. The pass turns natural colour into index values and masks a cloud': 'حقول من القمر الصناعي: المرور يحوّل الألوان الطبيعية إلى قيم مؤشرات ويحجب غيمة',
  '← Fields': 'الحقول →', 'Center pivot': 'محور ري', 'Analytics': 'التحليلات', 'Overview': 'نظرة عامة', 'Crops': 'المحاصيل', 'Activities': 'الأنشطة',
  'cloud': 'سحب', 'ha clear': 'هكتار صافية', 'ha': 'هكتار', 'Index values distribution': 'توزيع قيم المؤشر',
  'Click a range to show it on the map': 'اضغط على مدى لعرضه على الخريطة', 'Selected on the map': 'المحدد على الخريطة',
  'Layer': 'الطبقة', 'Contrast: stretch colours within each field': 'التباين: توزيع الألوان داخل كل حقل', 'contrast': 'تباين',
  '10 m': '10 م', 'Pause': 'إيقاف مؤقت', 'Play': 'تشغيل', 'The pass, step by step': 'المرور خطوة بخطوة',
  'NDVI · vegetation': 'NDVI · الغطاء النباتي', 'NDMI · water content': 'NDMI · محتوى الماء', 'NDWI · surface water': 'NDWI · المياه السطحية', 'BSI · bare soil': 'BSI · التربة المكشوفة',
  'One pivot: its pixels sort into value classes, then the season rises as a 3D skyline and wraps into a ring': 'محور واحد: تترتب بكسلاته في فئات القيم، ثم يرتفع الموسم أعمدة ثلاثية الأبعاد ويلتف في حلقة',
  'View': 'العرض', 'Estimated': 'تقديري', 'clear dates': 'تواريخ صافية', 'Average': 'المتوسط', 'Peak': 'الذروة', 'Lowest': 'الأدنى', 'Latest': 'الأحدث',
  'Pixels': 'البكسلات', 'Value classes': 'فئات القيم', '3D skyline': 'أعمدة ثلاثية الأبعاد', '3D ring': 'حلقة ثلاثية الأبعاد',
  'Pivot 2 on the clear date: every 10 m pixel inside the boundary, coloured with contrast from the field’s own P2 to P98.': 'المحور 2 في التاريخ الصافي: كل بكسل 10 م داخل الحدود، ملوّن بتباين من P2 إلى P98 للحقل نفسه.',
  'The pixels sort into the ten classes of the NDVI range. Each stack is hectares, and together they make the field.': 'تترتب البكسلات في الفئات العشر لنطاق NDVI. كل كومة مساحتها بالهكتار، ومجموعها مساحة الحقل.',
  'The whole year, a column per day: week by week along time, weekday by weekday across. Muted days are estimated between clear images.': 'السنة كاملة، عمود لكل يوم: أسبوعاً بأسبوع على طول الزمن، ويوماً بيوم عرضاً. الأيام الباهتة مقدّرة بين الصور الصافية.',
  'The same days wrapped around the pivot, January at the top, so the season reads like the field itself.': 'الأيام نفسها ملفوفة حول المحور، ويناير في الأعلى، فيُقرأ الموسم كأنه الحقل نفسه.',
  'From one image to the whole season': 'من صورة واحدة إلى الموسم كله', 'From a pixel to a number you can act on': 'من بكسل إلى رقم تتصرف بناءً عليه',
  "The steps and numbers are the workspace's own: cloud masking from the scene classification, contrast from the field's P2–P98, ten classes of the index range in hectares, one value per clear date and the days between them estimated. The scene uses a field model; the live demo below runs the same steps on real images.":
    'الخطوات والأرقام من مساحة العمل نفسها: حجب السحب من تصنيف المشهد، والتباين من P2 إلى P98 للحقل، وعشر فئات لنطاق المؤشر بالهكتار، وقيمة لكل تاريخ صافٍ مع تقدير الأيام بينها. المشهد يستخدم نموذج حقول، والعرض الحي أدناه يطبّق الخطوات نفسها على صور حقيقية.',
  'Try it': 'جرّبه', 'The real workspace, on real satellite images': 'مساحة العمل الحقيقية على صور أقمار صناعية حقيقية',
  'This is the product itself, reading the latest Sentinel-2 image of pivots in the Texas High Plains in your browser. It tours the tools on its own; touch it to take over.': 'هذا هو المنتج نفسه، يقرأ في متصفحك آخر صورة Sentinel-2 لمحاور ري في سهول تكساس العليا. يتجول بين الأدوات وحده، والمسه لتتولى القيادة.',

  // live demo
  'Live demo loads as you scroll': 'العرض الحي يُحمّل مع التمرير', 'Open the full demo': 'افتح العرض الكامل',
  'Loading real Sentinel-2 data': 'جارٍ تحميل بيانات Sentinel-2 حقيقية',
  'Live · real Sentinel-2 data, analysed in your browser': 'مباشر · بيانات Sentinel-2 حقيقية تُحلَّل في متصفحك',
  'Pivot boundaries found on the image of': 'حدود المحاور مكتشفة من صورة',
  'Your turn: the demo waits while you explore': 'دورك: العرض ينتظر بينما تستكشف',
  'Every field on the latest clear image, NDVI': 'كل الحقول في آخر صورة صافية، NDVI',
  'A field opens with its value classes in hectares': 'يُفتح الحقل بفئات قيمه بالهكتار',
  'Click a class: only those pixels stay on the map': 'اضغط فئة: تبقى بكسلاتها وحدها على الخريطة',
  'NDMI: water in the crop': 'NDMI: الماء في المحصول', 'NDWI: open water': 'NDWI: المياه المكشوفة', 'BSI: bare soil': 'BSI: التربة المكشوفة', 'Back to NDVI': 'العودة إلى NDVI',
  'The whole season for this field': 'الموسم كاملاً لهذا الحقل', 'Heatmap: every day of the year': 'الخريطة الحرارية: كل يوم في السنة',
  '3D skyline: drag to turn it': 'أعمدة ثلاثية الأبعاد: اسحب لتديرها', '3D ring: the pivot over the season': 'حلقة ثلاثية الأبعاد: المحور على مدار الموسم',

  // capabilities
  'What it does': 'ماذا يقدّم', 'Five ways it keeps a farm on track': 'خمس طرق تُبقي المزرعة على المسار الصحيح',
  'Each one works on the same field record, so a change you see on the map can become a task, a prescription or a page in a report.':
    'كلها تعمل على سجل الحقل نفسه، فالتغيّر الذي تراه على الخريطة يصبح مهمة أو خريطة تسميد أو صفحة في تقرير.',
  'Crop analytics': 'تحليل المحاصيل',
  'Thirteen indices for vegetation, nitrogen, water and soil, each with its own colour scale. See the hectares in every value class and click a class to find it on the map.':
    'ثلاثة عشر مؤشراً للغطاء النباتي والنيتروجين والمياه والتربة، لكل منها تدرّج ألوانه. اعرف عدد الهكتارات في كل فئة، واضغط الفئة لتجدها على الخريطة.',
  'Natural colour': 'ألوان طبيعية',
  'Remote crop health': 'صحة المحصول عن بُعد',
  'A new Sentinel-2 image every few days at 10 m, with clouds and shadows masked inside each field. Sharpen the view to 5 m or 2.5 m when you need more detail.':
    'صورة Sentinel-2 جديدة كل بضعة أيام بدقة 10 م، مع حجب السحب وظلالها داخل كل حقل. ويمكنك تحسين الدقة إلى 5 م أو 2.5 م عند الحاجة إلى تفاصيل أكثر.',
  'Field risks': 'مخاطر الحقول',
  'Fields whose index dropped since the last clear image move to the top, with the change in numbers.': 'الحقول التي انخفض مؤشرها منذ آخر صورة صافية تظهر أولاً، مع مقدار التغيّر بالأرقام.',
  'Input savings': 'توفير المدخلات',
  'Split a field into productivity zones and give each its own seed or fertilizer rate. The map goes to the tractor terminal.': 'قسّم الحقل إلى نطاقات إنتاجية وأعطِ كل نطاق معدّل البذور أو السماد الخاص به، ثم أرسل الخريطة إلى شاشة الجرّار.',
  'Field reports': 'تقارير الحقول',
  'Two A4 pages per field: maps, zone areas, the season curve, weather, operations and notes for the agronomist.': 'صفحتان بحجم A4 لكل حقل: خرائط ومساحات النطاقات ومنحنى الموسم والطقس والعمليات وملاحظات للمهندس الزراعي.',
  'Print or save as PDF': 'اطبعه أو احفظه PDF',

  // steps
  'From a boundary to a decision in six steps': 'من حدود الحقل إلى القرار في ست خطوات',
  'Add your fields': 'أضف حقولك',
  'Draw a polygon or a pivot circle, select it on the map, or import a Shapefile, KML, GeoPackage or File Geodatabase.': 'ارسم مضلعاً أو دائرة محور، أو حدّده على الخريطة، أو استورد ملف Shapefile أو KML أو GeoPackage أو File Geodatabase.',
  'Get the imagery': 'احصل على الصور',
  'Every clear Sentinel-2 date for the field appears on the timeline, with its cloud cover inside the boundary.': 'يظهر كل تاريخ صافٍ من Sentinel-2 على الشريط الزمني، مع نسبة السحب داخل حدود الحقل.',
  'Read the trend': 'اقرأ الاتجاه',
  'Plot several indices over the season, or switch to a heatmap of every day.': 'ارسم عدة مؤشرات خلال الموسم، أو انتقل إلى خريطة حرارية لكل يوم.',
  'Check the risks': 'راجع المخاطر',
  'See which fields dropped since the last clear image and which part of the field is behind.': 'اعرف أي الحقول انخفضت منذ آخر صورة صافية، وأي جزء من الحقل متأخر.',
  'Take action': 'اتخذ الإجراء',
  'Send a scout to a point, build a variable rate map, or log the irrigation, spray or fertilizer you applied.': 'أرسل مستكشفاً إلى نقطة، أو أنشئ خريطة معدّل متغيّر، أو سجّل الري أو الرش أو التسميد الذي نفّذته.',
  'Share the result': 'شارك النتيجة',
  'Print the field report, export the zones for the terminal, or give your team the same view with their own role.': 'اطبع تقرير الحقل، أو صدّر النطاقات لشاشة الجرّار، أو امنح فريقك العرض نفسه بالدور المناسب لكل فرد.',

  // tools
  'Inside the workspace': 'داخل مساحة العمل', 'The tools you work with every day': 'الأدوات التي تعمل بها كل يوم',
  'Crop health indices': 'مؤشرات صحة المحصول', 'Vegetation, water and soil on the same field': 'الغطاء النباتي والمياه والتربة على الحقل نفسه',
  'Time series and heatmap': 'السلسلة الزمنية والخريطة الحرارية', 'The whole season in one view': 'الموسم كاملاً في عرض واحد',
  'What changed since the last clear image': 'ما الذي تغيّر منذ آخر صورة صافية',
  'Variable rate maps': 'خرائط المعدّل المتغيّر', 'Zones and rates for seed and fertilizer': 'نطاقات ومعدّلات للبذور والسماد',
  'Soil sampling': 'أخذ عينات التربة', 'A grid of points ready for the field crew': 'شبكة نقاط جاهزة لفريق الحقل',
  'Field activity log': 'سجل أنشطة الحقول', 'Every operation with its product and rate': 'كل عملية مع منتجها ومعدّلها',
  'Scout tasks': 'مهام الكشف', 'A point on the map, a person, a due date': 'نقطة على الخريطة، وشخص مسؤول، وموعد',
  'Weather analytics': 'تحليلات الطقس', 'Temperature, rain and soil moisture per field': 'الحرارة والأمطار ورطوبة التربة لكل حقل',
  'Two printed pages an agronomist can sign': 'صفحتان مطبوعتان يوقّعهما المهندس الزراعي',
  'Team and roles': 'الفريق والأدوار', 'Six roles, one organization': 'ستة أدوار في مؤسسة واحدة',

  'Pick an index and the field repaints with its own colour scale. Contrast stretches the colours within each field, so small differences inside a pivot stand out.':
    'اختر مؤشراً فيُعاد تلوين الحقل بتدرّجه الخاص. ويوزّع خيار التباين الألوان داخل كل حقل، فتظهر الفروق الصغيرة داخل المحور.',
  'NDVI, SAVI and EVI for vigour, NDRE and GNDVI for nitrogen': 'NDVI وSAVI وEVI لقوة النمو، وNDRE وGNDVI للنيتروجين',
  'NDMI and NDWI for water, BSI and SI for bare and salty soil': 'NDMI وNDWI للمياه، وBSI وSI للتربة المكشوفة والمالحة',
  'Click a value class in the legend to show only those pixels': 'اضغط فئة قيم في مفتاح الألوان لتظهر بكسلاتها وحدها',
  'Plot one or several indices for a field over any period, with the spread inside the field and weather on its own axis. Switch to a calendar heatmap, a 3D skyline or a 3D pivot ring.':
    'ارسم مؤشراً أو أكثر لحقل خلال أي فترة، مع تباين القيم داخل الحقل والطقس على محور مستقل. وانتقل إلى خريطة حرارية بالتقويم أو أعمدة ثلاثية الأبعاد أو حلقة محور ثلاثية الأبعاد.',
  'Line, area, bars, points or change from the previous date': 'خط أو مساحة أو أعمدة أو نقاط أو التغيّر عن التاريخ السابق',
  'Each clear date is one point; days between images are estimated and marked': 'كل تاريخ صافٍ نقطة واحدة، والأيام بين الصور تقديرية ومميّزة',
  'Download the values as CSV': 'نزّل القيم بصيغة CSV',
  'Faded squares are days estimated between clear images': 'المربعات الباهتة أيام مقدّرة بين الصور الصافية',
  'Every field is compared with its previous clear image. The ones that dropped come first, so the morning starts with the right field.':
    'يُقارن كل حقل بصورته الصافية السابقة، وتظهر الحقول المنخفضة أولاً، فيبدأ يومك بالحقل الصحيح.',
  'Change in index value, not just a colour': 'التغيّر بقيمة المؤشر، لا باللون فقط',
  'Cloud cover inside the field shown with every date': 'نسبة السحب داخل الحقل مع كل تاريخ',
  'Swipe or split the map to compare two dates': 'اسحب الفاصل أو قسّم الخريطة لمقارنة تاريخين',
  'Fodder block': 'قطعة الأعلاف',
  'Build zones from one image, from the clearest dates of several seasons, or from up to five weighted layers. Give each zone a rate and see the total product and the saving.':
    'أنشئ النطاقات من صورة واحدة، أو من أصفى التواريخ في عدة مواسم، أو من خمس طبقات موزونة. أعطِ كل نطاق معدّله، واعرف إجمالي المنتج والتوفير.',
  'Two to seven zones, smoothed, with a minimum zone size': 'من نطاقين إلى سبعة، مع التنعيم وحد أدنى لمساحة النطاق',
  'Exports for John Deere, Trimble and any ISO-XML terminal': 'تصدير لأجهزة John Deere وTrimble وأي شاشة تدعم ISO-XML',
  'Shapefile, GeoJSON, KML and CSV as well': 'وكذلك Shapefile وGeoJSON وKML وCSV',
  'Zone 1': 'النطاق 1', 'Zone 2': 'النطاق 2', 'Zone 3': 'النطاق 3', 'Zone 4': 'النطاق 4',
  'Place sampling points on a grid or by zone, each one set away from the field edge, and take them to the field as GPX, KML, CSV or Shapefile.':
    'ضع نقاط العينات على شبكة أو حسب النطاقات، كل نقطة بعيدة عن حافة الحقل، وخذها إلى الميدان بصيغة GPX أو KML أو CSV أو Shapefile.',
  'Grid cells sized in hectares': 'خلايا الشبكة بالهكتار',
  'One to five points in every productivity zone': 'من نقطة إلى خمس نقاط في كل نطاق إنتاجي',
  'Tillage, planting, fertilising, irrigation, spraying, pruning and harvest, each with its date, product and rate, on a monthly calendar for the whole farm.':
    'الحراثة والزراعة والتسميد والري والرش والتقليم والحصاد، كل منها بتاريخه ومنتجه ومعدّله، على تقويم شهري للمزرعة كلها.',
  'Filter by type of operation': 'التصفية حسب نوع العملية', 'Download each month as CSV': 'تنزيل كل شهر بصيغة CSV',
  'Drop a pin where the map shows a problem, say what to check, who goes and by when. Close it with notes when it is done.':
    'ضع دبوساً حيث تُظهر الخريطة مشكلة، وحدّد ما يجب فحصه ومن يذهب ومتى. وأغلق المهمة بملاحظات عند إنجازها.',
  'Priority, issue type and due date on every task': 'الأولوية ونوع المشكلة والموعد في كل مهمة',
  'Open tasks show as pins on the map': 'المهام المفتوحة تظهر دبابيس على الخريطة',
  'Check for leaf rust': 'افحص صدأ الأوراق', 'Low stand near the arm end': 'كثافة نباتات منخفضة قرب طرف الذراع', 'Confirm nozzle repair': 'تأكد من إصلاح الرشاش',
  'High': 'عالية', 'Medium': 'متوسطة', 'Low': 'منخفضة',
  "Forecast and history at each field's own coordinates. Lay temperature, rain or soil moisture over the index curve to see what drove a change.":
    'توقعات وسجل الطقس عند إحداثيات كل حقل. ضع الحرارة أو الأمطار أو رطوبة التربة فوق منحنى المؤشر لتعرف سبب التغيّر.',
  'Seven-day forecast per field': 'توقعات سبعة أيام لكل حقل', 'Past weather for any period you plot': 'الطقس السابق لأي فترة ترسمها',
  'Temperature': 'الحرارة', 'Rain': 'الأمطار', 'Soil moisture': 'رطوبة التربة',
  "Two A4 pages built from the field's own data: index and zone maps over satellite imagery, zone areas that add up to the field, the season curve, weather and operations, and notes written by rule from what the numbers show.":
    'صفحتان بحجم A4 من بيانات الحقل نفسه: خرائط المؤشر والنطاقات فوق صور الأقمار الصناعية، ومساحات نطاقات مجموعها مساحة الحقل، ومنحنى الموسم، والطقس والعمليات، وملاحظات مبنية على قواعد مما تُظهره الأرقام.',
  'Areas in hectares, acres and dunums': 'المساحات بالهكتار والفدان الإنجليزي والدونم',
  'Print or save as PDF from the browser': 'اطبعه أو احفظه PDF من المتصفح',
  'Each organization sees only its own farms. Roles decide who can change boundaries, who logs operations and who only reads.':
    'كل مؤسسة ترى مزارعها فقط. والأدوار تحدّد من يغيّر الحدود ومن يسجّل العمليات ومن يطّلع فقط.',
  'Owner, manager, GIS analyst, agronomist, field supervisor and viewer': 'المالك والمدير ومحلل نظم المعلومات الجغرافية والمهندس الزراعي ومشرف الحقل والمشاهد',
  'Field history keeps every boundary change, with restore': 'سجل الحقل يحفظ كل تغيير في الحدود مع إمكانية الاستعادة',
  'Owner': 'المالك', 'Everything, including the team': 'كل شيء، بما في ذلك الفريق',
  'Manager': 'المدير', 'Farms, fields and operations': 'المزارع والحقول والعمليات',
  'GIS analyst': 'محلل نظم المعلومات الجغرافية', 'Boundaries, imports and zones': 'الحدود والاستيراد والنطاقات',
  'Agronomist': 'المهندس الزراعي', 'Crops, scouting and reports': 'المحاصيل والكشف والتقارير',
  'Field supervisor': 'مشرف الحقل', 'Activities and scout tasks': 'الأنشطة ومهام الكشف',
  'Viewer': 'المشاهد', 'Reads, does not change': 'يطّلع ولا يغيّر',

  // free start band
  'Start with your first fields today': 'ابدأ بحقولك الأولى اليوم',
  'Create your organization, add a farm and draw or import its fields. Imagery and weather appear as soon as a field is saved.':
    'أنشئ مؤسستك، وأضف مزرعة، وارسم حقولها أو استوردها. تظهر الصور والطقس فور حفظ الحقل.',

  // audiences
  'Built for the people who walk the fields and the people who advise them': 'مصمّم لمن يمشي في الحقول ولمن يقدّم لهم المشورة',
  'Growers and farm managers': 'المزارعون ومديرو المزارع', 'What gets in the way': 'ما الذي يعيق العمل', 'What changes': 'ما الذي يتغيّر',
  'Too many fields to visit every week': 'حقول كثيرة يصعب زيارتها كل أسبوع',
  'Problems found when they are already visible from the road': 'مشكلات تُكتشف حين تصبح مرئية من الطريق',
  'The same rate of seed and fertilizer on good and poor ground': 'معدّل البذور والسماد نفسه على الأرض الجيدة والضعيفة',
  'Records spread over notebooks and messages': 'سجلات موزّعة بين الدفاتر والرسائل',
  'The map shows which field and which part of it to visit first': 'الخريطة تبيّن أي حقل وأي جزء منه تزوره أولاً',
  'A drop shows in the index days before it shows to the eye': 'الانخفاض يظهر في المؤشر قبل أن تراه العين بأيام',
  'Zones put inputs where they pay back': 'النطاقات تضع المدخلات حيث تعطي مردوداً',
  'Every operation sits on the field it was done on': 'كل عملية مسجّلة على الحقل الذي نُفّذت فيه',
  'Agronomists and consultants': 'المهندسون الزراعيون والمستشارون',
  'Many clients, each with their own files and formats': 'عملاء كثيرون، لكل منهم ملفاته وصيغه',
  'Advice that is hard to show without a map': 'توصيات يصعب عرضها دون خريطة',
  'Hours spent turning data into a report': 'ساعات تضيع في تحويل البيانات إلى تقرير',
  "Import any client's boundaries in the format they have": 'استورد حدود أي عميل بالصيغة التي لديه',
  'Point to the zone, the date and the number': 'أشِر إلى النطاق والتاريخ والرقم',
  'A two-page report per field, ready to print': 'تقرير من صفحتين لكل حقل، جاهز للطباعة',

  // data sources
  'Built on open, verifiable data': 'مبني على بيانات مفتوحة يمكن التحقق منها',
  'The sources are public, so every number on the map can be checked.': 'المصادر عامة، فيمكن التحقق من كل رقم على الخريطة.',
  'ESA Copernicus satellites, 10 m, a new image every few days': 'أقمار كوبرنيكوس التابعة لوكالة الفضاء الأوروبية، دقة 10 م، وصورة جديدة كل بضعة أيام',
  'Scene classification': 'تصنيف المشهد', 'Clouds, shadows and snow masked inside each field': 'حجب السحب والظلال والثلوج داخل كل حقل',
  "Forecast and past weather at the field's coordinates": 'التوقعات والطقس السابق عند إحداثيات الحقل',
  'Areas measured on the WGS84 ellipsoid, so hectares match a survey': 'المساحات تُقاس على إهليلج WGS84، فتطابق الهكتارات المساحة المسحية',

  // questions
  'Short answers to what people ask first.': 'إجابات قصيرة عن أكثر ما يُسأل أولاً.',
  'Which satellite images does it use?': 'ما صور الأقمار الصناعية المستخدمة؟',
  "Sentinel-2 Level-2A from the European Copernicus programme, at 10 m per pixel. You can sharpen the view to 5 m or 2.5 m with a super-resolution model; the result is a model's estimate, not a new measurement.":
    'صور Sentinel-2 من المستوى 2A ضمن برنامج كوبرنيكوس الأوروبي، بدقة 10 م للبكسل. ويمكن تحسين العرض إلى 5 م أو 2.5 م بنموذج لزيادة الدقة، والنتيجة تقدير من النموذج وليست قياساً جديداً.',
  'How often is there a new image?': 'كم مرة تتوفر صورة جديدة؟',
  'The Sentinel-2 satellites pass every few days. Each date is listed with the cloud cover inside your field, and cloudy dates can be hidden.':
    'تمر أقمار Sentinel-2 كل بضعة أيام. ويظهر كل تاريخ مع نسبة السحب داخل حقلك، ويمكن إخفاء التواريخ الغائمة.',
  'What happens when it is cloudy?': 'ماذا يحدث عندما تكون السماء غائمة؟',
  'Clouds and their shadows are masked pixel by pixel inside the field, so a partly cloudy date still gives values for the clear part.':
    'تُحجب السحب وظلالها بكسلاً بكسلاً داخل الحقل، فيعطي التاريخ الغائم جزئياً قيماً للجزء الصافي.',
  'Which files can I import and export?': 'ما الملفات التي يمكنني استيرادها وتصديرها؟',
  'Import GeoJSON, KML, KMZ, zipped Shapefile, File Geodatabase and GeoPackage, in any projection. Export zones as ISO-XML, Shapefile, GeoJSON, KML, GPX or CSV.':
    'استورد GeoJSON وKML وKMZ وShapefile مضغوطاً وFile Geodatabase وGeoPackage بأي نظام إحداثيات. وصدّر النطاقات بصيغ ISO-XML أو Shapefile أو GeoJSON أو KML أو GPX أو CSV.',
  'Does it work in Arabic?': 'هل يعمل بالعربية؟',
  'Yes. The whole workspace, the reports and this site switch to Arabic with the layout mirrored from right to left.': 'نعم. تتحول مساحة العمل كاملة والتقارير وهذا الموقع إلى العربية، مع اتجاه من اليمين إلى اليسار.',
  'What does it cost?': 'كم التكلفة؟',
  'It is free during early access. Plans by area will follow, and you will be told before anything changes.': 'مجاني خلال فترة الإطلاق المبكر. وستأتي لاحقاً خطط حسب المساحة، وسنبلغك قبل أي تغيير.',

  // closing and footer
  'Put your farm on the map': 'ضع مزرعتك على الخريطة',
  'It takes a few minutes to add the first fields. The imagery is already waiting.': 'إضافة الحقول الأولى تستغرق دقائق، والصور جاهزة بانتظارك.',
  'Satellite crop monitoring for farms in English and Arabic.': 'مراقبة المحاصيل بالأقمار الصناعية للمزارع، بالعربية والإنجليزية.',
  'Account': 'الحساب', 'Create an organization': 'أنشئ مؤسسة', 'Open the workspace': 'افتح مساحة العمل', 'Data': 'البيانات', 'Source code': 'الشيفرة المصدرية',
  'Imagery: contains modified Copernicus Sentinel data': 'الصور: تحتوي على بيانات Copernicus Sentinel معدّلة',

  // sign in
  'Sign In — AgroSyntra One': 'تسجيل الدخول — AgroSyntra One',
  'Sign in to your account': 'سجّل الدخول إلى حسابك', 'Your farms and fields open on the map right after': 'تفتح مزارعك وحقولك على الخريطة مباشرة',
  'Create your organization': 'أنشئ مؤسستك', 'You become its owner': 'تصبح مالكها',
  'Organization or farm name': 'اسم المؤسسة أو المزرعة', 'Full name': 'الاسم الكامل', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور',
  'e.g. Liwa North Farms': 'مثال: مزارع ليوا الشمالية', 'At least 8 characters': '8 أحرف على الأقل',
  'Create organization': 'إنشاء المؤسسة', 'No account yet?': 'لا تملك حساباً بعد؟', 'Already have an account?': 'لديك حساب بالفعل؟',
  'Signing in': 'جارٍ تسجيل الدخول', 'Fields seen from a satellite: the pass turns natural colour into index values and masks a cloud': 'حقول من القمر الصناعي: المرور يحوّل الألوان الطبيعية إلى قيم مؤشر ويحجب السحب', 'You are signed in as': 'أنت مسجّل الدخول باسم', 'Use another account': 'استخدم حساباً آخر', 'The server is waking up': 'الخادم يستيقظ', 's': 'ث', 'Wrong email or password': 'البريد أو كلمة المرور غير صحيحة', 'Creating': 'جارٍ الإنشاء',
  'The first request can take up to a minute while the server wakes up.': 'قد يستغرق الطلب الأول حتى دقيقة ريثما يستيقظ الخادم.',
  'Every field, every clear image': 'كل حقل، في كل صورة صافية',
  'Vegetation, water and soil indices with clouds masked inside the field': 'مؤشرات الغطاء النباتي والمياه والتربة مع حجب السحب داخل الحقل',
  'The fields that changed since the last image, listed first': 'الحقول التي تغيّرت منذ آخر صورة تظهر أولاً',
  'Zones, scouting and reports from the same map': 'النطاقات والكشف والتقارير من الخريطة نفسها',
});
