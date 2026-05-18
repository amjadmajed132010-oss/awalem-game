// ════════════════════════════════════════════════════════════════════════════
// إصلاحات شاملة لمشاكل المزامنة والرسائل والمحادثات الخاصة
// ════════════════════════════════════════════════════════════════════════════

// 1. نظام المزامنة المحسّن بدون تأخير
class FastSyncSystem {
  constructor() {
    this.messageQueue = [];
    this.isOnline = navigator.onLine;
    this.lastSyncTime = Date.now();
    this.syncInterval = 100; // 100ms بدلاً من 2000ms
  }

  init() {
    // الاستماع لتغييرات الاتصال
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processPendingMessages();
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });

    // فحص الاتصال بشكل مستمر
    setInterval(() => this.checkConnection(), this.syncInterval);
  }

  checkConnection() {
    if (!this.isOnline) return;
    
    // إرسال الرسائل المعلقة فوراً
    if (this.messageQueue.length > 0) {
      this.processPendingMessages();
    }
  }

  queueMessage(message) {
    this.messageQueue.push({
      ...message,
      queuedAt: Date.now(),
      retries: 0
    });
  }

  processPendingMessages() {
    const toProcess = [...this.messageQueue];
    this.messageQueue = [];

    toProcess.forEach(msg => {
      if (msg.retries < 3) {
        this.sendMessage(msg);
      }
    });
  }

  sendMessage(message) {
    if (typeof firebase === 'undefined') return;
    
    const db = firebase.database();
    const ref = message.type === 'private' 
      ? db.ref('pm/' + message.path)
      : db.ref('chats/' + window.roomNetwork.roomId);

    ref.push(message.data)
      .then(() => {
        console.log('✅ تم إرسال الرسالة فوراً');
      })
      .catch(err => {
        message.retries++;
        if (message.retries < 3) {
          this.messageQueue.push(message);
          setTimeout(() => this.processPendingMessages(), 500);
        }
      });
  }
}

// 2. نظام رفع الصور المحسّن
class ImprovedMediaUploader {
  constructor() {
    this.uploadQueue = [];
    this.isUploading = false;
  }

  async uploadImage(file) {
    if (file.size > 10 * 1024 * 1024) {
      alert('الملف كبير جداً (الحد الأقصى 10MB)');
      return null;
    }

    try {
      // محاولة ImgBB أولاً
      const url = await this.uploadToImgBB(file);
      if (url) return url;

      // محاولة Cloudinary كبديل
      const cloudinaryUrl = await this.uploadToCloudinary(file);
      if (cloudinaryUrl) return cloudinaryUrl;

      // استخدام Data URL كآخر خيار
      return await this.fileToDataURL(file);
    } catch (error) {
      console.error('خطأ في رفع الصورة:', error);
      return null;
    }
  }

  async uploadToImgBB(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(',')[1];
          const fd = new FormData();
          fd.append('key', '933134e0a90844fdd51478fe2660dc6f');
          fd.append('image', base64);
          fd.append('name', 'awalem_' + Date.now());

          const res = await fetch('https://api.imgbb.com/1/upload', {
            method: 'POST',
            body: fd,
            timeout: 10000
          });

          if (!res.ok) throw new Error('ImgBB error');
          
          const data = await res.json();
          if (data.success) {
            resolve(data.data.url);
          } else {
            resolve(null);
          }
        } catch (err) {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async uploadToCloudinary(file) {
    const cloudName = window.CLOUDINARY_CLOUD || '';
    const preset = window.CLOUDINARY_PRESET || '';

    if (!cloudName || !preset) return null;

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', preset);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: fd, timeout: 15000 }
      );

      if (!res.ok) throw new Error('Cloudinary error');
      
      const data = await res.json();
      return data.secure_url || null;
    } catch (error) {
      return null;
    }
  }

  async fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

// 3. نظام المحادثات الخاصة (مثل واتساب)
class WhatsAppStyleChat {
  constructor() {
    this.currentChat = null;
    this.chatHistory = {};
    this.listeners = {};
  }

  openPrivateChat(userId, userName) {
    this.currentChat = { userId, userName };
    this.loadChatHistory(userId);
    this.setupRealtimeListener(userId);
    this.showChatPanel();
  }

  loadChatHistory(userId) {
    if (typeof firebase === 'undefined') return;

    const myUid = window.roomNetwork?.userId || '';
    if (!myUid) return;

    const pmPath = 'pm/' + [myUid, userId].sort().join('_');
    
    firebase.database().ref(pmPath)
      .orderByChild('ts')
      .limitToLast(50)
      .once('value', snap => {
        const messages = [];
        snap.forEach(child => {
          messages.push(child.val());
        });
        this.displayMessages(messages);
      });
  }

  setupRealtimeListener(userId) {
    if (typeof firebase === 'undefined') return;

    const myUid = window.roomNetwork?.userId || '';
    if (!myUid) return;

    const pmPath = 'pm/' + [myUid, userId].sort().join('_');
    const listenFrom = Date.now();

    // إيقاف المستمع السابق
    if (this.listeners[userId]) {
      this.listeners[userId].off();
    }

    // إنشاء مستمع جديد
    this.listeners[userId] = firebase.database()
      .ref(pmPath)
      .orderByChild('ts')
      .startAt(listenFrom)
      .on('child_added', snap => {
        const msg = snap.val();
        if (!msg) return;

        // تجاهل رسائلنا (تُضاف محلياً)
        if (msg.sender === myUid) return;

        this.addMessageToPanel(msg, false);
      });
  }

  sendPrivateMessage(text) {
    if (!this.currentChat || !text.trim()) return;

    const myUid = window.roomNetwork?.userId || '';
    if (!myUid) return;

    const pmPath = 'pm/' + [myUid, this.currentChat.userId].sort().join('_');
    const message = {
      sender: myUid,
      text: text.trim(),
      ts: Date.now(),
      name: window.myProfile?.name || 'أنت'
    };

    // إضافة محلياً فوراً
    this.addMessageToPanel(message, true);

    // إرسال إلى Firebase
    if (typeof firebase !== 'undefined') {
      firebase.database().ref(pmPath).push(message)
        .catch(err => console.error('خطأ في إرسال الرسالة:', err));
    }
  }

  addMessageToPanel(message, isMe) {
    const panel = document.getElementById('privateChatPanel');
    if (!panel) return;

    const messagesContainer = panel.querySelector('.private-messages');
    if (!messagesContainer) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'private-message ' + (isMe ? 'mine' : 'theirs');
    msgDiv.innerHTML = `
      <div class="pm-bubble">
        <div class="pm-text">${this.escapeHtml(message.text)}</div>
        <div class="pm-time">${this.formatTime(message.ts)}</div>
      </div>
    `;

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  displayMessages(messages) {
    const panel = document.getElementById('privateChatPanel');
    if (!panel) return;

    const messagesContainer = panel.querySelector('.private-messages');
    if (!messagesContainer) return;

    messagesContainer.innerHTML = '';
    const myUid = window.roomNetwork?.userId || '';

    messages.forEach(msg => {
      const isMe = msg.sender === myUid;
      this.addMessageToPanel(msg, isMe);
    });
  }

  showChatPanel() {
    let panel = document.getElementById('privateChatPanel');
    if (!panel) {
      panel = this.createChatPanel();
      document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
  }

  createChatPanel() {
    const panel = document.createElement('div');
    panel.id = 'privateChatPanel';
    panel.className = 'whatsapp-style-chat';
    panel.innerHTML = `
      <div class="pm-header">
        <div class="pm-back" onclick="window.whatsappChat.closeChat()">‹</div>
        <div class="pm-info">
          <div class="pm-name" id="pmChatName">—</div>
          <div class="pm-status">متصل</div>
        </div>
        <div class="pm-menu">⋮</div>
      </div>
      <div class="private-messages"></div>
      <div class="pm-input-area">
        <input type="text" class="pm-input" id="pmInput" placeholder="اكتب رسالة..." />
        <button class="pm-send" onclick="window.whatsappChat.sendMessage()">➤</button>
      </div>
    `;

    // تحديث اسم المحادثة
    const nameEl = panel.querySelector('#pmChatName');
    if (this.currentChat) {
      nameEl.textContent = this.currentChat.userName;
    }

    // معالج الإرسال
    const input = panel.querySelector('#pmInput');
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });

    return panel;
  }

  sendMessage() {
    const input = document.getElementById('pmInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    this.sendPrivateMessage(text);
    input.value = '';
    input.focus();
  }

  closeChat() {
    const panel = document.getElementById('privateChatPanel');
    if (panel) {
      panel.style.display = 'none';
    }
    this.currentChat = null;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatTime(ts) {
    const date = new Date(ts);
    return String(date.getHours()).padStart(2, '0') + ':' + 
           String(date.getMinutes()).padStart(2, '0');
  }
}

// 4. تهيئة الأنظمة
let fastSync = null;
let mediaUploader = null;
let whatsappChat = null;

function initializeEnhancements() {
  // تهيئة نظام المزامنة السريع
  fastSync = new FastSyncSystem();
  fastSync.init();

  // تهيئة نظام رفع الوسائط
  mediaUploader = new ImprovedMediaUploader();

  // تهيئة نظام المحادثات الخاصة
  whatsappChat = new WhatsAppStyleChat();
  window.whatsappChat = whatsappChat;

  console.log('✅ تم تهيئة جميع الأنظمة المحسّنة');
}

// 5. تحسين دالة sendMsg الأصلية
const originalSendMsg = window.sendMsg;
window.sendMsg = function() {
  const inp = document.getElementById('chatI');
  const txt = inp.value.trim();
  if (!txt) return;

  inp.value = '';
  const myName = window.myProfile?.name || 'أنت';
  const myBg = 'linear-gradient(135deg,#7c3aff,#5b21b6)';

  // إضافة الرسالة محلياً فوراً
  if (window.chat) {
    window.chat('أ', txt, myBg, myName);
  }

  // إرسال عبر نظام المزامنة السريع
  if (fastSync && window.roomNetwork?.roomId) {
    fastSync.queueMessage({
      type: 'chat',
      path: window.roomNetwork.roomId,
      data: {
        name: myName,
        text: txt,
        bg: myBg,
        senderUid: window.roomNetwork.userId || '',
        ts: Date.now()
      }
    });
  }
};

// 6. تحسين دالة handleMedia
const originalHandleMedia = window.handleMedia;
window.handleMedia = async function(input) {
  const file = input.files[0];
  if (!file) return;

  input.value = '';

  if (file.size > 10 * 1024 * 1024) {
    alert('❌ الملف كبير — الحد الأقصى 10MB');
    return;
  }

  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    alert('❌ نوع الملف غير مدعوم');
    return;
  }

  alert('⏳ جاري رفع الملف...');

  try {
    let url;
    if (file.type.startsWith('image/')) {
      url = await mediaUploader.uploadImage(file);
    } else {
      url = await mediaUploader.uploadImage(file);
    }

    if (!url) {
      alert('❌ فشل رفع الملف');
      return;
    }

    let mediaHTML = '';
    if (file.type.startsWith('image/')) {
      mediaHTML = `<img src="${url}" style="max-width:200px;max-height:180px;border-radius:10px;margin-top:5px;display:block;cursor:pointer" onclick="window.open('${url}','_blank')">`;
    } else {
      mediaHTML = `<video src="${url}" controls style="max-width:200px;border-radius:10px;margin-top:5px;display:block"></video>`;
    }

    const myBg = window.myProfile?.bg || 'linear-gradient(135deg,#7c3aff,#5b21b6)';
    const name = window.myProfile?.name || 'أنت';

    if (window.chat) {
      window.chat('أ', '📎', myBg, name, '<br>' + mediaHTML);
    }

    // إرسال عبر نظام المزامنة السريع
    if (fastSync && window.roomNetwork?.roomId) {
      fastSync.queueMessage({
        type: 'chat',
        path: window.roomNetwork.roomId,
        data: {
          name: name,
          text: '📎 وسائط',
          bg: myBg,
          mediaHTML: '<br>' + mediaHTML,
          senderUid: window.roomNetwork.userId || '',
          ts: Date.now()
        }
      });
    }

    alert('✅ تم الإرسال');
  } catch (error) {
    console.error('خطأ في رفع الملف:', error);
    alert('❌ خطأ في رفع الملف');
  }
};

// 7. إضافة معالج النقر على الأعضاء للمحادثة الخاصة
window.openPrivateChatFromMember = function(userId, userName) {
  if (whatsappChat) {
    whatsappChat.openPrivateChat(userId, userName);
  }
};

// تهيئة عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', initializeEnhancements);
