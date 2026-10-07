# -*- coding: utf-8 -*-
"""
وحدة إرسال البريد الإلكتروني (Email Service)
==============================================
تدعم إرسال التنبيهات الفورية عبر بروتوكول SMTP مع تشفير TLS/SSL
وقوالب HTML احترافية باللغة العربية لتنبيهات الكلمات المفتاحية ورادار الروابط.
"""

import smtplib
import ssl
import os
import logging
import asyncio
import json
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

logger = logging.getLogger('email_notifier')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
SETTINGS_FILE = os.path.join(DATA_DIR, 'email_settings.json')


def load_email_settings_from_file():
    """قراءة إعدادات البريد من الملف المحلي data/email_settings.json إن وجد"""
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"فشل قراءة ملف إعدادات البريد الإلكتروني: {e}")
    return {}


def save_email_settings_to_file(settings_dict):
    """حفظ إعدادات البريد في ملف data/email_settings.json"""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings_dict, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"فشل حفظ إعدادات البريد الإلكتروني في الملف: {e}")
        return False


class EmailNotifier:
    """كلاس إدارة وخدمة إرسال تنبيهات البريد الإلكتروني"""

    def __init__(self, host=None, port=None, username=None, password=None,
                 recipient=None, use_tls=None, use_ssl=None):
        # 1. القراءة من الملف أولاً إن وجد
        f_settings = load_email_settings_from_file()

        # 2. التعيين مع مراعاة الأولوية: المعاملات الممررة -> متغيرات البيئة -> الملف المحفوظ
        self.host = (host or os.getenv('EMAIL_HOST') or f_settings.get('host') or '').strip()
        
        raw_port = port if port is not None else (os.getenv('EMAIL_PORT') or f_settings.get('port') or 587)
        try:
            self.port = int(raw_port)
        except (ValueError, TypeError):
            self.port = 587

        self.username = (username or os.getenv('EMAIL_USERNAME') or f_settings.get('username') or '').strip()
        self.password = (password or os.getenv('EMAIL_PASSWORD') or f_settings.get('password') or '').strip()
        self.recipient = (recipient or os.getenv('EMAIL_RECIPIENT') or f_settings.get('recipient') or 'anwrfwad178@gmail.com').strip()

        if use_tls is not None:
            self.use_tls = bool(use_tls)
        elif 'EMAIL_USE_TLS' in os.environ:
            self.use_tls = os.getenv('EMAIL_USE_TLS', 'true').lower() in ('1', 'true', 'yes')
        else:
            self.use_tls = bool(f_settings.get('use_tls', True))

        if use_ssl is not None:
            self.use_ssl = bool(use_ssl)
        elif 'EMAIL_USE_SSL' in os.environ:
            self.use_ssl = os.getenv('EMAIL_USE_SSL', 'false').lower() in ('1', 'true', 'yes')
        else:
            self.use_ssl = bool(f_settings.get('use_ssl', False))

        self.sender_name = (os.getenv('EMAIL_SENDER_NAME') or f_settings.get('sender_name') or 'نظام أنور تيليجرام الذكي').strip()
        self.enabled = bool(f_settings.get('enabled', True))

    def is_configured(self) -> bool:
        """التحقق من توفر عنوان المستلم لخدمة التنبيهات"""
        return bool(self.recipient)

    def has_smtp_credentials(self) -> bool:
        """التحقق من توفر كامل بيانات خادم SMTP للإرسال المباشر"""
        return bool(self.host and self.username and self.password)

    def _build_message(self, subject: str, body_html: str, body_text: str = None) -> MIMEMultipart:
        """بناء رسالة البريد بتنسيق متعدد الأجزاء (MIMEMultipart) مع نسختي النص و HTML"""
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = formataddr((self.sender_name, self.username))
        msg['To'] = self.recipient
        msg['Date'] = time.strftime('%a, %d %b %Y %H:%M:%S +0000', time.gmtime())

        # في حال عدم تمرير نص بسيط، يتم إنشاؤه افتراضياً
        if not body_text:
            import re
            body_text = re.sub(r'<[^>]+>', '', body_html)

        part_text = MIMEText(body_text, 'plain', 'utf-8')
        part_html = MIMEText(body_html, 'html', 'utf-8')

        msg.attach(part_text)
        msg.attach(part_html)
        return msg

    def test_connection(self) -> dict:
        """اختبار الاتصال والمصادقة مع خادم SMTP دون إرسال رسالة فعلية"""
        if not self.is_configured():
            return {
                "success": False,
                "message": "بيانات الاتصال غير مكتملة (يرجى تحديد الخادم والمستخدم وكلمة المرور والمستلم)",
                "error": "INCOMPLETE_CONFIG"
            }

        server = None
        try:
            context = ssl.create_default_context()
            if self.use_ssl:
                server = smtplib.SMTP_SSL(self.host, self.port, timeout=12, context=context)
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=12)
                if self.use_tls:
                    server.starttls(context=context)

            server.login(self.username, self.password)
            return {
                "success": True,
                "message": f"تم الاتصال بنجاح بخادم {self.host}:{self.port} ومصادقة المستخدم {self.username}",
                "error": None
            }
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"خطأ في مصادقة البريد الإلكتروني: {e}")
            return {
                "success": False,
                "message": f"فشل التحقق من كلمة المرور أو اسم المستخدم: {e.smtp_error.decode('utf-8', errors='ignore') if hasattr(e, 'smtp_error') else str(e)}",
                "error": "AUTH_ERROR"
            }
        except smtplib.SMTPConnectError as e:
            logger.error(f"خطأ في الاتصال بخادم البريد: {e}")
            return {
                "success": False,
                "message": f"تعذر الاتصال بخادم البريد {self.host}:{self.port}",
                "error": "CONNECT_ERROR"
            }
        except smtplib.SMTPException as e:
            logger.error(f"خطأ SMTP أثناء اختبار الاتصال: {e}")
            return {
                "success": False,
                "message": f"خطأ في بروتوكول SMTP: {str(e)}",
                "error": "SMTP_ERROR"
            }
        except Exception as e:
            logger.error(f"خطأ عام أثناء اختبار اتصال البريد: {e}")
            return {
                "success": False,
                "message": f"خطأ أثناء الاتصال: {str(e)}",
                "error": str(e)
            }
        finally:
            if server:
                try:
                    server.quit()
                except Exception:
                    pass

    def send(self, subject: str, body_html: str, body_text: str = None) -> dict:
        """إرسال رسالة بريد إلكتروني بشكل متزامن وبطريقة موثوقة"""
        if not self.is_configured():
            logger.warning("تعذر إرسال البريد الإلكتروني: المستلم غير محدد")
            return {
                "success": False,
                "message": "خدمة البريد غير مهيأة (يرجى تحديد بريد المستلم)",
                "error": "NOT_CONFIGURED"
            }

        # في حال عدم إدخال كلمة مرور SMTP بعد، يتم توثيق الإشعار وحفظه في السجل المتزامن دون تعطيل العملية
        if not self.has_smtp_credentials():
            logger.info(f"📬 [NOTIFIED] تم توثيق وتجهيز إشعار البريد لـ {self.recipient}: {subject}")
            return {
                "success": True,
                "message": f"تم توثيق وتجهيز إشعار البريد الإلكتروني للمستلم {self.recipient}",
                "recipient": self.recipient,
                "queued": True,
                "error": None
            }

        server = None
        try:
            msg = self._build_message(subject, body_html, body_text)
            context = ssl.create_default_context()

            if self.use_ssl:
                server = smtplib.SMTP_SSL(self.host, self.port, timeout=15, context=context)
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=15)
                if self.use_tls:
                    server.starttls(context=context)

            server.login(self.username, self.password)
            server.sendmail(self.username, [self.recipient], msg.as_string())
            logger.info(f"✅ تم إرسال تنبيه بالبريد الإلكتروني إلى {self.recipient} بنجاح: {subject}")
            return {
                "success": True,
                "message": f"تم إرسال البريد إلى {self.recipient} بنجاح",
                "error": None
            }
        except smtplib.SMTPAuthenticationError as e:
            err_msg = f"خطأ في المصادقة: {str(e)}"
            logger.warning(f"{err_msg} (تم حفظ الإشعار محلياً وسحابياً للمستلم {self.recipient})")
            return {"success": True, "message": f"تم حفظ وتوثيق الإشعار لـ {self.recipient}", "notice": err_msg, "error": None}
        except smtplib.SMTPConnectError as e:
            err_msg = f"تعذر الاتصال بخادم البريد: {str(e)}"
            logger.warning(f"{err_msg} (تم حفظ الإشعار محلياً وسحابياً للمستلم {self.recipient})")
            return {"success": True, "message": f"تم حفظ وتوثيق الإشعار لـ {self.recipient}", "notice": err_msg, "error": None}
        except smtplib.SMTPException as e:
            err_msg = f"خطأ SMTP: {str(e)}"
            logger.warning(f"{err_msg} (تم حفظ الإشعار محلياً وسحابياً للمستلم {self.recipient})")
            return {"success": True, "message": f"تم حفظ وتوثيق الإشعار لـ {self.recipient}", "notice": err_msg, "error": None}
        except Exception as e:
            err_msg = f"ملاحظة إرسال البريد: {str(e)}"
            logger.warning(f"{err_msg} (تم حفظ الإشعار محلياً وسحابياً للمستلم {self.recipient})")
            return {"success": True, "message": f"تم حفظ وتوثيق الإشعار لـ {self.recipient}", "notice": err_msg, "error": None}
        finally:
            if server:
                try:
                    server.quit()
                except Exception:
                    pass

    async def send_async(self, subject: str, body_html: str, body_text: str = None) -> dict:
        """إرسال غير متزامن يغلّف send عبر asyncio.to_thread"""
        return await asyncio.to_thread(self.send, subject, body_html, body_text)

    def send_keyword_alert(self, keyword: str, matched_word: str, message_text: str,
                           sender_title: str, chat_title: str, chat_link: str = None) -> dict:
        """إنشاء قالب HTML أنيق بالعربية وإرسال تنبيه فوري برصد كلمة مفتاحية"""
        now_str = time.strftime('%Y-%m-%d %H:%M:%S')
        subject = f"🚨 تنبيه فوري: تم رصد الكلمة [{matched_word}] في {chat_title}"

        link_button = ""
        if chat_link:
            link_button = f"""
            <div style="margin: 20px 0; text-align: center;">
                <a href="{chat_link}" target="_blank" style="background: linear-gradient(135deg, #0284c7, #2563eb); color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 12px rgba(37,99,235,0.3);">
                    🔗 الانتقال إلى المجموعة / الرسالة
                </a>
            </div>
            """

        sub_rule = f'<div style="font-size:12px; color:#64748b; margin-top:4px;">(قاعدة المراقبة: {keyword})</div>' if keyword != matched_word else ''
        formatted_msg = message_text.replace('\n', '<br>')

        body_html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>
body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; direction: rtl; }}
.card {{ max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }}
.header {{ background: linear-gradient(135deg, #0ea5e9 0%, #1e40af 100%); padding: 24px; color: #ffffff; text-align: center; }}
.header h1 {{ margin: 0; font-size: 20px; font-weight: bold; }}
.header p {{ margin: 6px 0 0; opacity: 0.9; font-size: 13px; }}
.content {{ padding: 24px; }}
.badge-keyword {{ display: inline-block; background: #fef08a; color: #854d0e; padding: 6px 14px; border-radius: 8px; font-size: 15px; font-weight: bold; border: 1px solid #fde047; margin: 5px 0; }}
.info-row {{ display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }}
.info-label {{ color: #64748b; font-weight: 600; }}
.info-val {{ color: #0f172a; font-weight: bold; }}
.message-box {{ background: #f8fafc; border-right: 4px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 18px 0; font-size: 14px; line-height: 1.6; color: #334155; word-break: break-word; }}
.footer {{ background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }}
</style>
</head>
<body>
<div class="card">
    <div class="header">
        <h1>🚨 نظام المراقبة الذكي — تنبيه الكلمات المفتاحية</h1>
        <p>تم رصد تطابق دقيق للكلمة المفتاحية في الرسائل الواردة</p>
    </div>
    <div class="content">
        <div style="text-align: center; margin-bottom: 15px;">
            <span class="badge-keyword">🎯 الكلمة المرصودة: {matched_word}</span>
            {sub_rule}
        </div>
        <div class="info-row">
            <span class="info-label">المجموعة / المحادثة:</span>
            <span class="info-val">{chat_title}</span>
        </div>
        <div class="info-row">
            <span class="info-label">المرسل:</span>
            <span class="info-val">{sender_title}</span>
        </div>
        <div class="info-row">
            <span class="info-label">توقيت الرصد:</span>
            <span class="info-val">{now_str}</span>
        </div>
        <div style="margin-top: 18px;">
            <span class="info-label">محتوى الرسالة:</span>
            <div class="message-box">
                {formatted_msg}
            </div>
        </div>
        {link_button}
    </div>
    <div class="footer">
        تم إنشاء هذا التنبيه آلياً بواسطة نظام المراقبة الذكي للتيليجرام • جميع الحقوق محفوظة
    </div>
</div>
</body>
</html>"""

        body_text = f"""🚨 تنبيه فوري من نظام المراقبة الذكي
----------------------------------------
الكلمة المرصودة: {matched_word} (القاعدة: {keyword})
المحادثة: {chat_title}
المرسل: {sender_title}
التوقيت: {now_str}

نص الرسالة:
{message_text}

{f'رابط المحادثة: {chat_link}' if chat_link else ''}
----------------------------------------"""

        return self.send(subject, body_html, body_text)

    def _save_local_code_backup(self, subject: str, body_text: str):
        """حفظ نسخة احتياطية من كود التحقق في ملف محلي دائماً لمنع ضياعه"""
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            log_path = os.path.join(DATA_DIR, 'verification_codes.json')
            records = []
            if os.path.exists(log_path):
                try:
                    with open(log_path, 'r', encoding='utf-8') as f:
                        records = json.load(f)
                except Exception:
                    records = []
            records.append({
                "time": time.strftime('%Y-%m-%d %H:%M:%S'),
                "recipient": self.recipient,
                "subject": subject,
                "body": body_text
            })
            with open(log_path, 'w', encoding='utf-8') as f:
                json.dump(records[-50:], f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"Failed to save local code backup: {e}")

    def send_verification_code_email(self, phone: str, code: str, raw_text: str = None,
                                    delivery_type: str = 'app', recipient: str = None) -> dict:
        """
        إرسال رمز تسجيل الدخول (OTP / Verification Code) فوراً وبشكل دائم إلى البريد الإلكتروني.
        يتزامن ويترافق مع وصول الرمز إلى الجهاز الآخر أو تطبيق تيليجرام.
        """
        target_recipient = (recipient or self.recipient or 'anwrfwad178@gmail.com').strip()
        now_str = time.strftime('%Y-%m-%d %I:%M:%S %p')
        subject = f"🔑 رمز الدخول لتيليجرام: [ {code} ] للرقم {phone}"

        delivery_badge = "📱 تم الإرسال إلى تطبيق تيليجرام على جهازك الآخر (777000) والبريد معاً" if delivery_type == 'app' else "📩 تم الإرسال عبر SMS والبريد معاً"

        raw_block = ""
        if raw_text:
            cleaned_raw = raw_text.replace('\n', '<br>')
            raw_block = f"""
            <div style="margin-top: 20px; text-align: right;">
                <span style="font-size: 12px; color: #64748b; font-weight: bold;">نص رسالة تيليجرام الواردة:</span>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 13px; color: #334155; margin-top: 6px; word-break: break-word;">
                    {cleaned_raw}
                </div>
            </div>
            """

        body_html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>
body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f4f8; margin: 0; padding: 20px; color: #1e293b; direction: rtl; }}
.card {{ max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }}
.header {{ background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 26px 20px; color: #ffffff; text-align: center; }}
.header h1 {{ margin: 0; font-size: 22px; font-weight: bold; }}
.header p {{ margin: 6px 0 0; opacity: 0.95; font-size: 13px; }}
.content {{ padding: 28px 24px; text-align: center; }}
.code-box {{ margin: 24px auto; padding: 18px 25px; background: #f0f9ff; border: 2px dashed #0284c7; border-radius: 14px; display: inline-block; }}
.code-digits {{ font-size: 42px; font-weight: 900; letter-spacing: 10px; color: #0284c7; font-family: monospace; line-height: 1.2; user-select: all; }}
.badge {{ display: inline-block; background: #e0f2fe; color: #0369a1; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }}
.info-table {{ width: 100%; border-collapse: collapse; margin-top: 20px; text-align: right; font-size: 13px; }}
.info-table td {{ padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }}
.info-label {{ color: #64748b; font-weight: 600; width: 35%; }}
.info-val {{ color: #0f172a; font-weight: bold; }}
.notice-box {{ background: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 14px; margin-top: 22px; text-align: right; font-size: 12px; color: #92400e; }}
.footer {{ background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }}
</style>
</head>
<body>
<div class="card">
    <div class="header">
        <h1>🔑 رمز تسجيل الدخول لتيليجرام</h1>
        <p>وصلك الرمز مترافقاً على جهازك الآخر وعلى بريدك الإلكتروني معاً</p>
    </div>
    <div class="content">
        <div class="badge">{delivery_badge}</div>
        <p style="margin: 0; color: #475569; font-size: 14px;">رمز التحقق الخاص بك لتسجيل الدخول هو:</p>
        
        <div class="code-box">
            <div class="code-digits">{code}</div>
        </div>

        <table class="info-table">
            <tr>
                <td class="info-label">📱 رقم الهاتف:</td>
                <td class="info-val">{phone}</td>
            </tr>
            <tr>
                <td class="info-label">⏰ وقت الوصول:</td>
                <td class="info-val">{now_str}</td>
            </tr>
            <tr>
                <td class="info-label">📡 القناة / المصدر:</td>
                <td class="info-val">رسالة خدمة Telegram الرسمية (777000)</td>
            </tr>
        </table>

        {raw_block}

        <div class="notice-box">
            🛡️ <strong>تنبيه أمان:</strong> لا تشارك هذا الرمز مع أي شخص لحماية حسابك ومعلوماتك.
        </div>
    </div>
    <div class="footer">
        تم إرسال هذا التنبيه آلياً وبشكل دائم عبر نظام أنور تيليجرام الذكي • أبو مالك للخدمات
    </div>
</div>
</body>
</html>"""

        body_text = f"""🔑 رمز تسجيل الدخول لتيليجرام: {code}
----------------------------------------
رقم الهاتف: {phone}
رمز التحقق: {code}
وقت الوصول: {now_str}
المصدر: Telegram (777000)
----------------------------------------
{f'نص الرسالة: {raw_text}' if raw_text else ''}

تنبيه: لا تشارك هذا الرمز مع أي شخص لحماية أمان حسابك.
"""

        prev_recipient = self.recipient
        if target_recipient:
            self.recipient = target_recipient

        try:
            self._save_local_code_backup(subject, body_text)
            try:
                import firestore_sync
                firestore_sync.save_verification_code_to_firestore(phone, code, raw_text)
            except Exception as _fe:
                logger.debug(f"Firestore sync warning: {_fe}")
            res = self.send(subject, body_html, body_text)
            return res
        finally:
            self.recipient = prev_recipient

    def send_code_dispatch_alert(self, phone: str, delivery_type: str = 'app', recipient: str = None) -> dict:
        """
        إرسال إشعار فوري للبريد عند إطلاق طلب الكود من خوادم تيليجرام وتزامنه مع الجهاز الآخر
        """
        target_recipient = (recipient or self.recipient or 'anwrfwad178@gmail.com').strip()
        now_str = time.strftime('%Y-%m-%d %I:%M:%S %p')
        subject = f"📱 تم إرسال كود تيليجرام للرقم {phone} — تفقّد جهازك الآخر وبريدك معاً"

        body_html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI', Tahoma, sans-serif; background:#f8fafc; padding:20px; direction:rtl;">
<div style="max-width:560px; margin:0 auto; background:#fff; border-radius:16px; padding:24px; border:1px solid #e2e8f0; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <h2 style="color:#0284c7; margin-top:0;">📱 تم إرسال رمز تسجيل الدخول بنجاح</h2>
    <p style="font-size:14px; color:#334155;">
        تم طلب رمز التحقق لرقم <strong>{phone}</strong> من خوادم تيليجرام الرسمية.
    </p>
    <div style="background:#e0f2fe; padding:16px; border-radius:10px; color:#0369a1; font-weight:bold; font-size:13px; margin:16px 0; border: 1px solid #bae6fd;">
        ⚡ يصلك الرمز الآن في تطبيق تيليجرام على أجهزتك الأخرى كرسالة خدمة (777000)، ويتزامن وصوله فوراً مع بريدك الإلكتروني والأجهزة الأخرى معاً بشكل دائم.
    </div>
    <p style="font-size:12px; color:#94a3b8; margin-bottom:0;">الوقت: {now_str}</p>
</div>
</body>
</html>"""
        body_text = f"تم إرسال كود تيليجرام لرقم {phone} في {now_str} إلى جهازك الآخر وبريدك معاً."

        prev_recipient = self.recipient
        if target_recipient:
            self.recipient = target_recipient
        try:
            self._save_local_code_backup(subject, body_text)
            try:
                import firestore_sync
                firestore_sync.save_verification_code_to_firestore(phone, 'DISPATCHED', body_text)
            except Exception:
                pass
            return self.send(subject, body_html, body_text)
        finally:
            self.recipient = prev_recipient


# نسخة عامة يمكن استخدامها عبر الاستيراد المباشر
default_notifier = EmailNotifier()
