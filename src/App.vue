<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { marked } from 'marked';
import { 
  Send, 
  Plus, 
  MoreVertical, 
  Bot, 
  Trash2, 
  RefreshCw, 
  Copy, 
  Check, 
  Sparkles, 
  Paperclip, 
  FileText, 
  X, 
  Smile,
  AlertCircle
} from 'lucide-vue-next';

interface OptionItem {
  value: string;
  label: string;
}

// AgentResponse.catalogProgress — progreso de atributos obligatorios durante
// la fase de catalogación (src/agents/cataloging/nodes/catalog.py).
interface CatalogProgress {
  pending: string[];
  completed: Record<string, string>;
  total: number;
  completedCount: number;
}

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  time: string;
  isDraft?: boolean;
  draftContent?: string;
  isCustomResponse?: boolean;
  // Botones que ofrece el backend real (AgentResponse.options) para este
  // mensaje puntual — vacío/ausente significa "responder con texto libre".
  options?: OptionItem[];
  // Progreso de atributos obligatorios (AgentResponse.catalogProgress) para
  // este mensaje puntual — null/ausente fuera de la fase de catalogación.
  catalogProgress?: CatalogProgress | null;
  // Texto sugerido para el input (AgentResponse.placeholder) — indica qué se
  // espera que el usuario escriba en el turno siguiente (ej. "Ingresa el
  // diámetro"). null/ausente significa usar el placeholder genérico.
  placeholder?: string | null;
}

// Initial mockup conversation
const getInitialMessages = (): Message[] => [
  {
    id: 'msg-1',
    role: 'assistant',
    content: "¡Hola! Soy tu asistente de catalogación. ¿Qué deseas hacer hoy?\n * Catalogar un nuevo material\n * Consultar el estado de una solicitud\n * Buscar materiales similares ya catalogados\n\nEscribe tu opción o pregúntame si tienes dudas",
    time: '10:00 AM'
  }
];

// Identidad de la sesión de prueba: sale de variables de entorno (.env,
// gitignoreado) y NO se hardcodea acá, porque este repo es público y los
// valores reales son datos de usuarios (UUID, nombre, email, divisiones).
// Copiar .env.example a .env y completarlo. Ver README.
const sessionId = import.meta.env.VITE_SESSION_ID ?? "";

// Mismo userContext para todo "init" real (montaje inicial y restart) — no
// hay login en este harness de pruebas, solo se replica el comportamiento
// del chat real.
const userContext = {
  clientCode: import.meta.env.VITE_USER_CLIENT_CODE ?? "",
  userDivisionIds: import.meta.env.VITE_USER_DIVISION_IDS ?? "[]",
  divisionCode: import.meta.env.VITE_USER_DIVISION_CODE ?? "",
  divisionName: import.meta.env.VITE_USER_DIVISION_NAME ?? "",
  userName: import.meta.env.VITE_USER_NAME ?? "",
  userEmail: import.meta.env.VITE_USER_EMAIL ?? ""
};

// Aviso temprano y explícito: sin sessionId el backend no puede resolver el
// thread del checkpointer, así que mejor enterarse acá que ver fallar el
// /invoke sin motivo aparente.
if (!sessionId) {
  console.warn(
    "[harness] VITE_SESSION_ID está vacío: copiá .env.example a .env y completá los valores."
  );
}

// Reactive states
// El historial visual sale del backend (AgentResponse.history al reanudar
// un "init"), no de localStorage — así nunca queda desincronizado si el
// checkpoint se borró (finalizar/TTL): en ese caso el backend simplemente
// no manda historial, y acá arranca vacío otra vez.
const messages = ref<Message[]>([]);
const inputMessage = ref('');
const isTyping = ref(false);
const showMenu = ref(false);
const copiedId = ref<string | null>(null);
const chatScrollContainer = ref<HTMLDivElement | null>(null);
const showAttachmentModal = ref(false);
const attachedFile = ref<{ name: string; size: string; content: string } | null>(null);

// Preset file attachments
const presetAttachments = [
  { name: 'monthly_report.txt', size: '2.4 KB', content: 'Projected growth is 12% in Q3. Marketing spending has increased by $5000. Customer retention is at 94%.' },
  { name: 'meeting_minutes.txt', size: '1.8 KB', content: 'Participants: Alice, Bob, Charlie. Action items: Bob to update the design roadmap, Charlie to deploy authentication, Alice to organize the sync.' },
  { name: 'product_specs.txt', size: '3.1 KB', content: 'Database: Firestore. Frontend: Vue 3 with Tailwind CSS. Main features: Realtime collaboration, AI-powered message completions, dark mode support.' }
];

// Helper to get formatted current time
const getCurrentTime = () => {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minStr} ${ampm}`;
};

// Auto-scroll to bottom of chat
const scrollToBottom = async () => {
  await nextTick();
  if (chatScrollContainer.value) {
    chatScrollContainer.value.scrollTo({
      top: chatScrollContainer.value.scrollHeight,
      behavior: 'smooth'
    });
  }
};

// Monitor messages to scroll
watch(() => messages.value.length, () => {
  scrollToBottom();
}, { deep: true });

/**
 * Renderiza markdown (tablas, negritas, listas, links, etc.) a HTML.
 * Se aplica a mensajes del asistente.
 */
const renderContent = (text: string): string => {
  if (!text) return '';
  return marked.parse(text, { breaks: true, gfm: true }) as string;
};

const initSession = async () => {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId,
        type: "init",
        userContext
      })
    });
    if (!response.ok) throw new Error("Server error");

    const data = await response.json();
    // data.history son los turnos previos (checkpoint vivo = reanuda donde
    // quedó); vacío si el backend no tenía nada que reanudar (thread nuevo,
    // o borrado por finalizar/TTL) — en ese caso esto es solo el saludo.
    const history = (data.history ?? []).map((h: { role: 'user' | 'assistant'; text: string }) => ({
      id: `msg-${Date.now()}-${Math.random()}`,
      role: h.role,
      content: h.text,
      time: getCurrentTime()
    }));
    messages.value = [
      ...history,
      {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: data.text ?? '',
        time: getCurrentTime(),
        options: data.options,
        catalogProgress: data.catalogProgress,
        placeholder: data.placeholder
      }
    ];
  } catch (error) {
    console.error("Failed to init session", error);
    // Sin backend disponible: mostrar el mock de bienvenida en vez de dejar
    // la ventana del chat vacía.
    messages.value = getInitialMessages();
  }
};

onMounted(() => {
  initSession();
  scrollToBottom();
});

// Copy specific draft email content to clipboard
const copyDraftToClipboard = async (text: string, msgId: string) => {
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = msgId;
    setTimeout(() => {
      copiedId.value = null;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy text: ', err);
  }
};

// Clear chat history
const clearChat = () => {
  messages.value = [];
  showMenu.value = false;
  attachedFile.value = null;
};

// Reset chat history to mock baseline
const resetChat = () => {
  messages.value = getInitialMessages();
  showMenu.value = false;
  attachedFile.value = null;
  scrollToBottom();
};

// Simulate attachment selection
const handleAttachFile = (file: typeof presetAttachments[0]) => {
  attachedFile.value = file;
  showAttachmentModal.value = false;
  inputMessage.value = `Can you summarize the attached file: ${file.name}?`;
  scrollToBottom();
};

const removeAttachedFile = () => {
  attachedFile.value = null;
};

// Post message and get response from server
const sendMessage = async (customText?: string) => {
  const textToSend = customText !== undefined ? customText : inputMessage.value;
  if (!textToSend.trim() && !attachedFile.value) return;

  const currentText = textToSend;
  inputMessage.value = '';

  // Add user message
  messages.value.push({
    id: `msg-${Date.now()}`,
    role: 'user',
    content: currentText,
    time: getCurrentTime()
  });

  // Clear attached file if sent
  const attachedContext = attachedFile.value ? `\n\n[Attached File: ${attachedFile.value.name}]\n${attachedFile.value.content}` : '';
  attachedFile.value = null;

  isTyping.value = true;
  await scrollToBottom();

  try {
    // We send current chat history and current message to the server
    const apiHistory = messages.value.slice(0, -1).map(m => {
      // Re-create complete message content if there was a draft box
      const content = m.isDraft && m.draftContent 
        ? `${m.content}\n\n[Draft Email]:\n"${m.draftContent}"`
        : m.content;
      return { role: m.role, content };
    });

    const payloadMessage = currentText + attachedContext;

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId,
        //clientCode: userContext.clientCode,
        type: "text",
        message: payloadMessage
      })
    });

    if (!response.ok) {
      throw new Error("Server error");
    }

    const data = await response.json();
    
    // Parse response to check if it contains a drafted email
    // If it contains double quotes containing "Hi team" or has clear "Dear" / "Hi" / subject etc, we can highlight it.
    // Let's do a smart regex check to display draft emails in high-fidelity boxes!
    let contentText = data.text;
    let isDraft = false;
    let draftContent = "";
    let mainContent = contentText;

    // Search for quoted email-like patterns or markdown blockquotes
    const draftRegex = /(?:["']Hi team[^"']+["']|["']Subject:[^"']+["']|```[^`]+```)/i;
    const match = contentText.match(draftRegex);

    if (match) {
      isDraft = true;
      draftContent = match[0].replace(/^[ \t]*```[a-z]*\n?/im, '').replace(/```[ \t]*$/m, '').replace(/^"|"$/g, '').trim();
      mainContent = contentText.replace(match[0], '').trim();
      if (!mainContent) {
        mainContent = "Here is the revised draft email for your team:";
      }
    }

    messages.value.push({
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: mainContent,
      time: getCurrentTime(),
      isDraft,
      draftContent: draftContent || undefined,
      options: data.options,
      catalogProgress: data.catalogProgress,
      placeholder: data.placeholder
    });

  } catch (error) {
    console.error('API Error:', error);
    messages.value.push({
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: "No se pudo conectar con el backend. Verifica que esté corriendo en el puerto 8000 (uv run uvicorn src.main:app --port 8000).",
      time: getCurrentTime(),
      isCustomResponse: true
    });
  } finally {
    isTyping.value = false;
    await scrollToBottom();
  }
};

// Quick reply chip click handler. "restart" es un caso especial: el front
// real lo intercepta y manda type="init" (reseed completo de userContext)
// en vez de una selection normal — ver Chatbot-CLAUDE.md, hallazgo 8. Sin
// esto, el botón cae del lado del backend en fallback (a propósito: sin
// esta intercepción, el thread ya está borrado y una selection nunca trae
// userContext para reconstruirlo).
const handleQuickReply = async (label: string, value: string) => {
  messages.value.push({
    id: `msg-${Date.now()}`,
    role: 'user',
    content: label,
    time: getCurrentTime()
  });

  isTyping.value = true;
  await scrollToBottom();

  try {
    const body = value === "restart"
      ? { sessionId, type: "init", userContext }
      : { sessionId, type: "selection", selection: { value, label } };

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error("Server error");
    const data = await response.json();
    messages.value.push({
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: data.text ?? '',
      time: getCurrentTime(),
      options: data.options,
      catalogProgress: data.catalogProgress,
      placeholder: data.placeholder
    });
  } catch(e) {
    messages.value.push({
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: "Error al enviar selección.",
      time: getCurrentTime()
    });
  } finally {
    isTyping.value = false;
    await scrollToBottom();
  }
};

// Opciones dinámicas del último mensaje del asistente (options que manda el
// backend real: AgentResponse.options). Reemplaza el string-match hardcodeado
// contra el texto del mensaje mock inicial, que no reflejaba nada del backend.
const lastMessageOptions = computed<OptionItem[]>(() => {
  const lastMsg = messages.value[messages.value.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant') return [];
  return lastMsg.options?.length ? lastMsg.options : [];
});

// Progreso de atributos obligatorios del último mensaje del asistente
// (AgentResponse.catalogProgress) — solo existe durante la fase "catalog".
const lastMessageProgress = computed<CatalogProgress | null>(() => {
  const lastMsg = messages.value[messages.value.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant') return null;
  const progress = lastMsg.catalogProgress;
  return progress && progress.total > 0 ? progress : null;
});

const showCompletedAttrs = ref(true);
const showPendingAttrs = ref(true);

// Placeholder sugerido por el backend para el turno actual (AgentResponse.placeholder,
// ej. "Ingresa el diámetro" durante catalogación) — si no viene, se usa el genérico.
const DEFAULT_PLACEHOLDER = 'Escribe un mensaje al Asistente IA...';
const lastMessagePlaceholder = computed<string>(() => {
  const lastMsg = messages.value[messages.value.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant') return DEFAULT_PLACEHOLDER;
  return lastMsg.placeholder || DEFAULT_PLACEHOLDER;
});
</script>

<template>
  <main class="w-full h-screen bg-brand-surface flex flex-col relative overflow-hidden select-none">
    
    <!-- Top AppBar Component -->
    <header class="w-full z-50 bg-white/80 backdrop-blur-md shadow-xs flex justify-between items-center px-6 py-3 h-[64px] border-b border-gray-100 flex-shrink-0">
      <div class="flex items-center gap-3">
        <div class="relative w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
          <Bot class="text-gray-600 w-5 h-5" />
          <span class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"></span>
        </div>
        <div>
          <h1 class="text-base font-semibold text-brand-text flex items-center gap-1.5 leading-tight">
            AI Assistant
            <Sparkles class="w-4 h-4 text-gray-400 animate-pulse" />
          </h1>
          <p class="text-[11px] text-brand-text-muted flex items-center gap-1 font-medium">
            Online
          </p>
        </div>
      </div>

      <!-- Menu options -->
      <div class="relative">
        <button 
          @click="showMenu = !showMenu"
          aria-label="More options" 
          class="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >
          <MoreVertical class="w-5 h-5" />
        </button>

        <!-- Dropdown Menu -->
        <transition
          enter-active-class="transition duration-100 ease-out"
          enter-from-class="transform scale-95 opacity-0"
          enter-to-class="transform scale-100 opacity-100"
          leave-active-class="transition duration-75 ease-in"
          leave-from-class="transform scale-100 opacity-100"
          leave-to-class="transform scale-95 opacity-0"
        >
          <div 
            v-if="showMenu"
            class="absolute right-0 mt-2 w-48 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 z-50 overflow-hidden"
          >
            <button 
              @click="resetChat"
              class="w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 text-left"
            >
              <RefreshCw class="w-4 h-4 text-gray-400" />
              Restablecer Demo
            </button>
            <button 
              @click="clearChat"
              class="w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 text-left"
            >
              <Trash2 class="w-4 h-4" />
              Vaciar Historial
            </button>
          </div>
        </transition>
      </div>
    </header>

    <!-- Chat Canvas / Messages List -->
    <div 
      ref="chatScrollContainer"
      class="flex-1 w-full overflow-y-auto no-scrollbar pb-4 pt-4 flex justify-center"
    >
      <div class="w-full max-w-4xl px-4 flex flex-col gap-5">
        
        <!-- Date Divider -->
        <div class="flex justify-center my-1.5">
          <span class="text-xs font-medium text-brand-text-muted bg-white border border-gray-100 px-3 py-1 rounded-full shadow-2xs">
            Today
          </span>
        </div>

        <!-- Messages List with Transitions -->
        <div class="flex flex-col gap-5">
          <div 
            v-for="msg in messages" 
            :key="msg.id"
            :class="['flex flex-col max-w-[75%] transition-all duration-300', msg.role === 'user' ? 'items-end self-end' : 'items-start']"
          >
            <!-- Single message context -->
            <div class="flex items-end gap-2.5">
              <!-- Bot avatar on AI messages -->
              <div 
                v-if="msg.role === 'assistant'"
                class="w-7 h-7 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0 mb-1"
              >
                <Bot class="text-gray-600 w-4 h-4" />
              </div>

              <!-- Content bubble -->
              <div 
                :class="[
                  'p-4 rounded-2xl border text-[15px] leading-relaxed shadow-sm transition-all',
                  msg.role === 'user' 
                    ? 'bg-[#e9edff] text-brand-text border-[#dce2f7] rounded-br-xs' 
                    : 'bg-white text-brand-text border-gray-100 rounded-bl-xs'
                ]"
              >
                <div 
                  v-if="msg.role === 'assistant'" 
                  class="markdown-content" 
                  v-html="renderContent(msg.content)"
                ></div>
                <p v-else class="whitespace-pre-wrap">{{ msg.content }}</p>

                <!-- Draft Email Container Block -->
                <div 
                  v-if="msg.isDraft && msg.draftContent"
                  class="mt-3.5 bg-gray-50 border border-gray-200/60 rounded-xl p-4 text-[13.5px] font-sans text-brand-text-muted relative group overflow-hidden"
                >
                  <p class="whitespace-pre-wrap pr-10 font-normal leading-relaxed text-gray-700 italic">
                    "{{ msg.draftContent }}"
                  </p>
                  
                  <!-- Floating Copy Button with check feedback -->
                  <button 
                    @click="copyDraftToClipboard(msg.draftContent, msg.id)"
                    class="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:text-brand-text hover:bg-gray-50 shadow-2xs active:scale-95 transition-all"
                    title="Copiar borrador"
                  >
                    <Check v-if="copiedId === msg.id" class="w-4 h-4 text-emerald-500" />
                    <Copy v-else class="w-4 h-4" />
                  </button>
                  
                  <div class="mt-2.5 flex justify-between items-center text-[11px] text-gray-400">
                    <span>Email Borrador</span>
                    <span v-if="copiedId === msg.id" class="text-emerald-500 font-medium animate-pulse">¡Copiado!</span>
                  </div>
                </div>

                <!-- Simulation Info Alert -->
                <div 
                  v-if="msg.isCustomResponse"
                  class="mt-2 flex items-center gap-1 text-[11px] text-gray-400 font-medium"
                >
                  <AlertCircle class="w-3.5 h-3.5 text-amber-500" />
                  <span>Modo Simulación (Servidor Offline / Sin API Key)</span>
                </div>
              </div>
            </div>
            
            <!-- Timestamp indicator -->
            <span 
              :class="[
                'text-[11px] text-gray-400 font-medium mt-1',
                msg.role === 'user' ? 'mr-1' : 'ml-10'
              ]"
            >
              {{ msg.time }}
            </span>
          </div>

          <!-- Progreso de atributos obligatorios (AgentResponse.catalogProgress),
               visible mientras se está completando la ficha de catalogación. -->
          <div
            v-if="lastMessageProgress"
            class="ml-10 flex flex-col gap-3 bg-white border border-gray-100 rounded-2xl shadow-sm p-4"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-brand-text">Atributos obligatorios</span>
              <span class="text-xs font-medium text-brand-text-muted">
                {{ lastMessageProgress.completedCount }} / {{ lastMessageProgress.total }}
              </span>
            </div>

            <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                class="h-full bg-blue-500 rounded-full transition-all duration-300"
                :style="{ width: `${Math.min(100, (lastMessageProgress.completedCount / lastMessageProgress.total) * 100)}%` }"
              ></div>
            </div>

            <div class="flex gap-2">
              <button
                @click="showCompletedAttrs = !showCompletedAttrs"
                class="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100"
              >
                <Check class="w-3 h-3" />
                {{ Object.keys(lastMessageProgress.completed).length }} completados
                <span :class="['transition-transform', showCompletedAttrs ? 'rotate-180' : '']">▾</span>
              </button>
              <button
                @click="showPendingAttrs = !showPendingAttrs"
                class="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200"
              >
                {{ lastMessageProgress.pending.length }} pendientes
                <span :class="['transition-transform', showPendingAttrs ? 'rotate-180' : '']">▾</span>
              </button>
            </div>

            <div v-if="showCompletedAttrs" class="flex flex-col gap-1.5">
              <div
                v-for="(value, name) in lastMessageProgress.completed"
                :key="name"
                class="px-3 py-2 rounded-lg bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-700"
              >
                <span class="font-semibold">{{ name }}</span>: {{ value }}
              </div>
            </div>

            <div v-if="showPendingAttrs" class="flex flex-col gap-1.5">
              <div
                v-for="name in lastMessageProgress.pending"
                :key="name"
                class="px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-500"
              >
                {{ name }}
              </div>
            </div>
          </div>

          <!-- Opciones dinámicas: botones que manda el backend real en options,
               para el último mensaje del asistente (division, combos del wizard,
               menú principal, etc. — lo que sea que responda el turno actual) -->
          <div
            v-if="lastMessageOptions.length && !isTyping"
            class="flex gap-2 ml-10 flex-wrap py-1"
          >
            <button
              v-for="opt in lastMessageOptions"
              :key="opt.value"
              @click="handleQuickReply(opt.label, opt.value)"
              class="whitespace-nowrap px-4 py-2 rounded-full border border-gray-200 text-xs font-semibold text-brand-text-muted hover:bg-gray-50 hover:text-brand-text active:scale-95 transition-all bg-white shadow-2xs cursor-pointer"
            >
              {{ opt.label }}
            </button>
          </div>

          <!-- Typing / Thinking Indicator -->
          <div 
            v-if="isTyping"
            class="flex flex-col items-start gap-1 max-w-[70%] ml-10"
          >
            <div class="flex items-end gap-2.5">
              <div class="bg-white p-4 rounded-2xl rounded-bl-xs border border-gray-100 flex gap-1.5 items-center h-[46px] shadow-sm">
                <div class="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 0ms;"></div>
                <div class="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 150ms;"></div>
                <div class="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style="animation-delay: 300ms;"></div>
              </div>
            </div>
            <span class="text-[11px] text-gray-400 font-medium ml-1">Escribiendo...</span>
          </div>
        </div>

      </div>
    </div>

    <!-- Attachment Preset Selector Modal Overlay -->
    <transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 translate-y-4"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-4"
    >
      <div 
        v-if="showAttachmentModal"
        class="absolute bottom-28 left-4 right-4 md:left-auto md:right-auto md:w-[420px] bg-white border border-gray-100 rounded-2xl shadow-xl p-5 z-50 mx-auto"
      >
        <div class="flex justify-between items-center mb-3">
          <h3 class="text-sm font-semibold text-brand-text flex items-center gap-1.5">
            <Paperclip class="w-4 h-4 text-gray-500" />
            Adjuntar Archivo de Contexto
          </h3>
          <button 
            @click="showAttachmentModal = false"
            class="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
        <p class="text-xs text-brand-text-muted mb-4 leading-relaxed">
          Selecciona un archivo predefinido para alimentar el contexto del modelo de inteligencia artificial:
        </p>

        <div class="flex flex-col gap-2">
          <button 
            v-for="file in presetAttachments"
            :key="file.name"
            @click="handleAttachFile(file)"
            class="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-blue-100 hover:bg-blue-50/40 text-left transition-all active:scale-98"
          >
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center border border-gray-100">
                <FileText class="w-4 h-4 text-gray-500" />
              </div>
              <div>
                <p class="text-xs font-semibold text-brand-text">{{ file.name }}</p>
                <p class="text-[10px] text-gray-400">{{ file.size }}</p>
              </div>
            </div>
            <span class="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">Adjuntar</span>
          </button>
        </div>
      </div>
    </transition>

    <!-- Bottom Action Input Bar Panel -->
    <div class="w-full bg-white/95 backdrop-blur-xl border-t border-gray-100 px-4 py-4 flex justify-center z-40 shrink-0">
      <div class="w-full max-w-4xl flex flex-col gap-2">
        
        <!-- Attached file badge -->
        <div 
          v-if="attachedFile"
          class="flex items-center gap-2 self-start bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full text-xs text-blue-700 font-medium"
        >
          <FileText class="w-3.5 h-3.5" />
          <span>{{ attachedFile.name }} ({{ attachedFile.size }})</span>
          <button 
            @click="removeAttachedFile"
            class="p-0.5 rounded-full hover:bg-blue-100 text-blue-500 hover:text-blue-700 transition-colors"
          >
            <X class="w-3 h-3" />
          </button>
        </div>

        <div class="relative flex items-end gap-2 bg-gray-50 rounded-2xl border border-gray-200/80 focus-within:border-gray-300 focus-within:bg-white focus-within:shadow-sm transition-all duration-200 p-1.5">
          <!-- Add Attachment Trigger Button -->
          <button 
            @click="showAttachmentModal = !showAttachmentModal"
            aria-label="Attach file" 
            :class="[
              'w-10 h-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0',
              showAttachmentModal ? 'bg-gray-200 text-brand-text' : 'text-gray-500 hover:bg-gray-100 hover:text-brand-text'
            ]"
          >
            <Plus class="w-5 h-5" />
          </button>

          <!-- Main message input textarea -->
          <textarea 
            v-model="inputMessage"
            @keydown.enter.exact.prevent="sendMessage()"
            class="w-full bg-transparent border-none focus:outline-none focus:ring-0 resize-none text-[15px] py-2.5 px-2 max-h-[140px] text-brand-text placeholder:text-gray-400"
            :placeholder="lastMessagePlaceholder"
            rows="1"
            ref="inputArea"
          ></textarea>

          <!-- Submit arrow send button -->
          <button 
            @click="sendMessage()"
            aria-label="Send message" 
            :disabled="!inputMessage.trim() && !attachedFile"
            :class="[
              'w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 mb-[1px] mr-[1px]',
              (inputMessage.trim() || attachedFile)
                ? 'bg-brand-text text-white hover:bg-gray-800 active:scale-95 shadow-sm cursor-pointer'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            ]"
          >
            <Send class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

  </main>
</template>

<style scoped>
/* Scoped transitions & styling adjustments */
.shadow-2xs {
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
}

/* Markdown rendered inside bot bubbles */
:deep(p) {
  margin: 0 0 0.4em;
  line-height: 1.6;
}
:deep(p:last-child) {
  margin-bottom: 0;
}
:deep(strong) {
  font-weight: 600;
  color: #1e1e2e;
}
:deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
  font-size: 0.92em;
  border-radius: 8px;
  overflow: hidden;
}
:deep(thead tr) {
  background-color: #f0f2ff;
}
:deep(th) {
  padding: 8px 14px;
  text-align: left;
  font-weight: 600;
  color: #3a3a5c;
  border-bottom: 2px solid #dce2f7;
}
:deep(td) {
  padding: 7px 14px;
  border-bottom: 1px solid #eef0f8;
  color: #3a3a5c;
}
:deep(tbody tr:last-child td) {
  border-bottom: none;
}
:deep(tbody tr:hover) {
  background-color: #f7f8ff;
}
:deep(a) {
  color: #4361ee;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.15s;
}
:deep(a:hover) {
  color: #2940c8;
}
</style>