# ExamOCR — Image to Exact Text

تطبيق ويب بسيط يعمل على المتصفح (Desktop وMobile) لتحويل صور امتحانات إلى نص كما هو مئاشياً (يسعى للاحتفاظ بالترتيب والتنسيق والمسافات).

ملفات المشروع:
- `index.html` — الواجهة.
- `style.css` — الأنماط.
- `app.js` — منطق التطبيق وOCR.
- `.github/workflows/deploy.yml` — Action لنشر على GitHub Pages.
- `package.sh` / `package.ps1` — لإنشاء أرشيف ZIP.

تشغيل محلي سريع:
1. افتح موجه الأوامر داخل المجلد ثم:
```bash
python -m http.server 8000