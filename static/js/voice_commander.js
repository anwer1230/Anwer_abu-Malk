/**
 * VoiceCommander - محرك التحكم الصوتي الذاتي الشامل لتطبيق مركز سرعة إنجاز
 * يدعم الاستماع المستمر، تحويل الأرقام واللهجات العربية، استخلاص النوايا وتنفيذ الأوامر فعلياً
 */

(function (window, document) {
    'use strict';

    // جدول تحويل الكلمات العربية المنطوقة للأرقام
    const ARABIC_WORD_TO_DIGIT = {
        'صفر': '0', 'زيرو': '0',
        'واحد': '1', 'واحده': '1', 'واحدة': '1', 'الاول': '1', 'الأول': '1',
        'اثنين': '2', 'إثنين': '2', 'اتنين': '2', 'اثنان': '2', 'الثاني': '2',
        'ثلاثة': '3', 'تلاتة': '3', 'ثلاث': '3', 'تلاته': '3', 'الثالث': '3',
        'اربعة': '4', 'أربعة': '4', 'اربع': '4', 'أربع': '4', 'الرابع': '4',
        'خمسة': '5', 'خمس': '5', 'الخامس': '5',
        'ستة': '6', 'ست': '6', 'السادس': '6',
        'سبعة': '7', 'سبع': '7', 'السابع': '7',
        'ثمانية': '8', 'تمانية': '8', 'ثمان': '8', 'تمان': '8', 'الثامن': '8',
        'تسعة': '9', 'تسع': '9', 'التاسع': '9',
        'زائد': '+', 'موجب': '+', 'بلس': '+'
    };

    const ARABIC_EASTERN_DIGITS = {
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
        '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
    };

    class VoiceCommander {
        constructor() {
            this.recognition = null;
            this.isListening = false;
            this.ttsEnabled = true;
            this.autoRestart = true;
            this.synth = window.speechSynthesis || null;
            this.audioCtx = null;
            this.lastTranscript = '';
            this.processingLock = false;
            this.init();
        }

        init() {
            // التحقق من دعم المتصفح للتعرف على الصوت
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                console.warn('[VoiceCommander] SpeechRecognition is not supported in this browser.');
                this.supported = false;
                return;
            }
            this.supported = true;

            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'ar-SA';
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.maxAlternatives = 1;

            this.bindEvents();
            this.injectUI();
        }

        bindEvents() {
            if (!this.recognition) return;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateUIState(true);
                this.playTone(440, 0.1);
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.updateUIState(false);
                // إعادة التشغيل التلقائي إذا كان وضع الاستماع الدائم مفعلاً
                if (this.autoRestart && this.shouldStayActive) {
                    try {
                        this.recognition.start();
                    } catch (_) {}
                }
            };

            this.recognition.onerror = (e) => {
                console.warn('[VoiceCommander] Speech Error:', e.error);
                if (e.error === 'not-allowed') {
                    this.shouldStayActive = false;
                    this.speak('يرجى السماح بصلاحية الميكروفون لاستخدام التحكم الصوتي');
                }
            };

            this.recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                const currentText = (finalTranscript || interimTranscript).trim();
                if (currentText) {
                    this.showTranscript(currentText, Boolean(finalTranscript));
                }

                if (finalTranscript && !this.processingLock) {
                    this.handleVoiceCommand(finalTranscript.trim());
                }
            };
        }

        // تشغيل نغمة صوتية ترحيبية أو تأكيدية لطيفة
        playTone(freq = 440, duration = 0.15) {
            try {
                if (!this.audioCtx) {
                    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
                gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.start();
                osc.stop(this.audioCtx.currentTime + duration);
            } catch (_) {}
        }

        // نطق الرد الصوتي العربي للمستخدم
        speak(text) {
            if (!this.ttsEnabled || !this.synth || !text) return;
            try {
                this.synth.cancel(); // إلغاء أي كلام سابق
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'ar-SA';
                utterance.rate = 1.05;
                utterance.pitch = 1.0;

                // محاولة اختيار أفضل صوت عربي متوفر
                const voices = this.synth.getVoices();
                const arVoice = voices.find(v => v.lang.startsWith('ar') || v.name.includes('Arabic'));
                if (arVoice) utterance.voice = arVoice;

                this.setSpeakingState(true);
                utterance.onend = () => this.setSpeakingState(false);
                utterance.onerror = () => this.setSpeakingState(false);
                this.synth.speak(utterance);
            } catch (err) {
                console.warn('[VoiceCommander] TTS Error:', err);
                this.setSpeakingState(false);
            }
        }

        // توحيد وتنقية النص العربي من التشكيل واختلافات الحروف لتسهيل المطابقة الدقيقة
        normalizeArabic(text) {
            if (!text) return '';
            return text
                .toLowerCase()
                .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة التشكيل
                .replace(/[إأآٱ]/g, 'ا')              // توحيد الألف
                .replace(/[ىي]/g, 'ي')                // توحيد الياء
                .replace(/[ة]/g, 'ه')                 // توحيد التاء المربوطة
                .replace(/[ؤئ]/g, 'ء')                // توحيد الهمزات
                .replace(/[،,.\-!?؟:;]/g, ' ')        // إزالة علامات الترقيم
                .replace(/\s+/g, ' ')
                .trim();
        }

        // تطبيع وتحويل الكلمات والأرقام العربية إلى أرقام نقية
        normalizeSpokenDigits(text) {
            if (!text) return '';
            let s = text.trim();

            // استبدال الأرقام المشرقية ٠١٢٣٤٥٦٧٨٩
            for (const [k, v] of Object.entries(ARABIC_EASTERN_DIGITS)) {
                s = s.split(k).join(v);
            }

            // استبدال الكلمات النصية للأرقام
            const words = s.split(/\s+/);
            const converted = words.map(w => {
                const cleaned = w.replace(/[،,.]/g, '');
                return ARABIC_WORD_TO_DIGIT[cleaned] !== undefined ? ARABIC_WORD_TO_DIGIT[cleaned] : w;
            });
            s = converted.join(' ');

            const digitMatches = s.match(/[\d+]+/g);
            return digitMatches ? digitMatches.join('') : '';
        }

        // استخلاص الأرقام من العبارة المنطوقة
        extractNumbers(text) {
            if (!text) return '';
            let s = text.trim();
            for (const [k, v] of Object.entries(ARABIC_EASTERN_DIGITS)) {
                s = s.split(k).join(v);
            }
            let words = s.split(/\s+/);
            let digitsStr = '';
            for (const w of words) {
                const cleanW = w.replace(/[،,.]/g, '');
                if (ARABIC_WORD_TO_DIGIT[cleanW] !== undefined) {
                    digitsStr += ARABIC_WORD_TO_DIGIT[cleanW];
                } else if (/^\d+$/.test(cleanW)) {
                    digitsStr += cleanW;
                }
            }
            if (digitsStr) return digitsStr;
            return this.normalizeSpokenDigits(text);
        }

        // إضاءة وتظليل العنصر المتأثر على الشاشة بصرياً
        highlight(el) {
            if (!el) return;
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (_) {}
            el.classList.add('voice-command-highlight');
            setTimeout(() => {
                el.classList.remove('voice-command-highlight');
            }, 2500);
        }

        // معالجة الأمر الصوتي الرئيسي بالذكاء والمرونة العالية
        async handleVoiceCommand(rawTranscript) {
            if (!rawTranscript || !rawTranscript.trim()) return;
            const norm = this.normalizeArabic(rawTranscript);
            const digits = this.extractNumbers(rawTranscript);
            console.log('[VoiceCommander] 🎙️ Recieved Command:', rawTranscript, '| Normalized:', norm, '| Digits:', digits);
            this.processingLock = true;

            try {
                // 1. إدخال كود التحقق وتأكيده صوتياً (سواء صراحة أو أثناء عرض نموذج الكود)
                const isVerifyFormVisible = document.getElementById('verifyForm')?.style.display !== 'none';
                if (norm.includes('كود') || norm.includes('رمز') || (isVerifyFormVisible && digits && digits.length >= 3)) {
                    if (digits && digits.length >= 3) {
                        await this.cmdVerifyCode(digits);
                        return;
                    }
                }

                // 2. التحقق بخطوتين / كلمة المرور
                const isPasswordFormVisible = document.getElementById('passwordForm')?.style.display !== 'none';
                if (norm.includes('كلمه المرور') || norm.includes('كلمه السر') || norm.includes('باسورد') || norm.includes('السر') || norm.includes('رمز سري') || (isPasswordFormVisible && !digits)) {
                    let pass = rawTranscript.replace(/.*(كلمة المرور|كلمة السر|الباسورد|السر|رمز سري|باسورد|الباسوورد|كلمه المرور|كلمه السر)\s*(هي|هو)?\s*/i, '').trim();
                    if (!pass && isPasswordFormVisible) pass = rawTranscript.trim();
                    if (pass) {
                        await this.cmdVerifyPassword(pass);
                        return;
                    }
                }

                // 3. إعادة إرسال الكود
                if (norm.includes('اعاده ارسال') || norm.includes('ارسل الكود') || norm.includes('ابعث الكود') || norm.includes('كود جديد') || norm.includes('كود تاني')) {
                    const forceSms = norm.includes('رساله') || norm.includes('sms') || norm.includes('نصيه');
                    await this.cmdResendCode(forceSms);
                    return;
                }

                // 4. تسجيل الخروج
                if (norm.includes('خروج') || norm.includes('تسجيل خروج') || norm.includes('سجل خروج') || norm.includes('انهاء الجلسه') || norm.includes('logout')) {
                    await this.cmdLogout();
                    return;
                }

                // 5. أوامر تسجيل الدخول (بحساب معين، برقم هاتف، أو تسجيل دخول مباشر)
                if (norm.includes('سجل') || norm.includes('دخول') || norm.includes('ادخل') || norm.includes('حساب') || norm.includes('لميس') || norm.includes('login')) {
                    // فحص حساب لميس (الحساب الأول)
                    if (norm.includes('لميس') || norm.includes('حساب 1') || norm.includes('الحساب الاول') || norm.includes('الاول')) {
                        await this.cmdLoginNamedAccount('user_1', '+201120945094', 'لميس');
                        return;
                    }

                    // فحص الحساب الثاني
                    if (norm.includes('الثاني') || norm.includes('حساب 2')) {
                        await this.cmdLoginNamedAccount('user_2', '+201221349790', 'الحساب الثاني');
                        return;
                    }

                    // فحص الحساب الثالث
                    if (norm.includes('الثالث') || norm.includes('حساب 3')) {
                        await this.cmdLoginNamedAccount('user_3', '+201148863243', 'الحساب الثالث');
                        return;
                    }

                    // فحص تسجيل الدخول برقم هاتف مخصص منطوق
                    if (digits && digits.length >= 8) {
                        await this.cmdLoginByPhoneNumber(digits);
                        return;
                    }

                    // تسجيل دخول فوري بالحساب المحدد حالياً
                    await this.cmdLoginDefault();
                    return;
                }

                // 6. التحكم في الإرسال: بدء الإرسال (إرسال الآن)
                if (norm.includes('ابدا') || norm.includes('ارسل الان') || norm.includes('ارسل') || norm.includes('تشغيل') || norm.includes('انطلق') || norm.includes('send') || norm.includes('start')) {
                    if (!norm.includes('كود')) {
                        await this.cmdStartBroadcast();
                        return;
                    }
                }

                // 7. التحكم في الإرسال: إيقاف الإرسال
                if (norm.includes('اوقف') || norm.includes('وقف') || norm.includes('توقف') || norm.includes('ايقاف') || norm.includes('الغاء') || norm.includes('stop')) {
                    await this.cmdStopBroadcast();
                    return;
                }

                // 8. استعراض وفحص روابط قاعدة البيانات السحابية
                if (norm.includes('روابط') || norm.includes('الروابط') || norm.includes('استعرض') || norm.includes('قاعده البيانات') || norm.includes('فحص الروابط')) {
                    if (norm.includes('بي دي اف') || norm.includes('pdf')) {
                        await this.cmdExportLinks('pdf');
                        return;
                    }
                    if (norm.includes('نص') || norm.includes('txt') || norm.includes('تكست')) {
                        await this.cmdExportLinks('txt');
                        return;
                    }
                    await this.cmdInspectCloudLinks();
                    return;
                }

                // 9. تصدير الروابط
                if (norm.includes('تصدير') || norm.includes('تنزيل') || norm.includes('تحميل')) {
                    if (norm.includes('pdf') || norm.includes('بي دي اف')) {
                        await this.cmdExportLinks('pdf');
                        return;
                    }
                    if (norm.includes('txt') || norm.includes('نص') || norm.includes('تكست')) {
                        await this.cmdExportLinks('txt');
                        return;
                    }
                }

                // 10. اختيار نوع الإرسال
                if (norm.includes('مجموعات') || norm.includes('جروبات') || norm.includes('قروبات')) {
                    await this.cmdSelectSendType('groups');
                    return;
                }
                if (norm.includes('قنوات') || norm.includes('قناه')) {
                    await this.cmdSelectSendType('channels');
                    return;
                }
                if (norm.includes('فردي') || norm.includes('خاص') || norm.includes('مستخدمين')) {
                    await this.cmdSelectSendType('users');
                    return;
                }
                if (norm.includes('مختلط') || norm.includes('شامل') || norm.includes('الكل')) {
                    await this.cmdSelectSendType('mixed');
                    return;
                }

                // 11. ضبط الفاصل الزمني
                if (norm.includes('فاصل') || norm.includes('ثانيه') || norm.includes('دقيقه') || norm.includes('وقت')) {
                    if (digits) {
                        let sec = parseInt(digits, 10);
                        if (norm.includes('دقيقه') || norm.includes('دقايق')) sec = sec * 60;
                        await this.cmdSetInterval(sec);
                        return;
                    }
                }

                // 12. حفظ الإعدادات
                if (norm.includes('احفظ') || norm.includes('حفظ') || norm.includes('تثبيت') || norm.includes('save')) {
                    await this.cmdSaveSettings();
                    return;
                }

                // 13. نص الرسالة
                if (norm.startsWith('اكتب') || norm.includes('الرساله هي') || norm.includes('نص الرساله')) {
                    const msg = rawTranscript.replace(/^(اكتب في الرسالة|اكتب رسالة|اكتب|الرسالة هي|نص الرسالة|اكتب في الرساله|اكتب رساله|الرساله هي)\s*/i, '').trim();
                    if (msg) {
                        await this.cmdSetMessage(msg);
                        return;
                    }
                }

                // 14. التنقل والاستفسار العام عن الحالة
                if (norm.includes('حاله') || norm.includes('مين متصل') || norm.includes('الوضع') || norm.includes('متصل')) {
                    await this.cmdCheckStatus();
                    return;
                }

                if (norm.includes('محلل') || norm.includes('مستندات') || norm.includes('ذكاء اصطناعي')) {
                    this.speak('جارٍ فتح المحلل الذكي للمستندات والصور');
                    window.location.href = '/ai_doc_analyzer';
                    return;
                }

                if (norm.includes('الرئيسيه') || norm.includes('لوحه التحكم')) {
                    this.speak('جارٍ الانتقال إلى الصفحة الرئيسية');
                    window.location.href = '/';
                    return;
                }

                // لم يتم التعرف على أمر محدد
                this.speak('سمعت أمرك: ' + rawTranscript + '. يمكنك قول: سجل بحساب لميس، أو ابدأ الإرسال، أو استعرض الروابط.');

            } catch (err) {
                console.error('[VoiceCommander] Execution Error:', err);
                this.speak('حدث خطأ أثناء تنفيذ الأمر: ' + (err.message || ''));
            } finally {
                setTimeout(() => {
                    this.processingLock = false;
                }, 1200);
            }
        }

        // ======================= دوال التنفيذ الفعلية للأوامر بدقة تامة =======================

        async cmdLoginNamedAccount(uid, phone, name) {
            this.speak(`جارٍ تسجيل الدخول بحساب ${name}`);
            const dropdown = document.getElementById('savedPhonesDropdown');
            const phoneInput = document.getElementById('phone');

            if (dropdown) {
                let found = false;
                for (let i = 0; i < dropdown.options.length; i++) {
                    if (dropdown.options[i].value === phone || dropdown.options[i].text.includes(name)) {
                        dropdown.selectedIndex = i;
                        dropdown.dispatchEvent(new Event('change'));
                        found = true;
                        break;
                    }
                }
                if (!found) dropdown.value = phone;
                this.highlight(dropdown);
            }

            if (phoneInput) {
                phoneInput.value = phone;
                phoneInput.dispatchEvent(new Event('input'));
                phoneInput.dispatchEvent(new Event('change'));
                this.highlight(phoneInput);
            }

            setTimeout(() => {
                const loginBtn = document.getElementById('loginBtn');
                const loginForm = document.getElementById('loginForm');
                if (loginBtn) {
                    this.highlight(loginBtn);
                    loginBtn.click();
                } else if (loginForm) {
                    loginForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                } else if (typeof window.submitLogin === 'function') {
                    window.submitLogin();
                }
            }, 400);
        }

        async cmdLoginDefault() {
            this.speak('جارٍ بدء تسجيل الدخول');
            const dropdown = document.getElementById('savedPhonesDropdown');
            const phoneInput = document.getElementById('phone');

            if (!phoneInput?.value && dropdown && dropdown.value) {
                phoneInput.value = dropdown.value;
                phoneInput.dispatchEvent(new Event('change'));
            }

            if (!phoneInput?.value) {
                return this.cmdLoginNamedAccount('user_1', '+201120945094', 'لميس');
            }

            setTimeout(() => {
                const loginBtn = document.getElementById('loginBtn');
                const loginForm = document.getElementById('loginForm');
                if (loginBtn) {
                    this.highlight(loginBtn);
                    loginBtn.click();
                } else if (loginForm) {
                    loginForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                } else if (typeof window.submitLogin === 'function') {
                    window.submitLogin();
                }
            }, 300);
        }

        async cmdLoginByPhoneNumber(phone) {
            let formatted = phone.startsWith('+') ? phone : ('+' + phone);
            this.speak(`جارٍ تسجيل الدخول بالرقم ${formatted}`);
            const phoneInput = document.getElementById('phone');
            if (phoneInput) {
                phoneInput.value = formatted;
                phoneInput.dispatchEvent(new Event('input'));
                phoneInput.dispatchEvent(new Event('change'));
                this.highlight(phoneInput);
            }
            setTimeout(() => {
                const loginBtn = document.getElementById('loginBtn');
                const loginForm = document.getElementById('loginForm');
                if (loginBtn) {
                    this.highlight(loginBtn);
                    loginBtn.click();
                } else if (loginForm) {
                    loginForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                } else if (typeof window.submitLogin === 'function') {
                    window.submitLogin();
                }
            }, 400);
        }

        async cmdLogout() {
            this.speak('جارٍ تسجيل الخروج وإنهاء جلسة التليجرام');
            const logoutBtn = document.getElementById('logoutButton');
            if (logoutBtn) {
                this.highlight(logoutBtn);
                logoutBtn.click();
            }
        }

        async cmdVerifyCode(code) {
            this.speak(`تم استلام الكود ${code.split('').join(' ')}، جارٍ التحقق والتأكيد`);
            const codeInput = document.getElementById('verificationCode') || document.querySelector('input[name="code"]');
            if (codeInput) {
                codeInput.value = code;
                codeInput.dispatchEvent(new Event('input'));
                codeInput.dispatchEvent(new Event('change'));
                this.highlight(codeInput);
            }
            setTimeout(() => {
                const verifyForm = document.getElementById('verifyForm');
                const submitBtn = verifyForm ? verifyForm.querySelector('button[type="submit"]') : null;
                if (submitBtn) {
                    this.highlight(submitBtn);
                    submitBtn.click();
                } else if (verifyForm) {
                    verifyForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                } else if (typeof window.submitCode === 'function') {
                    window.submitCode();
                }
            }, 350);
        }

        async cmdVerifyPassword(password) {
            this.speak('تم إدخال كلمة المرور، جارٍ التحقق بخطوتين');
            const passInput = document.getElementById('twoFactorPassword') || document.getElementById('password');
            if (passInput) {
                passInput.value = password;
                passInput.dispatchEvent(new Event('input'));
                passInput.dispatchEvent(new Event('change'));
                this.highlight(passInput);
            }
            setTimeout(() => {
                const passForm = document.getElementById('passwordForm');
                const submitBtn = passForm ? passForm.querySelector('button[type="submit"]') : null;
                if (submitBtn) {
                    this.highlight(submitBtn);
                    submitBtn.click();
                } else if (passForm) {
                    passForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                } else if (typeof window.submitPassword === 'function') {
                    window.submitPassword();
                }
            }, 350);
        }

        async cmdResendCode(forceSms = false) {
            this.speak(forceSms ? 'جارٍ إعادة إرسال الكود عبر الرسائل القصيرة SMS' : 'جارٍ إعادة إرسال كود التحقق عبر تليجرام');
            const btn = document.getElementById(forceSms ? 'resendSmsBtn' : 'resendCodeBtn');
            if (btn) {
                this.highlight(btn);
                btn.click();
            } else if (typeof window.resendCode === 'function') {
                window.resendCode(forceSms);
            }
        }

        async cmdInspectCloudLinks() {
            this.speak('جارٍ فتح واستعراض الروابط المحفوظة ومزامنة السحابة');
            const btn = document.getElementById('btnSavedLinks');
            if (btn) {
                this.highlight(btn);
                btn.click();
            } else if (typeof window.openSavedLinksModal === 'function') {
                window.openSavedLinksModal();
            }
        }

        async cmdExportLinks(format = 'pdf') {
            if (format === 'pdf') {
                this.speak('جارٍ إنشاء وتصدير ملف الروابط بصيغة PDF إلى جهازك');
                const btn = document.getElementById('exportPdfBtn') || document.getElementById('exportAllPdfBtn');
                if (btn) {
                    this.highlight(btn);
                    btn.click();
                } else if (typeof window.exportSavedLinksPDF === 'function') {
                    window.exportSavedLinksPDF();
                }
            } else {
                this.speak('جارٍ تصدير ملف الروابط النصي TXT إلى جهازك');
                const btn = document.getElementById('exportTxtBtn') || document.getElementById('exportAllTxtBtn');
                if (btn) {
                    this.highlight(btn);
                    btn.click();
                } else if (typeof window.exportSavedLinksTXT === 'function') {
                    window.exportSavedLinksTXT();
                }
            }
        }

        async cmdStartBroadcast() {
            this.speak('أمر مؤكد: جارٍ بدء مهمة الإرسال الآن');
            const sendNowBtn = document.getElementById('sendNowBtn');
            if (sendNowBtn) {
                this.highlight(sendNowBtn);
                sendNowBtn.click();
            } else if (typeof window.startSendingNow === 'function') {
                window.startSendingNow();
            }
        }

        async cmdStopBroadcast() {
            this.speak('أمر مؤكد: تم إيقاف مهمة الإرسال');
            const stopBtn = document.getElementById('stopSendNowBtn') || document.getElementById('stopMonitoringBtn');
            if (stopBtn) {
                this.highlight(stopBtn);
                stopBtn.click();
            } else if (typeof window.stopSendingNow === 'function') {
                window.stopSendingNow();
            }
        }

        async cmdSelectSendType(type) {
            const types = {
                'groups': 'إرسال للمجموعات فقط',
                'channels': 'إرسال للقنوات فقط',
                'users': 'إرسال فردي للخاص فقط',
                'mixed': 'إرسال شامل (مجموعات وقنوات)'
            };
            this.speak(`تم تحديد نوع الإرسال: ${types[type] || type}`);
            const select = document.getElementById('sendType');
            if (select) {
                select.value = type;
                select.dispatchEvent(new Event('change'));
                this.highlight(select);
            }
        }

        async cmdSetInterval(seconds) {
            this.speak(`تم ضبط الفاصل الزمني على ${seconds} ثانية`);
            const intervalInput = document.getElementById('intervalSeconds');
            if (intervalInput) {
                intervalInput.value = seconds;
                intervalInput.dispatchEvent(new Event('input'));
                intervalInput.dispatchEvent(new Event('change'));
                this.highlight(intervalInput);
            }
        }

        async cmdSaveSettings() {
            this.speak('جارٍ حفظ الإعدادات');
            const saveBtn = document.getElementById('btnSaveSettings');
            if (saveBtn) {
                this.highlight(saveBtn);
                saveBtn.click();
            } else if (typeof window.saveSettings === 'function') {
                window.saveSettings();
            }
        }

        async cmdSetMessage(msgText) {
            this.speak('تم وضع نص الرسالة بنجاح');
            const msgArea = document.getElementById('message');
            if (msgArea) {
                msgArea.value = msgText;
                msgArea.dispatchEvent(new Event('input'));
                msgArea.dispatchEvent(new Event('change'));
                this.highlight(msgArea);
            }
        }

        async cmdCheckStatus() {
            try {
                const res = await fetch('/api/get_login_status');
                const data = await res.json();
                const name = data.account_name || 'حساب لميس';
                const status = data.logged_in ? 'متصل وموثق' : 'غير متصل حالياً';
                const running = data.is_running ? 'وهناك مهمة إرسال قيد التشغيل' : 'ولا توجد مهام إرسال تعمل حالياً';
                this.speak(`الحساب النشط هو ${name}، الحالة: ${status}، ${running}.`);
            } catch (_) {
                this.speak('التطبيق يعمل بشكل طبيعي ومتصل بالخادم.');
            }
        }

        // ======================= إدارة واجهة المستخدم الصوتية =======================

        toggle() {
            if (this.isListening) {
                this.stop();
            } else {
                this.start();
            }
        }

        start() {
            if (!this.supported) {
                alert('التعرف الصوتي غير مدعوم في متصفحك الحالي. يرجى استخدام Google Chrome أو متصفح يدعم Web Speech API.');
                return;
            }
            this.shouldStayActive = true;
            try {
                this.recognition.start();
                this.speak('نظام الأوامر الصوتية نشط. أنا أستمع إليك الآن.');
            } catch (e) {
                console.warn('[VoiceCommander] Already started or busy:', e);
            }
        }

        stop() {
            this.shouldStayActive = false;
            if (this.recognition) {
                try {
                    this.recognition.stop();
                    this.speak('تم إيقاف وضع الاستماع الصوتي.');
                } catch (_) {}
            }
            this.updateUIState(false);
        }

        toggleTTS() {
            this.ttsEnabled = !this.ttsEnabled;
            const btn = document.getElementById('voiceTtsToggleBtn');
            if (btn) {
                btn.innerHTML = this.ttsEnabled ? '<i class="fas fa-volume-up text-success"></i>' : '<i class="fas fa-volume-mute text-secondary"></i>';
                btn.title = this.ttsEnabled ? 'الرد الصوتي ناطق (مفعّل)' : 'الرد الصوتي صامت';
            }
            if (this.ttsEnabled) this.speak('تم تفعيل الرد الصوتي الناطق.');
        }

        updateUIState(active) {
            const btn = document.getElementById('floatingVoiceBtn');
            const hud = document.getElementById('voiceCommanderHud');
            const wave = document.getElementById('voiceWaveIndicator');

            // ── مزامنة بطاقة وأيقونة الأوامر الصوتية في رأس الصفحة المقابلة للمزايا ──
            const headerBtn   = document.getElementById('headerVoiceToggleBtn');
            const headerIcon  = document.getElementById('headerVoiceIcon');
            const headerBadge = document.getElementById('headerVoiceStatusBadge');
            const headerWave  = document.getElementById('headerVoiceWave');
            const headerBox   = document.getElementById('headerVoiceBox');

            if (headerBtn) {
                if (active) {
                    headerBtn.classList.add('voice-header-active');
                    if (headerIcon) {
                        headerIcon.className = 'fas fa-microphone text-danger fa-beat';
                    }
                    if (headerBadge) {
                        headerBadge.textContent = '🔴 يستمع الآن (تحدث بأمرك)';
                        headerBadge.className = 'badge bg-danger text-white shadow-sm';
                    }
                    if (headerWave) headerWave.style.display = 'inline-flex';
                    if (headerBox) headerBox.classList.add('voice-box-active');
                } else {
                    headerBtn.classList.remove('voice-header-active');
                    if (headerIcon) {
                        headerIcon.className = 'fas fa-microphone text-primary';
                    }
                    if (headerBadge) {
                        headerBadge.textContent = 'انقر للتحدث';
                        headerBadge.className = 'badge bg-light text-primary border border-primary border-opacity-25';
                    }
                    if (headerWave) headerWave.style.display = 'none';
                    if (headerBox) headerBox.classList.remove('voice-box-active');
                }
            }

            if (btn) {
                if (active) {
                    btn.classList.add('voice-active');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.classList.remove('voice-active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            }

            if (hud) {
                if (active) {
                    hud.classList.add('show');
                } else {
                    hud.classList.remove('show');
                }
            }

            if (wave) {
                wave.style.display = active ? 'flex' : 'none';
            }
        }

        setSpeakingState(isSpeaking) {
            const botIcon = document.getElementById('voiceBotSpeakerIcon');
            if (botIcon) {
                if (isSpeaking) {
                    botIcon.classList.add('voice-speaking-pulse');
                } else {
                    botIcon.classList.remove('voice-speaking-pulse');
                }
            }
        }

        showTranscript(text, isFinal) {
            const display = document.getElementById('voiceLiveTranscript');
            if (display) {
                display.textContent = text;
                display.style.opacity = isFinal ? '1' : '0.75';
                if (isFinal) {
                    display.classList.add('highlight-final');
                    setTimeout(() => display.classList.remove('highlight-final'), 1200);
                }
            }
        }

        injectUI() {
            // التحقق من عدم التكرار
            if (document.getElementById('voiceCommanderContainer')) return;

            // حقن تنسيقات CSS الخاصة بالتحكم الصوتي
            const style = document.createElement('style');
            style.id = 'voiceCommanderStyles';
            style.textContent = `
                /* زر الميكروفون العائم */
                .floating-voice-hub {
                    position: fixed;
                    bottom: 24px;
                    left: 24px;
                    z-index: 99999;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 12px;
                    pointer-events: none;
                    touch-action: none;
                }
                .floating-voice-btn {
                    pointer-events: auto;
                    width: 58px;
                    height: 58px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #0088cc 0%, #005f8f 100%);
                    color: #ffffff;
                    border: none;
                    box-shadow: 0 8px 24px rgba(0, 136, 204, 0.45);
                    cursor: grab;
                    touch-action: none;
                    user-select: none;
                    -webkit-user-select: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 1.45rem;
                    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s ease;
                    position: relative;
                }
                .floating-voice-btn:hover {
                    transform: scale(1.08);
                    box-shadow: 0 10px 30px rgba(0, 136, 204, 0.6);
                }
                .floating-voice-btn.is-dragging {
                    cursor: grabbing !important;
                    transform: scale(1.15) !important;
                    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5), 0 0 0 4px rgba(0, 136, 204, 0.4) !important;
                    transition: none !important;
                }
                .voice-drag-handle-hint {
                    position: absolute;
                    top: 5px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 14px;
                    height: 3px;
                    background: rgba(255, 255, 255, 0.65);
                    border-radius: 2px;
                    pointer-events: none;
                }
                .floating-voice-btn.voice-active {
                    background: linear-gradient(135deg, #e53935 0%, #b71c1c 100%);
                    box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.7);
                    animation: voicePulse 1.8s infinite;
                }
                @keyframes voicePulse {
                    0% {
                        box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.7), 0 8px 25px rgba(229, 57, 53, 0.5);
                    }
                    70% {
                        box-shadow: 0 0 0 18px rgba(229, 57, 53, 0), 0 8px 25px rgba(229, 57, 53, 0.5);
                    }
                    100% {
                        box-shadow: 0 0 0 0 rgba(229, 57, 53, 0), 0 8px 25px rgba(229, 57, 53, 0.5);
                    }
                }
                .voice-pulse-ring {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    border: 2px solid #0088cc;
                    animation: voiceRing 2s linear infinite;
                    opacity: 0;
                    display: none;
                }
                .voice-active .voice-pulse-ring {
                    display: block;
                    border-color: #ff5252;
                }
                @keyframes voiceRing {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(1.6); opacity: 0; }
                }

                /* شريط HUD السفلي لعرض النص والردود */
                .voice-commander-hud {
                    pointer-events: auto;
                    background: rgba(17, 24, 39, 0.95);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 16px;
                    padding: 12px 18px;
                    color: #ffffff;
                    min-width: 290px;
                    max-width: 440px;
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
                    display: none;
                    flex-direction: column;
                    gap: 8px;
                    font-size: 0.88rem;
                    direction: rtl;
                    transform: translateY(10px);
                    opacity: 0;
                    transition: all 0.3s ease;
                }
                .voice-commander-hud.show {
                    display: flex;
                    transform: translateY(0);
                    opacity: 1;
                }
                .voice-hud-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    padding-bottom: 6px;
                }
                .voice-hud-title {
                    font-weight: 700;
                    font-size: 0.82rem;
                    color: #60a5fa;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .voice-live-transcript {
                    font-size: 0.92rem;
                    color: #f3f4f6;
                    font-weight: 500;
                    min-height: 24px;
                    line-height: 1.4;
                    word-break: break-word;
                }
                .voice-live-transcript.highlight-final {
                    color: #34d399;
                    font-weight: 600;
                }

                /* موجات الصوت التفاعلية */
                .voice-waves-container {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    height: 14px;
                }
                .voice-wave-bar {
                    width: 3px;
                    background: #60a5fa;
                    border-radius: 3px;
                    animation: wavePulse 1s ease-in-out infinite;
                }
                .voice-wave-bar:nth-child(1) { height: 6px; animation-delay: 0.0s; }
                .voice-wave-bar:nth-child(2) { height: 12px; animation-delay: 0.2s; }
                .voice-wave-bar:nth-child(3) { height: 16px; animation-delay: 0.4s; }
                .voice-wave-bar:nth-child(4) { height: 9px; animation-delay: 0.1s; }
                @keyframes wavePulse {
                    0%, 100% { transform: scaleY(0.4); }
                    50% { transform: scaleY(1.4); }
                }

                /* وميض المتكلم */
                .voice-speaking-pulse {
                    color: #38bdf8 !important;
                    animation: botPulse 0.8s infinite alternate;
                }
                @keyframes botPulse {
                    from { transform: scale(1); filter: drop-shadow(0 0 2px #38bdf8); }
                    to { transform: scale(1.25); filter: drop-shadow(0 0 8px #0284c7); }
                }

                /* تظليل العنصر المتأثر بالأمر الصوتي */
                .voice-command-highlight {
                    outline: 4px solid #0088cc !important;
                    outline-offset: 3px !important;
                    box-shadow: 0 0 25px rgba(0, 136, 204, 0.8) !important;
                    transition: all 0.3s ease !important;
                    transform: scale(1.02) !important;
                }
            `;
            document.head.appendChild(style);

            // إنشاء هيكل HTML
            const container = document.createElement('div');
            container.id = 'voiceCommanderContainer';
            container.className = 'floating-voice-hub';
            container.innerHTML = `
                <!-- شريط HUD السفلي للنص والردود -->
                <div class="voice-commander-hud" id="voiceCommanderHud">
                    <div class="voice-hud-header">
                        <div class="voice-hud-title">
                            <span class="voice-waves-container" id="voiceWaveIndicator">
                                <span class="voice-wave-bar"></span>
                                <span class="voice-wave-bar"></span>
                                <span class="voice-wave-bar"></span>
                                <span class="voice-wave-bar"></span>
                            </span>
                            <span>التحكم الصوتي نشط</span>
                            <i class="fas fa-robot ms-1" id="voiceBotSpeakerIcon" title="مساعد الأوامر الصوتية"></i>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <button type="button" class="btn btn-sm btn-link text-white p-0 text-decoration-none" id="voiceTtsToggleBtn" title="كتم / تفعيل الصوت">
                                <i class="fas fa-volume-up text-success"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-link text-white p-0 text-decoration-none" id="voiceHelpBtn" title="قاموس الأوامر الصوتية" data-bs-toggle="modal" data-bs-target="#voiceHelpModal">
                                <i class="fas fa-question-circle text-info"></i>
                            </button>
                            <button type="button" class="btn-close btn-close-white" style="font-size:0.65rem;" id="voiceHudCloseBtn" aria-label="إغلاق"></button>
                        </div>
                    </div>
                    <div class="voice-live-transcript" id="voiceLiveTranscript">
                        تحدث بأمرك الآن... (مثال: سجل بحساب لميس، الكود هو ...، ابدأ الإرسال، استعرض الروابط)
                    </div>
                </div>

                <!-- زر الميكروفون العائم القابل للتحريك والنقل -->
                <button type="button" class="floating-voice-btn" id="floatingVoiceBtn" title="التحكم الصوتي (اضغط للتحدث، واسحب لنقل الزر إلى أي مكان)">
                    <span class="voice-drag-handle-hint" title="اسحب للتحريك"></span>
                    <span class="voice-pulse-ring"></span>
                    <i class="fas fa-microphone" id="floatingVoiceIcon"></i>
                </button>
            `;
            document.body.appendChild(container);

            // إضافة مودال قاموس الأوامر الصوتية
            this.injectHelpModal();

            // تفعيل التحريك والسحب الحر والنقل للزر
            this.setupDraggable(container, document.getElementById('floatingVoiceBtn'));

            // ربط أحداث أزرار شريط الـ HUD
            document.getElementById('voiceTtsToggleBtn').addEventListener('click', () => this.toggleTTS());
            document.getElementById('voiceHudCloseBtn').addEventListener('click', () => this.stop());
        }

        setupDraggable(container, btn) {
            if (!container || !btn) return;

            // 1. استرجاع وتطبيق الموضع المحفوظ مسبقاً إن وجد
            try {
                const savedPos = localStorage.getItem('voice_hub_position');
                if (savedPos) {
                    const pos = JSON.parse(savedPos);
                    const btnW = 58;
                    const btnH = 58;
                    const maxLeft = Math.max(8, window.innerWidth - btnW - 8);
                    const maxTop = Math.max(8, window.innerHeight - btnH - 8);
                    const curLeft = Math.max(8, Math.min(parseInt(pos.left, 10), maxLeft));
                    const curTop = Math.max(8, Math.min(parseInt(pos.top, 10), maxTop));

                    container.style.left = curLeft + 'px';
                    container.style.top = curTop + 'px';
                    container.style.bottom = 'auto';
                    container.style.right = 'auto';

                    if (curTop < window.innerHeight / 2) {
                        container.style.flexDirection = 'column-reverse';
                    } else {
                        container.style.flexDirection = 'column';
                    }
                }
            } catch (_) {}

            // 2. إدارة أحداث السحب والتحريك (Pointer Events الشاملة للجوال والكمبيوتر)
            let isPointerDown = false;
            let isDragging = false;
            let startX = 0, startY = 0;
            let initialLeft = 0, initialTop = 0;
            const dragThreshold = 6;

            btn.addEventListener('pointerdown', (e) => {
                if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
                isPointerDown = true;
                isDragging = false;
                startX = e.clientX;
                startY = e.clientY;

                const rect = container.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;

                try {
                    btn.setPointerCapture(e.pointerId);
                } catch (_) {}
            });

            btn.addEventListener('pointermove', (e) => {
                if (!isPointerDown) return;

                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                if (!isDragging && Math.hypot(dx, dy) > dragThreshold) {
                    isDragging = true;
                    btn.classList.add('is-dragging');
                }

                if (isDragging) {
                    let newLeft = initialLeft + dx;
                    let newTop = initialTop + dy;

                    const btnW = btn.offsetWidth || 58;
                    const btnH = btn.offsetHeight || 58;
                    const maxL = Math.max(8, window.innerWidth - btnW - 8);
                    const maxT = Math.max(8, window.innerHeight - btnH - 8);

                    newLeft = Math.max(8, Math.min(newLeft, maxL));
                    newTop = Math.max(8, Math.min(newTop, maxT));

                    container.style.left = newLeft + 'px';
                    container.style.top = newTop + 'px';
                    container.style.bottom = 'auto';
                    container.style.right = 'auto';

                    if (newTop < window.innerHeight / 2) {
                        container.style.flexDirection = 'column-reverse';
                    } else {
                        container.style.flexDirection = 'column';
                    }
                }
            });

            const onPointerUp = (e) => {
                if (!isPointerDown) return;
                isPointerDown = false;

                try {
                    btn.releasePointerCapture(e.pointerId);
                } catch (_) {}

                if (isDragging) {
                    btn.classList.remove('is-dragging');
                    try {
                        localStorage.setItem('voice_hub_position', JSON.stringify({
                            left: container.style.left,
                            top: container.style.top
                        }));
                    } catch (_) {}
                    // منع إطلاق الـ toggle بعد السحب
                    setTimeout(() => { isDragging = false; }, 80);
                } else {
                    // نقرة عادية بدون سحب -> تفعيل أو إيقاف الاستماع
                    this.toggle();
                }
            };

            btn.addEventListener('pointerup', onPointerUp);
            btn.addEventListener('pointercancel', onPointerUp);

            btn.addEventListener('click', (e) => {
                if (isDragging) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            });

            // ضبط الموقع عند تدوير الشاشة أو تغيير أبعاد النافذة
            window.addEventListener('resize', () => {
                const rect = container.getBoundingClientRect();
                const btnW = btn.offsetWidth || 58;
                const btnH = btn.offsetHeight || 58;
                const maxL = Math.max(8, window.innerWidth - btnW - 8);
                const maxT = Math.max(8, window.innerHeight - btnH - 8);

                let clampL = Math.max(8, Math.min(rect.left, maxL));
                let clampT = Math.max(8, Math.min(rect.top, maxT));

                container.style.left = clampL + 'px';
                container.style.top = clampT + 'px';
                container.style.bottom = 'auto';
                container.style.right = 'auto';
            });
        }

        injectHelpModal() {
            if (document.getElementById('voiceHelpModal')) return;
            const modal = document.createElement('div');
            modal.id = 'voiceHelpModal';
            modal.className = 'modal fade';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered modal-lg">
                    <div class="modal-content shadow-lg border-0" style="border-radius: 20px; overflow: hidden; direction: rtl;">
                        <div class="modal-header text-white" style="background: linear-gradient(135deg, #0088cc 0%, #005f8f 100%);">
                            <h5 class="modal-title fw-bold">
                                <i class="fas fa-microphone-alt me-2"></i> قاموس الأوامر الصوتية الذكية الشامل
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="إغلاق"></button>
                        </div>
                        <div class="modal-body p-4" style="background: #f8fafc;">
                            <p class="text-muted mb-4">
                                يمكنك التحكم في كافة أقسام التطبيق بحرية تامة وبدون لمس الشاشة، فقط قل أي من الأوامر التالية بصوت واضح:
                            </p>
                            <div class="row g-3">
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-4 border-primary h-100">
                                        <h6 class="fw-bold text-primary mb-2"><i class="fas fa-sign-in-alt me-1"></i> تسجيل الدخول والحسابات</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«سجل بحساب لميس»</strong>: يملأ رقم لميس ويطلب الكود فوراً.</li>
                                            <li class="mb-1">🔹 <strong>«سجل برقم زائد عشرين...»</strong>: يضع أي رقم تريده ويطلب الكود.</li>
                                            <li class="mb-1">🔹 <strong>«الكود هو تسعة خمسة أربعة اثنين...»</strong>: يدخل الكود ويتحقق.</li>
                                            <li class="mb-1">🔹 <strong>«كلمة المرور هي [كلمتك]»</strong>: يدخل كلمة التحقق بخطوتين.</li>
                                            <li class="mb-1">🔹 <strong>«أعد إرسال الكود»</strong> أو <strong>«أرسل الكود عبر SMS»</strong>.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-4 border-success h-100">
                                        <h6 class="fw-bold text-success mb-2"><i class="fas fa-paper-plane me-1"></i> مهام الإرسال والمراسلة</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«ابدأ الإرسال»</strong> / <strong>«تشغيل المهمة»</strong>: بدء الإرسال فوراً.</li>
                                            <li class="mb-1">🔹 <strong>«أوقف الإرسال»</strong> / <strong>«توقف»</strong>: إيقاف الإرسال بلحظتها.</li>
                                            <li class="mb-1">🔹 <strong>«إرسال للمجموعات»</strong> أو <strong>«إرسال للقنوات»</strong> أو <strong>«إرسال فردي»</strong>.</li>
                                            <li class="mb-1">🔹 <strong>«اضبط الفاصل الزمني ثلاثين ثانية»</strong>.</li>
                                            <li class="mb-1">🔹 <strong>«اكتب في الرسالة [نصك]»</strong>: يملأ مربع الرسالة.</li>
                                            <li class="mb-1">🔹 <strong>«احفظ الإعدادات»</strong>: يحفظ التعديلات فوراً.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-4 border-info h-100">
                                        <h6 class="fw-bold text-info mb-2"><i class="fas fa-link me-1"></i> روابط قاعدة البيانات السحابية</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«استعرض روابط قاعدة البيانات»</strong>: يفحص السحابة وينطق عددها.</li>
                                            <li class="mb-1">🔹 <strong>«صدّر الروابط ملف PDF»</strong>: ينزل تقرير PDF فورياً لذاكرة جهازك.</li>
                                            <li class="mb-1">🔹 <strong>«صدّر الروابط ملف نصي TXT»</strong>: ينزل ملف TXT لذاكرتك.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-4 border-warning h-100">
                                        <h6 class="fw-bold text-warning mb-2"><i class="fas fa-compass me-1"></i> التنقل والاستفسار</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«ما هي حالة الحساب؟»</strong>: ينطق اسم الحساب المتصل ووضعه.</li>
                                            <li class="mb-1">🔹 <strong>«افتح المحلل الذكي للمستندات»</strong>: ينتقل لصفحة المحلل.</li>
                                            <li class="mb-1">🔹 <strong>«الصفحة الرئيسية»</strong>: يعيدك للرئيسية.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer bg-white border-top-0 d-flex justify-content-between">
                            <span class="text-muted small"><i class="fas fa-check-circle text-success me-1"></i> مدعوم بالنطق الصوتي والتحليل الذاتي</span>
                            <button type="button" class="btn btn-primary px-4" data-bs-dismiss="modal">فهمت، جاهز للتجربة</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
    }

    // تهيئة المحرك وتثبيته في كائن النطاق العام عند تحميل المستند
    window.addEventListener('DOMContentLoaded', () => {
        window.voiceCommander = new VoiceCommander();
    });

})(window, document);
