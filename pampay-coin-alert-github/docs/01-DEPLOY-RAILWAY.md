# راهنمای دیپلوی بک‌اند روی Railway 🚂

## پیش‌نیازها
- اکانت GitHub (رایگان)
- اکانت Railway (رایگان — ثبت‌نام با GitHub)

## مرحله ۱: آپلود ریپو به GitHub
1. در GitHub یک ریپوی جدید بسازید (مثلاً `pampay-coin-alert`) — می‌تواند Private باشد
2. محتوای این ریپو را push کنید:
```bash
git init
git add .
git commit -m "PamPay Coin Alert — initial"
git branch -M main
git remote add origin https://github.com/USERNAME/pampay-coin-alert.git
git push -u origin main
```

## مرحله ۲: ساخت پروژه Railway
1. به [railway.app](https://railway.app) بروید → **New Project**
2. **Deploy from GitHub repo** را انتخاب کنید و ریپوی خود را بدهید
3. بعد از ساخت service، روی آن کلیک کنید → تب **Settings**
4. در بخش **Root Directory** بنویسید: `server`
5. Railway به‌صورت خودکار Dockerfile داخل پوشه `server` را می‌سازد

## مرحله ۳: تنظیمات
1. تب **Settings** → **Networking** → **Generate Domain** → یک آدرس مثل `https://pampay-coin-alert-server.up.railway.app` می‌گیرید
2. (اختیاری) تب **Variables** — متغیرهای محیطی:

| متغیر | توضیح |
|---|---|
| `ALANCHAND_API_TOKEN` | توکن api.alanchand.com برای قیمت تتر/تومان |
| `NOBITEX_API_PUBLIC_KEY` | کلید عمومی نوبیتکس (اختیاری) |
| `NOBITEX_API_PRIVATE_KEY` | کلید خصوصی نوبیتکس (اختیاری) |
| `EXPO_ACCESS_TOKEN` | توکن Expo برای پوش (اختیاری) |

3. (پیشنهادی) **Volume** برای ماندگاری داده: تب Settings → Volumes → مسیر `/app/data` را مونت کنید

## مرحله ۴: تست
در مرورگر باز کنید:
```
https://YOUR-APP.up.railway.app/ping
```
باید این جواب را ببینید:
```json
{"ok":true,"now":"...","service":"pampay-coin-alert"}
```

## مرحله ۵: اتصال اپ
در اپ موبایل: **تنظیمات → سرور اسکن (Railway)** → آدرس را وارد → **تست اتصال** → **ذخیره** ✅

## رفتار اسکنر بعد از دیپلوی
- هر ساعت یک tick اجرا می‌شود (جایگزین Cloudflare Alarm)
- تایم‌فریم 1h: هر ساعت بعد از بسته‌شدن کندل
- تایم‌فریم 4h: هر ۴ ساعت
- تایم‌فریم 1d: روزانه بعد از بسته‌شدن کندل UTC-midnight
- اگر سرور وسط شب down بود، بعد از اولین سینک اپ **catch-up** انجام می‌شود
- سیگنال‌های جدید → تلگرام + پوش نوتیفیکیشن

## مدیریت دستی اسکن
```bash
# اجرای فوری اسکن
curl -X POST https://YOUR-APP.up.railway.app/scan/run

# وضعیت سرور
curl https://YOUR-APP.up.railway.app/scan/status
```

## هزینه
پلن رایگان Railway (Hobby trial) برای این workload معمولاً کافی است؛ اسکنer فقط ۱ بار در ساعت کوتاهی کار می‌کند. اگه محدودیت خوردید، پلن Developer (~۵ دلار) کفایت می‌کند.
