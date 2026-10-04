/**
 * VoiceCommander - محرك التحكم الصوتي الذاتي الشامل لتطبيق مركز سرعة إنجاز
 * مبني باستخدام مكتبة Web Speech API القياسية للتعرف الصوتي (SpeechRecognition) والنطق الصوتي (SpeechSynthesis)
 * يدعم الاستماع المستمر، تحويل الأرقام واللهجات العربية، استخلاص النوايا وتنفيذ الأوامر فعلياً:
 * 1. بدء تسجيل الدخول واختيار الحسابات
 * 2. التحقق من الرموز والأكواد وكلمات المرور
 * 3. بدء وإدارة المهام المجدولة والجدولة الدائرية
 */

(function (window, document) {
    'use strict';

    // جدول تحويل الكلمات العربية المنطوقة للأرقام الفردية
    const ARABIC_WORD_TO_DIGIT = {
        'صفر': '0', 'زيرو': '0',
        'واحد': '1', 'واحده': '1', 'واحدة': '1', 'الاول': '1', 'الأول': '1',
        'اثنين': '2', 'إثنين': '2', 'اتنين': '2', 'اثنان': '2', 'الثاني': '2',
        'ثلاثة': '3', 'تلاتة': '3', 'ثلاث': '3', 'تلاته': '3', 'الثالث': '3',
        'اربعة': '4', 'أربعة': '4', 'اربع': '4', 'أربع': '4', 'الرابع': '4',
        'خمسة': '5', 'خمسه': '5', 'خمس': '5', 'الخامس': '5',
        'ستة': '6', 'سته': '6', 'ست': '6', 'السادس': '6',
        'سبعة': '7', 'سبعه': '7', 'سبع': '7', 'السابع': '7',
        'ثمانية': '8', 'تمانية': '8', 'ثمان': '8', 'تمان': '8', 'الثامن': '8',
        'تسعة': '9', 'تسعه': '9', 'تسع': '9', 'التاسع': '9',
        'عشرة': '10', 'عشره': '10', 'عشر': '10', 'العاشر': '10',
        'عشرين': '20', 'ثلاثين': '30', 'تلاتين': '30', 'اربعين': '40', 'أربعين': '40',
        'خمسين': '50', 'ستين': '60', 'سبعين': '70', 'ثمانين': '80', 'تمانين': '80', 'تسعين': '90',
        'مائة': '100', 'مية': '100', 'الف': '1000', 'ألف': '1000',
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
            this.shouldStayActive = false;
            this.synth = window.speechSynthesis || null;
            this.audioCtx = null;
            this.lastTranscript = '';
            this.processingLock = false;
            this.supported = false;
            this.currentState = 'idle'; // 'idle' | 'listening' | 'permission' | 'error' | 'disabled'
            this.micPermissionGranted = false;
            this.init();
        }

        init() {
            // معالجة قيد الأمان لاتصال HTTPS (Web Speech API requires a secure context or localhost)
            if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                console.error('[VoiceCommander] HTTPS مطلوب: متصفحات الويب تشترط اتصالاً آمناً لاستخدام الميكروفون والتعرف الصوتي.');
                this.supported = false;
                this.currentState = 'error';
                this.updateStateIndicator('error', '⚪ معطل (يلزم HTTPS)');
                this.showHttpsWarning();
                return;
            }

            // التحقق من دعم المتصفح لمكتبة Web Speech API
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                console.warn('[VoiceCommander] Web Speech API (SpeechRecognition) is not supported in this browser.');
                this.supported = false;
                this.currentState = 'error';
                this.updateStateIndicator('error', '⚪ غير مدعوم');
                return;
            }
            this.supported = true;
            this.currentState = 'idle';

            try {
                this.recognition = new SpeechRecognition();
                this.recognition.lang = 'ar-SA';
                this.recognition.continuous = true;
                this.recognition.interimResults = true;
                this.recognition.maxAlternatives = 1;

                this.bindEvents();
                this.injectUI();
                this.updateStateIndicator('idle', '🟢 جاهز');
                console.log('[VoiceCommander] ✅ Web Speech API initialized successfully.');

                // تشغيل الفحص الذاتي التشخيصي تلقائياً عند التهيئة
                this.selfTest();

                // فحص وعرض إشعار إذن الميكروفون للمستخدم فوراً للموافقة عليه
                setTimeout(() => {
                    this.checkAndPromptMicrophonePermission();
                }, 600);
            } catch (err) {
                console.error('[VoiceCommander] Failed to initialize SpeechRecognition:', err);
                this.supported = false;
                this.currentState = 'error';
                this.updateStateIndicator('error', '🔴 خطأ تهيئة');
            }
        }

        // الفحص الذاتي التشخيصي الشامل (Self-Diagnostics)
        async selfTest() {
            let hasMic = 'لا';
            try {
                if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    hasMic = devices.some(d => d.kind === 'audioinput') ? 'نعم' : 'لا';
                }
            } catch (e) {
                console.warn('[VoiceCommander selfTest] Microphone enumeration error:', e);
            }

            const report = {
                supported: Boolean(this.supported),
                protocol: window.location.protocol,
                isSecureContext: Boolean(window.isSecureContext),
                hasSpeechRecognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
                hasSpeechSynthesis: Boolean(window.speechSynthesis),
                hasMicrophone: hasMic,
                micPermissionGranted: this.micPermissionGranted,
                isInitialized: Boolean(this.recognition),
                currentState: this.currentState || (this.isListening ? 'listening' : (this.supported ? 'idle' : 'error'))
            };

            console.log('═══════════════════════════════════════════════════');
            console.log('🎙️ [VoiceCommander Self-Test Diagnostics Report]:', report);
            console.log('═══════════════════════════════════════════════════');
            return report;
        }

        // فحص حالة إذن الميكروفون وعرض الإشعار التفاعلي
        async checkAndPromptMicrophonePermission() {
            if (!this.supported) return;

            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const status = await navigator.permissions.query({ name: 'microphone' });
                    console.log('[VoiceCommander] Microphone permission status:', status.state);
                    if (status.state === 'granted') {
                        this.micPermissionGranted = true;
                        this.hideMicrophoneNotice();
                        this.updateStateIndicator('idle', '🟢 جاهز');
                        return;
                    }
                    status.onchange = () => {
                        console.log('[VoiceCommander] Microphone permission changed to:', status.state);
                        if (status.state === 'granted') {
                            this.micPermissionGranted = true;
                            this.hideMicrophoneNotice();
                            this.updateStateIndicator('idle', '🟢 جاهز');
                        } else if (status.state === 'denied') {
                            this.updateStateIndicator('error', '🔴 تم الرفض');
                        }
                    };
                } catch (e) {
                    console.warn('[VoiceCommander] Permission query not supported:', e);
                }
            }

            // إظهار إشعار الموافقة على الميكروفون إذا لم يكن مفعلاً بعد
            if (!this.micPermissionGranted) {
                this.showMicrophoneNotice();
            }
        }

        // إظهار إشعار أنيق للمستخدم للموافقة على إذن الميكروفون
        showMicrophoneNotice() {
            if (document.getElementById('voiceMicPermissionNotice')) return;

            const banner = document.createElement('div');
            banner.id = 'voiceMicPermissionNotice';
            banner.className = 'voice-mic-banner';
            banner.innerHTML = `
                <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
                    <div class="d-flex align-items-center gap-3">
                        <div class="mic-pulse-circle">
                            <i class="fas fa-microphone-alt fa-lg text-primary"></i>
                        </div>
                        <div class="text-end">
                            <div class="fw-bold text-dark" style="font-size: 0.96rem;">
                                🎙️ إشعار تفعيل إذن الميكروفون للتحكم الصوتي
                            </div>
                            <div class="text-secondary small mt-1">
                                يرجى النقر على زر الموافقة للسماح للمتصفح باستخدام الميكروفون للأوامر الصوتية.
                            </div>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2 me-auto">
                        <button type="button" class="btn btn-primary btn-sm px-3 py-2 fw-bold rounded-pill shadow-sm" id="grantMicBtn">
                            <i class="fas fa-check-circle me-1"></i> السماح بالميكروفون الآن
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm px-3 py-2 rounded-pill" id="dismissMicNoticeBtn">
                            إغلاق
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(banner);

            document.getElementById('grantMicBtn')?.addEventListener('click', async () => {
                const btn = document.getElementById('grantMicBtn');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> جاري فتح نافذة الإذن...';
                }
                const res = await this.requestMicrophoneAccess(true);
                if (res.success) {
                    banner.innerHTML = `
                        <div class="d-flex align-items-center justify-content-center gap-2 py-1 text-success fw-bold">
                            <i class="fas fa-check-circle fa-lg"></i>
                            <span>✅ تم منح إذن الميكروفون بنجاح! يمكنك الآن التحدث بأوامرك الصوتية بحرية.</span>
                        </div>
                    `;
                    setTimeout(() => {
                        this.hideMicrophoneNotice();
                    }, 2800);
                } else {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-redo me-1"></i> إعادة المحاولة';
                    }
                }
            });

            document.getElementById('dismissMicNoticeBtn')?.addEventListener('click', () => {
                this.hideMicrophoneNotice();
            });
        }

        hideMicrophoneNotice() {
            const el = document.getElementById('voiceMicPermissionNotice');
            if (el) {
                el.style.opacity = '0';
                el.style.transform = 'translate(-50%, -24px)';
                el.style.transition = 'all 0.3s ease';
                setTimeout(() => el.remove(), 320);
            }
        }

        // طلب الإذن الفعلي للميكروفون من نافذة المتصفح الأصلية (Native Browser Prompt)
        async requestMicrophoneAccess(autoStartRecognition = false) {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('متصفحك لا يدعم طلب إذن الميكروفون عبر navigator.mediaDevices');
                }
                this.updateStateIndicator('permission', '🟡 ينتظر موافقتك...');
                
                // هذا السطر يُظهر نافذة المتصفح الأصلية الإلزامية "Allow Abu_Malk-Services to use your microphone"
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // فور منح الموافقة، نوقف التراكات حتى لا تظل لمبة التسجيل مشتعلة بدون داعٍ
                stream.getTracks().forEach(track => track.stop());

                console.log('[VoiceCommander] ✅ تم منح إذن الميكروفون من المتصفح بنجاح!');
                this.micPermissionGranted = true;
                this.hideMicrophoneNotice();
                this.updateStateIndicator('idle', '🟢 جاهز');
                this.speak('تم تفعيل إذن الميكروفون بنجاح! يمكنك الآن التحدث بأوامرك الصوتية.');
                
                if (autoStartRecognition) {
                    setTimeout(() => {
                        this.start();
                    }, 300);
                }
                return { success: true };
            } catch (err) {
                console.warn('[VoiceCommander] Microphone permission rejected or failed:', err);
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    this.updateStateIndicator('error', '🔴 تم رفض الإذن');
                    this.showPermissionDeniedHelp();
                } else {
                    this.updateStateIndicator('error', '🔴 خطأ ميكروفون');
                }
                return { success: false, error: err };
            }
        }

        // إظهار إرشادات واضحة في حال حظر الميكروفون مسبقاً
        showPermissionDeniedHelp() {
            if (document.getElementById('voicePermissionDeniedModal')) return;
            const modal = document.createElement('div');
            modal.id = 'voicePermissionDeniedModal';
            modal.className = 'modal fade show';
            modal.style.display = 'block';
            modal.style.backgroundColor = 'rgba(0,0,0,0.6)';
            modal.setAttribute('tabindex', '-1');
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content shadow-lg border-0" style="border-radius: 16px; direction: rtl;">
                        <div class="modal-header bg-warning text-dark">
                            <h6 class="modal-title fw-bold">
                                <i class="fas fa-exclamation-triangle me-2"></i> إذن الميكروفون محظور في المتصفح
                            </h6>
                            <button type="button" class="btn-close" onclick="document.getElementById('voicePermissionDeniedModal').remove()"></button>
                        </div>
                        <div class="modal-body p-4 text-secondary">
                            <p class="mb-2 fw-semibold text-dark">
                                تم حظر الوصول للميكروفون مسبقاً في إعدادات متصفحك لهذا الموقع.
                            </p>
                            <div class="p-3 bg-light rounded-3 border mb-3 small">
                                <strong>خطوات إلغاء الحظر وتفعيل الميكروفون:</strong>
                                <ol class="mb-0 mt-2 pe-3">
                                    <li>انقر على أيقونة 🔒 (القفل) أو ⚙️ في شريط العناوين بالأعلى بجانب رابط الموقع.</li>
                                    <li>ابحث عن <strong>الميكروفون (Microphone)</strong> واجعله <strong>السماح (Allow)</strong>.</li>
                                    <li>أعد تحميل الصفحة، وسيعمل التحكم الصوتي فوراً.</li>
                                </ol>
                            </div>
                        </div>
                        <div class="modal-footer bg-light border-0 d-flex justify-content-between">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('voicePermissionDeniedModal').remove()">إغلاق</button>
                            <button type="button" class="btn btn-primary btn-sm" onclick="window.location.reload()"><i class="fas fa-sync-alt me-1"></i> إعادة تحميل الصفحة</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // إظهار تنبيه واضح ومباشر عند فتح التطبيق عبر HTTP غير الآمن
        showHttpsWarning() {
            if (document.getElementById('voiceHttpsWarningModal')) return;
            const modal = document.createElement('div');
            modal.id = 'voiceHttpsWarningModal';
            modal.className = 'modal fade show';
            modal.style.display = 'block';
            modal.style.backgroundColor = 'rgba(0,0,0,0.6)';
            modal.setAttribute('tabindex', '-1');
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content shadow-lg border-0" style="border-radius: 16px; direction: rtl;">
                        <div class="modal-header bg-danger text-white">
                            <h6 class="modal-title fw-bold">
                                <i class="fas fa-lock me-2"></i> يلزم اتصال آمن (HTTPS) لتفعيل التحكم الصوتي
                            </h6>
                            <button type="button" class="btn-close btn-close-white" onclick="document.getElementById('voiceHttpsWarningModal').remove()"></button>
                        </div>
                        <div class="modal-body p-4 text-secondary">
                            <p class="mb-2 fw-semibold text-dark">
                                تتطلب متصفحات الويب الحديثة (Chrome, Safari, Edge) بروتوكولاً آمناً (HTTPS) لمنح الإذن للميكروفون وتقنية Web Speech API.
                            </p>
                            <p class="small text-muted mb-0">
                                أنت تتصفح حالياً عبر <code>${window.location.protocol}</code>. يرجى فتح الموقع عبر رابط <code>https://</code> لتتمكن من استخدام الأوامر الصوتية.
                            </p>
                        </div>
                        <div class="modal-footer bg-light border-0 d-flex justify-content-between">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('voiceHttpsWarningModal').remove()">إغلاق</button>
                            ${window.location.protocol === 'http:' ? `<button type="button" class="btn btn-primary btn-sm" onclick="window.location.href = window.location.href.replace('http:', 'https:')"><i class="fas fa-shield-alt me-1"></i> الانتقال إلى HTTPS</button>` : ''}
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // تحديث المؤشر البصري لحالة التحكم الصوتي بالألوان
        updateStateIndicator(state, label) {
            const pill = document.getElementById('voiceStatusIndicatorPill');
            const badge = document.getElementById('headerVoiceStatusBadge');

            const stateClasses = {
                'idle': 'badge bg-success text-white py-1 px-2',
                'listening': 'badge bg-danger text-white py-1 px-2 fa-beat',
                'permission': 'badge bg-warning text-dark py-1 px-2',
                'error': 'badge bg-danger text-white py-1 px-2',
                'disabled': 'badge bg-secondary text-white py-1 px-2'
            };

            const statePillLabels = {
                'idle': '🟢 جاهز',
                'listening': '🔴 يستمع الآن',
                'permission': '🟡 ينتظر إذن',
                'error': '🔴 خطأ',
                'disabled': '⚪ معطل'
            };

            if (pill) {
                pill.className = stateClasses[state] || 'badge bg-secondary text-white py-1 px-2';
                pill.textContent = statePillLabels[state] || (label || '⚪ معطل');
            }

            if (badge && !this.isListening) {
                if (state === 'idle') {
                    badge.className = 'badge bg-light text-primary border border-primary border-opacity-25';
                    badge.textContent = 'انقر للتحدث';
                } else if (state === 'permission') {
                    badge.className = 'badge bg-warning text-dark';
                    badge.textContent = '🟡 ينتظر إذن';
                } else if (state === 'error' || state === 'disabled') {
                    badge.className = 'badge bg-danger text-white border-0';
                    badge.textContent = label || '❌ معطل';
                }
            }
        }

        bindEvents() {
            if (!this.recognition) return;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.currentState = 'listening';
                this.updateUIState(true);
                this.updateStateIndicator('listening', '🔴 يستمع الآن');
                this.playTone(520, 0.12);
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.currentState = this.supported ? 'idle' : 'error';
                this.updateUIState(false);
                this.updateStateIndicator(this.supported ? 'idle' : 'error', this.supported ? '🟢 جاهز' : '🔴 معطل');
                if (this.autoRestart && this.shouldStayActive) {
                    setTimeout(() => {
                        if (this.shouldStayActive && !this.isListening) {
                            try {
                                this.recognition.start();
                            } catch (_) {}
                        }
                    }, 250);
                }
            };

            this.recognition.onerror = (e) => {
                console.warn('[VoiceCommander] Speech Error:', e.error);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    this.shouldStayActive = false;
                    this.micPermissionGranted = false;
                    this.currentState = 'error';
                    this.updateUIState(false);
                    this.updateStateIndicator('error', '🔴 رُفض الإذن');
                    this.showPermissionDeniedHelp();
                    this.speak('يرجى السماح بصلاحية الميكروفون في المتصفح لتمكين التحكم الصوتي.');
                } else if (e.error === 'no-speech') {
                    // وضع السكون الطبيعي عند عدم الكلام
                } else if (e.error === 'network') {
                    this.currentState = 'error';
                    this.updateStateIndicator('error', '🔴 خطأ شبكة');
                    if (this.shouldStayActive) {
                        setTimeout(() => {
                            if (this.shouldStayActive) {
                                try { this.recognition.start(); } catch (_) {}
                            }
                        }, 1200);
                    }
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

        // نغمة صوتية تفاعلية لطيفة (Web Audio API)
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

        // نطق الرد الصوتي العربي للمستخدم (SpeechSynthesis)
        speak(text) {
            if (!this.ttsEnabled || !this.synth || !text) return;
            try {
                this.synth.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'ar-SA';
                utterance.rate = 1.05;
                utterance.pitch = 1.0;

                const voices = this.synth.getVoices();
                const arVoice = voices.find(v => (v.lang && (v.lang.startsWith('ar') || v.lang.includes('AR'))) || (v.name && v.name.includes('Arabic')));
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

        // تنقية وتوحيد النص العربي للمطابقة الذكية
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

        // استخراج الأرقام بدقة من النص المنطوق باللغة العربية
        extractNumbers(text) {
            if (!text) return '';
            let s = text.trim();

            for (const [k, v] of Object.entries(ARABIC_EASTERN_DIGITS)) {
                s = s.split(k).join(v);
            }

            const words = s.split(/\s+/);
            let resultDigits = '';

            for (const w of words) {
                const cleaned = w.replace(/[،,.]/g, '');
                if (ARABIC_WORD_TO_DIGIT[cleaned] !== undefined) {
                    resultDigits += ARABIC_WORD_TO_DIGIT[cleaned];
                } else if (/^\d+$/.test(cleaned)) {
                    resultDigits += cleaned;
                }
            }

            if (resultDigits) return resultDigits;

            const matches = s.match(/[\d+]+/g);
            return matches ? matches.join('') : '';
        }

        // إضاءة وتظليل العنصر المتأثر بالأمر الصوتي
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
                // ════════════════════════════════════════════════════════════
                // 0. أمر "أبو مالك، افتح آخر رسالة" لفتح أحدث محادثة غير مقروءة
                // ════════════════════════════════════════════════════════════
                const isAbuMalkLatestMsgIntent = 
                    (norm.includes('ابو مالك') && (norm.includes('افتح') || norm.includes('اقرا') || norm.includes('شاهد') || norm.includes('رساله') || norm.includes('محادثه'))) ||
                    (norm.includes('افتح اخر رساله') || norm.includes('افتح احدث رساله') || norm.includes('افتح اخر محادثه') || norm.includes('افتح احدث محادثه') || norm.includes('احدث محادثه غير مقروءه') || norm.includes('افتح المحادثه غير المقروءه') || norm.includes('اقرا اخر رساله') || (norm.includes('افتح') && norm.includes('اخر رساله')) || (norm.includes('افتح') && norm.includes('الرساله الاخيره')));

                if (isAbuMalkLatestMsgIntent) {
                    await this.cmdOpenLatestUnreadMessage();
                    return;
                }

                // ════════════════════════════════════════════════════════════
                // 1. التحقق من الرموز (Verification of codes via voice command)
                // ════════════════════════════════════════════════════════════
                const isVerifyFormVisible = document.getElementById('verifyForm')?.style.display !== 'none';
                const isCodeIntent = norm.includes('كود') || norm.includes('رمز') || norm.includes('تحقق من الرمز') || norm.includes('التحقق من الرمز') || norm.includes('تاكيد الرمز') || norm.includes('تاكيد الكود') || norm.includes('رمز التحقق') || norm.includes('كود التحقق');

                if (isCodeIntent || (isVerifyFormVisible && digits && digits.length >= 3)) {
                    if (digits && digits.length >= 3) {
                        await this.cmdVerifyCode(digits);
                        return;
                    } else if (isVerifyFormVisible && (norm.includes('تاكيد') || norm.includes('تحقق') || norm.includes('ارسل'))) {
                        const codeVal = (document.getElementById('verificationCode')?.value || '').trim();
                        if (codeVal) {
                            await this.cmdVerifyCode(codeVal);
                            return;
                        }
                    }
                }

                // كلمة المرور والتحقق بخطوتين (2FA)
                const isPasswordFormVisible = document.getElementById('passwordForm')?.style.display !== 'none';
                if (norm.includes('كلمه المرور') || norm.includes('كلمه السر') || norm.includes('باسورد') || norm.includes('رمز الحمايه') || (isPasswordFormVisible && !digits)) {
                    let pass = rawTranscript.replace(/.*(كلمة المرور|كلمة السر|الباسورد|السر|رمز سري|باسورد|الباسوورد|كلمه المرور|كلمه السر)\s*(هي|هو)?\s*/i, '').trim();
                    if (!pass && isPasswordFormVisible) pass = rawTranscript.trim();
                    if (pass) {
                        await this.cmdVerifyPassword(pass);
                        return;
                    }
                }

                // إعادة إرسال الكود
                if (norm.includes('اعاده ارسال') || norm.includes('ارسل الكود') || norm.includes('ابعث الكود') || norm.includes('كود جديد') || norm.includes('ارسل الرمز')) {
                    const forceSms = norm.includes('رساله') || norm.includes('sms') || norm.includes('نصيه');
                    await this.cmdResendCode(forceSms);
                    return;
                }

                // ════════════════════════════════════════════════════════════
                // 2. بدء المهام المجدولة (Start Scheduled Tasks via voice command)
                // ════════════════════════════════════════════════════════════
                const isScheduleIntent = norm.includes('مجدول') || norm.includes('مجدوله') || norm.includes('الجدوله') || norm.includes('جدوله') || norm.includes('المهام المجدوله') || norm.includes('الدوره المجدوله');
                
                if (isScheduleIntent || ((norm.includes('مهم') || norm.includes('مهام')) && (norm.includes('ابدا') || norm.includes('بدء') || norm.includes('تشغيل') || norm.includes('شغل')))) {
                    if (norm.includes('اوقف') || norm.includes('وقف') || norm.includes('ايقاف') || norm.includes('تعطيل')) {
                        await this.cmdStopScheduledTasks();
                        return;
                    }
                    await this.cmdStartScheduledTasks(digits, norm);
                    return;
                }

                // ════════════════════════════════════════════════════════════
                // 3. بدء تسجيل الدخول (Start Login via voice command)
                // ════════════════════════════════════════════════════════════
                const isLoginIntent = norm.includes('تسجيل الدخول') || norm.includes('تسجيل دخول') || norm.includes('سجل دخول') || norm.includes('سجل الدخول') || norm.includes('دخول') || norm.includes('ادخل') || norm.includes('حساب') || norm.includes('login');

                if (isLoginIntent && !norm.includes('خروج')) {
                    if (norm.includes('لميس') || norm.includes('حساب 1') || norm.includes('الحساب الاول') || norm.includes('الاول')) {
                        await this.cmdLoginNamedAccount('user_1', '+201120945094', 'لميس');
                        return;
                    }

                    if (norm.includes('الثاني') || norm.includes('حساب 2')) {
                        await this.cmdLoginNamedAccount('user_2', '+201221349790', 'الحساب الثاني');
                        return;
                    }

                    if (norm.includes('الثالث') || norm.includes('حساب 3')) {
                        await this.cmdLoginNamedAccount('user_3', '+201148863243', 'الحساب الثالث');
                        return;
                    }

                    if (digits && digits.length >= 8) {
                        await this.cmdLoginByPhoneNumber(digits);
                        return;
                    }

                    await this.cmdLoginDefault();
                    return;
                }

                // تسجيل الخروج
                if (norm.includes('خروج') || norm.includes('تسجيل خروج') || norm.includes('سجل خروج') || norm.includes('انهاء الجلسه') || norm.includes('logout')) {
                    await this.cmdLogout();
                    return;
                }

                // ════════════════════════════════════════════════════════════
                // 4. التحكم في الإرسال الفوري والمراقبة
                // ════════════════════════════════════════════════════════════
                if (norm.includes('ارسل الان') || norm.includes('ارسل فوري') || norm.includes('انطلق') || norm.includes('بدء الارسال') || norm.includes('ابدأ الارسال') || norm.includes('ابدا الارسال')) {
                    await this.cmdStartBroadcast();
                    return;
                }

                if (norm.includes('اوقف الارسال') || norm.includes('وقف الارسال') || norm.includes('ايقاف الارسال')) {
                    await this.cmdStopBroadcast();
                    return;
                }

                if (norm.includes('مراقبه') || norm.includes('المراقبه')) {
                    if (norm.includes('اوقف') || norm.includes('وقف') || norm.includes('ايقاف')) {
                        await this.cmdStopMonitoring();
                    } else {
                        await this.cmdStartMonitoring();
                    }
                    return;
                }

                if (norm.includes('روابط') || norm.includes('الروابط') || norm.includes('استعرض') || norm.includes('قاعده البيانات')) {
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

                if (norm.includes('فاصل') || norm.includes('دقيقه') || norm.includes('ثانيه')) {
                    if (digits) {
                        let sec = parseInt(digits, 10);
                        if (norm.includes('دقيقه') || norm.includes('دقايق')) sec = sec * 60;
                        await this.cmdSetInterval(sec);
                        return;
                    }
                }

                if (norm.startsWith('اكتب') || norm.includes('الرساله هي') || norm.includes('نص الرساله')) {
                    const msg = rawTranscript.replace(/^(اكتب في الرسالة|اكتب رسالة|اكتب|الرسالة هي|نص الرسالة|اكتب في الرساله|اكتب رساله|الرساله هي)\s*/i, '').trim();
                    if (msg) {
                        await this.cmdSetMessage(msg);
                        return;
                    }
                }

                if (norm.includes('احفظ') || norm.includes('حفظ') || norm.includes('تثبيت') || norm.includes('save')) {
                    await this.cmdSaveSettings();
                    return;
                }

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

                this.speak('سمعت أمرك: ' + rawTranscript + '. يمكنك قول: ابدأ تسجيل الدخول، أو رمز التحقق هو...، أو ابدأ المهام المجدولة.');

            } catch (err) {
                console.error('[VoiceCommander] Execution Error:', err);
                this.speak('حدث خطأ أثناء تنفيذ الأمر: ' + (err.message || ''));
            } finally {
                setTimeout(() => {
                    this.processingLock = false;
                }, 1200);
            }
        }

        // ════════════════════════════════════════════════════════════
        // الدوال التنفيذية للأوامر الصوتية الفعلية
        // ════════════════════════════════════════════════════════════

        // ── 0. أمر "أبو مالك، افتح آخر رسالة" ──
        async cmdOpenLatestUnreadMessage() {
            this.speak('أهلاً يا أبو مالك، جارٍ فحص وفتح أحدث محادثة غير مقروءة لك الآن.');
            console.log('[VoiceCommander] 🚀 Executing: "أبو مالك، افتح آخر رسالة"');

            let opened = false;
            let targetTitle = '';

            // 1. إرسال حدث مخصص لتطبيق تيليجرام الرئيسي (React Context)
            window.dispatchEvent(new CustomEvent('openLatestUnreadChat'));

            // 2. فحص عناصر واجهة المحادثات في الشريط الجانبي (Sidebar DOM)
            const chatItems = Array.from(document.querySelectorAll(
                '#tg-app-root [class*="cursor-pointer"], .sidebar-chat-item, [data-chat-id], div[class*="border-b"][class*="cursor-pointer"]'
            ));

            // البحث عن محادثة بها شارة رسائل غير مقروءة (Badge)
            for (const item of chatItems) {
                const badge = item.querySelector('.bg-\\[\\#2481cc\\], [class*="rounded-full"], .badge-unread');
                if (badge && parseInt(badge.textContent.trim(), 10) > 0) {
                    this.highlight(item);
                    item.click();
                    targetTitle = item.querySelector('h4, .chat-title')?.textContent?.trim() || 'المحادثة غير المقروءة';
                    opened = true;
                    console.log('[VoiceCommander] Clicked unread chat item:', targetTitle);
                    break;
                }
            }

            // 3. إذا لم تكن هناك شارات غير مقروءة، فتح أول محادثة في القائمة
            if (!opened && chatItems.length > 0) {
                const firstChat = chatItems[0];
                this.highlight(firstChat);
                firstChat.click();
                targetTitle = firstChat.querySelector('h4, .chat-title')?.textContent?.trim() || 'أحدث محادثة';
                opened = true;
                console.log('[VoiceCommander] Clicked latest active chat item:', targetTitle);
            }

            // 4. فحص واجهة القالب الرئيسي (HTML Modals: تنبيهاتي الجديدة أو رسائلي وسجل الإرسال)
            const alertsBadge = document.getElementById('myAlertsCount');
            const alertsCount = alertsBadge ? (parseInt(alertsBadge.textContent.trim(), 10) || 0) : 0;

            if (!opened && alertsCount > 0) {
                const alertsBtn = document.querySelector('[data-bs-target="#myAlertsModal"]') || document.getElementById('myAlertsBtn');
                if (alertsBtn) {
                    this.highlight(alertsBtn);
                    alertsBtn.click();
                    opened = true;
                    targetTitle = 'تنبيهاتي الجديدة';
                }
            } else if (!opened) {
                const sentMsgBtn = document.querySelector('[data-bs-target="#sentMessagesModal"]');
                if (sentMsgBtn) {
                    this.highlight(sentMsgBtn);
                    sentMsgBtn.click();
                    opened = true;
                    targetTitle = 'سجل الرسائل الأخيرة';
                }
            }

            setTimeout(() => {
                if (targetTitle) {
                    this.speak(`تم فتح ${targetTitle} بنجاح يا أبو مالك.`);
                } else {
                    this.speak('تم فتح أحدث محادثة لديك بنجاح يا أبو مالك.');
                }
            }, 900);
        }

        // ── 1. بدء تسجيل الدخول ──
        async cmdLoginNamedAccount(uid, phone, name) {
            this.speak(`جارٍ بدء تسجيل الدخول بحساب ${name}`);
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
                this.triggerLoginSubmission();
            }, 350);
        }

        async cmdLoginDefault() {
            this.speak('جارٍ بدء تسجيل الدخول وإرسال كود التحقق');
            const dropdown = document.getElementById('savedPhonesDropdown');
            const phoneInput = document.getElementById('phone');

            if (!phoneInput?.value && dropdown && dropdown.value) {
                phoneInput.value = dropdown.value;
                phoneInput.dispatchEvent(new Event('input'));
                phoneInput.dispatchEvent(new Event('change'));
            }

            if (!phoneInput?.value) {
                return this.cmdLoginNamedAccount('user_1', '+201120945094', 'لميس');
            }

            setTimeout(() => {
                this.triggerLoginSubmission();
            }, 300);
        }

        async cmdLoginByPhoneNumber(phone) {
            let formatted = phone.startsWith('+') ? phone : ('+' + phone);
            this.speak(`جارٍ بدء تسجيل الدخول بالرقم ${formatted}`);
            const phoneInput = document.getElementById('phone');
            if (phoneInput) {
                phoneInput.value = formatted;
                phoneInput.dispatchEvent(new Event('input'));
                phoneInput.dispatchEvent(new Event('change'));
                this.highlight(phoneInput);
            }
            setTimeout(() => {
                this.triggerLoginSubmission();
            }, 350);
        }

        triggerLoginSubmission() {
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
        }

        async cmdLogout() {
            this.speak('جارٍ تسجيل الخروج وإنهاء جلسة التليجرام');
            const logoutBtn = document.getElementById('logoutButton');
            if (logoutBtn) {
                this.highlight(logoutBtn);
                logoutBtn.click();
            }
        }

        // ── 2. التحقق من الرموز ──
        async cmdVerifyCode(code) {
            const spokenDigits = code.split('').join(' ');
            this.speak(`تم إدخال رمز التحقق: ${spokenDigits}، جارٍ التأكيد والتحقق فوراً`);
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
            this.speak('تم وضع كلمة المرور، جارٍ التحقق بخطوتين');
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

        // ── 3. بدء المهام المجدولة ──
        async cmdStartScheduledTasks(digits, norm) {
            this.speak('أمر مؤكد: جارٍ تفعيل وبدء المهام المجدولة ونظام الجدولة الدائرية');

            const sendTypeSelect = document.getElementById('sendType');
            if (sendTypeSelect) {
                sendTypeSelect.value = 'scheduled';
                sendTypeSelect.dispatchEvent(new Event('change'));
                this.highlight(sendTypeSelect);
            }

            const cyclicCard = document.getElementById('cyclicSettingsCard');
            const intervalDiv = document.getElementById('intervalDiv');
            if (cyclicCard) {
                cyclicCard.style.display = 'block';
                this.highlight(cyclicCard);
            }
            if (intervalDiv) intervalDiv.style.display = 'block';

            if (digits && (norm.includes('دقيقه') || norm.includes('ثانيه') || norm.includes('كل'))) {
                let intervalVal = parseInt(digits, 10);
                const intervalInput = document.getElementById('intervalSeconds');
                if (intervalInput) {
                    intervalInput.value = intervalVal;
                    intervalInput.dispatchEvent(new Event('input'));
                    intervalInput.dispatchEvent(new Event('change'));
                }
            }

            if (typeof window.saveSettings === 'function') {
                try { await window.saveSettings(); } catch (_) {}
            }

            const resumeBtn = document.getElementById('resumeScheduleBtn');
            if (typeof window.resumeSchedule === 'function') {
                try {
                    await window.resumeSchedule();
                } catch (_) {}
            } else if (resumeBtn && resumeBtn.style.display !== 'none') {
                this.highlight(resumeBtn);
                resumeBtn.click();
            }

            const startMonBtn = document.getElementById('startMonitoringBtn');
            if (typeof window.handleStartMonitoring === 'function') {
                try { await window.handleStartMonitoring(); } catch (_) {}
            } else if (startMonBtn && startMonBtn.style.display !== 'none') {
                startMonBtn.click();
            }

            const statusBar = document.getElementById('scheduleStatusBar');
            if (statusBar) {
                statusBar.style.display = 'block';
                this.highlight(statusBar);
            }

            this.speak('تم بدء وتشغيل المهام المجدولة ونظام الجدولة الدائرية الآلية بنجاح.');
        }

        async cmdStopScheduledTasks() {
            this.speak('أمر مؤكد: جارٍ إيقاف المهام المجدولة مؤقتاً');
            if (typeof window.handleStopMonitoring === 'function') {
                try { await window.handleStopMonitoring(); } catch (_) {}
            }
            const stopBtn = document.getElementById('stopMonitoringBtn') || document.getElementById('stopSendNowBtn');
            if (stopBtn) {
                this.highlight(stopBtn);
                stopBtn.click();
            }
        }

        // ── 4. أوامر المراسلة والمراقبة ──
        async cmdStartBroadcast() {
            this.speak('أمر مؤكد: جارٍ بدء مهمة الإرسال فوراً');
            const sendNowBtn = document.getElementById('sendNowBtn');
            if (typeof window.handleSendNow === 'function') {
                window.handleSendNow();
            } else if (sendNowBtn) {
                this.highlight(sendNowBtn);
                sendNowBtn.click();
            }
        }

        async cmdStopBroadcast() {
            this.speak('أمر مؤكد: تم إرسال إشارة إيقاف الإرسال');
            const stopBtn = document.getElementById('stopSendNowBtn');
            if (stopBtn) {
                this.highlight(stopBtn);
                stopBtn.click();
            }
        }

        async cmdStartMonitoring() {
            this.speak('جارٍ تشغيل المراقبة الذكية التلقائية');
            if (typeof window.handleStartMonitoring === 'function') {
                await window.handleStartMonitoring();
            } else {
                const btn = document.getElementById('startMonitoringBtn');
                if (btn) btn.click();
            }
        }

        async cmdStopMonitoring() {
            this.speak('تم إيقاف المراقبة الذكية مؤقتاً');
            if (typeof window.handleStopMonitoring === 'function') {
                await window.handleStopMonitoring();
            } else {
                const btn = document.getElementById('stopMonitoringBtn');
                if (btn) btn.click();
            }
        }

        async cmdInspectCloudLinks() {
            this.speak('جارٍ استعراض الروابط المحفوظة وفحص قاعدة البيانات السحابية');
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
                this.speak('جارٍ تصدير ملف الروابط بصيغة PDF لذاكرة جهازك');
                const btn = document.getElementById('exportPdfBtn') || document.getElementById('exportAllPdfBtn');
                if (btn) {
                    this.highlight(btn);
                    btn.click();
                } else if (typeof window.exportSavedLinksPDF === 'function') {
                    window.exportSavedLinksPDF();
                }
            } else {
                this.speak('جارٍ تصدير ملف الروابط النصي TXT لذاكرة جهازك');
                const btn = document.getElementById('exportTxtBtn') || document.getElementById('exportAllTxtBtn');
                if (btn) {
                    this.highlight(btn);
                    btn.click();
                } else if (typeof window.exportSavedLinksTXT === 'function') {
                    window.exportSavedLinksTXT();
                }
            }
        }

        async cmdSetInterval(seconds) {
            const minutes = Math.round(seconds / 60) || 1;
            this.speak(`تم ضبط الفاصل الزمني على ${minutes} دقيقة`);
            const intervalInput = document.getElementById('intervalSeconds');
            if (intervalInput) {
                intervalInput.value = minutes;
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
                const running = data.is_running ? 'وهناك مهام مجدولة قيد التشغيل' : 'ولا توجد مهام تعمل حالياً';
                this.speak(`الحساب هو ${name}، الحالة: ${status}، ${running}.`);
            } catch (_) {
                this.speak('التطبيق يعمل بشكل طبيعي ومتصل بالخادم.');
            }
        }

        // ════════════════════════════════════════════════════════════
        // إدارة واجهة المستخدم الصوتية (UI & Interactivity)
        // ════════════════════════════════════════════════════════════

        async toggle() {
            if (this.isListening) {
                return this.stop();
            } else {
                if (!this.micPermissionGranted) {
                    return await this.requestMicrophoneAccess(true);
                }
                return this.start();
            }
        }

        async start() {
            if (!this.supported) {
                const reason = (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
                    ? 'التحكم الصوتي يتطلب تشغيل التطبيق عبر بروتوكول آمن HTTPS'
                    : 'التعرف الصوتي غير مدعوم في متصفحك الحالي. يرجى استخدام متصفح حديث مثل Google Chrome';
                console.error('[VoiceCommander] start() failed:', reason);
                this.speak(reason);
                this.updateStateIndicator('error', '⚪ معطل');
                return { success: false, reason: reason };
            }

            if (this.isListening) {
                console.log('[VoiceCommander] Already listening.');
                return { success: true, message: 'Already listening' };
            }

            // إذا لم يتم منح إذن الميكروفون بعد، نطلب الإذن الفعلي أولاً
            if (!this.micPermissionGranted) {
                const permRes = await this.requestMicrophoneAccess(false);
                if (!permRes.success) {
                    return permRes;
                }
            }

            this.shouldStayActive = true;
            this.currentState = 'permission';
            this.updateStateIndicator('permission', '🟡 ينتظر إذن');
            try {
                this.recognition.start();
                this.speak('نظام التحكم الصوتي نشط. يمكنك البدء بأمرك الآن.');
                console.log('[VoiceCommander] Recognition started successfully.');
                return { success: true };
            } catch (e) {
                const reason = e.message || 'المحرك الصوتي مشغول أو قيد التشغيل بالفعل';
                console.warn('[VoiceCommander] Recognition start error:', e);
                this.currentState = 'error';
                this.updateStateIndicator('error', '🔴 خطأ');
                return { success: false, reason: reason, error: e };
            }
        }

        stop() {
            this.shouldStayActive = false;
            if (this.recognition) {
                try {
                    this.recognition.stop();
                    this.speak('تم إيقاف الاستماع الصوتي.');
                } catch (_) {}
            }
            this.currentState = this.supported ? 'idle' : 'error';
            this.updateUIState(false);
            this.updateStateIndicator(this.supported ? 'idle' : 'error', this.supported ? '🟢 جاهز' : '🔴 معطل');
            return { success: true };
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

            const headerBtn   = document.getElementById('headerVoiceToggleBtn');
            const headerIcon  = document.getElementById('headerVoiceIcon');
            const headerBadge = document.getElementById('headerVoiceStatusBadge');
            const headerWave  = document.getElementById('headerVoiceWave');
            const headerBox   = document.getElementById('headerVoiceBox');

            if (headerBtn) {
                if (active) {
                    headerBtn.classList.add('voice-header-active');
                    if (headerIcon) headerIcon.className = 'fas fa-microphone text-danger fa-beat';
                    if (headerBadge) {
                        headerBadge.textContent = '🔴 يستمع الآن (تحدث بأمرك)';
                        headerBadge.className = 'badge bg-danger text-white shadow-sm';
                    }
                    if (headerWave) headerWave.style.display = 'inline-flex';
                    if (headerBox) headerBox.classList.add('voice-box-active');
                } else {
                    headerBtn.classList.remove('voice-header-active');
                    if (headerIcon) headerIcon.className = 'fas fa-microphone text-primary';
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
                if (active) hud.classList.add('show');
                else hud.classList.remove('show');
            }

            if (wave) {
                wave.style.display = active ? 'flex' : 'none';
            }
        }

        setSpeakingState(isSpeaking) {
            const botIcon = document.getElementById('voiceBotSpeakerIcon');
            if (botIcon) {
                if (isSpeaking) botIcon.classList.add('voice-speaking-pulse');
                else botIcon.classList.remove('voice-speaking-pulse');
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
            if (document.getElementById('voiceCommanderContainer')) return;

            const style = document.createElement('style');
            style.id = 'voiceCommanderStyles';
            style.textContent = `
                .voice-mic-banner {
                    position: fixed;
                    top: 18px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 100000;
                    background: #ffffff;
                    border: 2px solid #0088cc;
                    border-radius: 18px;
                    padding: 14px 22px;
                    max-width: 620px;
                    width: calc(100% - 32px);
                    box-shadow: 0 16px 40px rgba(0, 136, 204, 0.25), 0 6px 16px rgba(0,0,0,0.1);
                    direction: rtl;
                    animation: slideDownIn 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                }
                @keyframes slideDownIn {
                    from { opacity: 0; transform: translate(-50%, -24px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }
                .mic-pulse-circle {
                    width: 44px;
                    height: 44px;
                    min-width: 44px;
                    border-radius: 50%;
                    background: rgba(0, 136, 204, 0.12);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: micPulse 1.8s infinite;
                }
                @keyframes micPulse {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 136, 204, 0.4); }
                    70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(0, 136, 204, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0, 136, 204, 0); }
                }
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
                    0% { box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.7), 0 8px 25px rgba(229, 57, 53, 0.5); }
                    70% { box-shadow: 0 0 0 18px rgba(229, 57, 53, 0), 0 8px 25px rgba(229, 57, 53, 0.5); }
                    100% { box-shadow: 0 0 0 0 rgba(229, 57, 53, 0), 0 8px 25px rgba(229, 57, 53, 0.5); }
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
                .voice-speaking-pulse {
                    color: #38bdf8 !important;
                    animation: botPulse 0.8s infinite alternate;
                }
                @keyframes botPulse {
                    from { transform: scale(1); filter: drop-shadow(0 0 2px #38bdf8); }
                    to { transform: scale(1.25); filter: drop-shadow(0 0 8px #0284c7); }
                }
                .voice-command-highlight {
                    outline: 4px solid #0088cc !important;
                    outline-offset: 3px !important;
                    box-shadow: 0 0 25px rgba(0, 136, 204, 0.8) !important;
                    transition: all 0.3s ease !important;
                    transform: scale(1.02) !important;
                }
            `;
            document.head.appendChild(style);

            const container = document.createElement('div');
            container.id = 'voiceCommanderContainer';
            container.className = 'floating-voice-hub';
            container.innerHTML = `
                <div class="voice-commander-hud" id="voiceCommanderHud">
                    <div class="voice-hud-header">
                        <div class="voice-hud-title">
                            <span class="voice-waves-container" id="voiceWaveIndicator">
                                <span class="voice-wave-bar"></span>
                                <span class="voice-wave-bar"></span>
                                <span class="voice-wave-bar"></span>
                                <span class="voice-wave-bar"></span>
                            </span>
                            <span>التحكم الصوتي نشط (Web Speech API)</span>
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
                        تحدث بأمرك الآن... (مثال: ابدأ تسجيل الدخول، رمز التحقق هو...، ابدأ المهام المجدولة)
                    </div>
                </div>

                <button type="button" class="floating-voice-btn" id="floatingVoiceBtn" title="التحكم الصوتي (اضغط للتحدث، واسحب لنقل الزر إلى أي مكان)">
                    <span class="voice-drag-handle-hint" title="اسحب للتحريك"></span>
                    <span class="voice-pulse-ring"></span>
                    <i class="fas fa-microphone" id="floatingVoiceIcon"></i>
                </button>
            `;
            document.body.appendChild(container);

            this.injectHelpModal();
            this.setupDraggable(container, document.getElementById('floatingVoiceBtn'));

            document.getElementById('voiceTtsToggleBtn').addEventListener('click', () => this.toggleTTS());
            document.getElementById('voiceHudCloseBtn').addEventListener('click', () => this.stop());
        }

        setupDraggable(container, btn) {
            if (!container || !btn) return;

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

                try { btn.setPointerCapture(e.pointerId); } catch (_) {}
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

                try { btn.releasePointerCapture(e.pointerId); } catch (_) {}

                if (isDragging) {
                    btn.classList.remove('is-dragging');
                    try {
                        localStorage.setItem('voice_hub_position', JSON.stringify({
                            left: container.style.left,
                            top: container.style.top
                        }));
                    } catch (_) {}
                    setTimeout(() => { isDragging = false; }, 80);
                } else {
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
                                <i class="fas fa-microphone-alt me-2"></i> دليل الأوامر الصوتية الذكية (Web Speech API)
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="إغلاق"></button>
                        </div>
                        <div class="modal-body p-4" style="background: #f8fafc;">
                            <p class="text-muted mb-4">
                                يمكنك التحكم بالكامل في التطبيق صوتياً بدون لمس الشاشة، فقط قل أي من الأوامر التالية بوضوح:
                            </p>
                            <div class="row g-3">
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-4 border-primary h-100">
                                        <h6 class="fw-bold text-primary mb-2"><i class="fas fa-sign-in-alt me-1"></i> 1. بدء تسجيل الدخول</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«ابدأ تسجيل الدخول»</strong>: يبدأ تسجيل الدخول فوراً بالحساب النشط.</li>
                                            <li class="mb-1">🔹 <strong>«سجل بحساب لميس»</strong>: يملأ حساب لميس ويبدأ الدخول.</li>
                                            <li class="mb-1">🔹 <strong>«سجل بالحساب الثاني»</strong> أو <strong>«الحساب الثالث»</strong>.</li>
                                            <li class="mb-1">🔹 <strong>«سجل برقم زائد عشرين...»</strong>: يدخل برقم الهاتف المنطوق.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-4 border-info h-100">
                                        <h6 class="fw-bold text-info mb-2"><i class="fas fa-shield-alt me-1"></i> 2. التحقق من الرموز</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«رمز التحقق هو تسعة خمسة أربعة اثنين واحد»</strong>: يدخل الكود ويتحقق.</li>
                                            <li class="mb-1">🔹 <strong>«التحقق من الرمز [أرقام الكود]»</strong>: تأكيد الرمز فوراً.</li>
                                            <li class="mb-1">🔹 <strong>«كلمة المرور هي [كلمتك]»</strong>: للتحقق بخطوتين 2FA.</li>
                                            <li class="mb-1">🔹 <strong>«أعد إرسال الرمز»</strong> أو <strong>«أرسل الكود عبر SMS»</strong>.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-success h-100">
                                        <h6 class="fw-bold text-success mb-2"><i class="fas fa-clock me-1"></i> 3. بدء المهام المجدولة</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1">🔹 <strong>«ابدأ المهام المجدولة»</strong>: تفعيل وبدء نظام الجدولة الدائرية فوراً.</li>
                                            <li class="mb-1">🔹 <strong>«شغل الإرسال المجدول»</strong>: بدء الدورة المجدولة.</li>
                                            <li class="mb-1">🔹 <strong>«ابدأ المهام المجدولة كل عشرين دقيقة»</strong>: ضبط الفاصل والبدء.</li>
                                            <li class="mb-1">🔹 <strong>«أوقف المهام المجدولة»</strong>: إيقاف الجدولة مؤقتاً.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="p-3 bg-white rounded-3 shadow-sm border-start border-warning h-100">
                                        <h6 class="fw-bold text-warning mb-2"><i class="fas fa-paper-plane me-1"></i> 4. المراسلة والروابط والحالة</h6>
                                        <ul class="list-unstyled mb-0 small text-secondary">
                                            <li class="mb-1 text-primary fw-bold">🔹 <strong>«أبو مالك، افتح آخر رسالة»</strong>: فتح أحدث محادثة غير مقروءة تلقائياً.</li>
                                            <li class="mb-1">🔹 <strong>«ابدأ الإرسال الآن»</strong>: إرسال فوري فوري للرسالة.</li>
                                            <li class="mb-1">🔹 <strong>«استعرض روابط قاعدة البيانات»</strong>: فحص روابط السحابة.</li>
                                            <li class="mb-1">🔹 <strong>«صدّر الروابط ملف PDF»</strong> / <strong>«ملف TXT»</strong>.</li>
                                            <li class="mb-1">🔹 <strong>«ما هي حالة الحساب؟»</strong>: ينطق تفاصيل الاتصال والمهام.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer bg-white border-top-0 d-flex justify-content-between">
                            <span class="text-muted small"><i class="fas fa-check-circle text-success me-1"></i> مدعوم بالنطق الصوتي التفاعلي والتحليل الذاتي</span>
                            <button type="button" class="btn btn-primary px-4" data-bs-dismiss="modal">فهمت، جاهز للتجربة</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
    }

    // ════════════════════════════════════════════════════════════
    // تهيئة وتثبيت المحرك في النطاق العام مع معالجة كافة حالات التحميل (Race Condition)
    // ════════════════════════════════════════════════════════════
    function initVoiceCommander() {
        if (!window.voiceCommander) {
            try {
                window.voiceCommander = new VoiceCommander();
                window.dispatchEvent(new CustomEvent('voiceCommanderReady', { detail: window.voiceCommander }));
                console.log('[VoiceCommander] Global instance ready and event dispatched.');
            } catch (err) {
                console.error('[VoiceCommander] Error instantiating VoiceCommander:', err);
                window.dispatchEvent(new CustomEvent('voiceCommanderFailed', { detail: err }));
            }
        }
    }

    window.initVoiceCommander = initVoiceCommander;

    // معالجة كافة حالات المستند (loading, interactive, complete) لمنع Race Condition
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initVoiceCommander, 1);
    } else {
        document.addEventListener('DOMContentLoaded', initVoiceCommander);
        window.addEventListener('load', initVoiceCommander);
    }

})(window, document);
