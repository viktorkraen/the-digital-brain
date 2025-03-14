// eSpeak WebAssembly wrapper
(function() {
    let instance = null;
    let memory = null;
    let voices = {};

    window.eSpeakWASM = {
        async init() {
            const response = await fetch('espeak.wasm');
            const wasmBinary = await response.arrayBuffer();
            const result = await WebAssembly.instantiate(wasmBinary);
            instance = result.instance;
            memory = instance.exports.memory;
            return true;
        },

        async loadVoice(lang) {
            if (!voices[lang]) {
                const response = await fetch(`voices/${lang}.json`);
                voices[lang] = await response.json();
            }
            return true;
        },

        async speak(text, options = {}) {
            if (!instance) throw new Error('eSpeak not initialized');

            const { rate = 175, pitch = 50, volume = 1.0 } = options;

            // Копіюємо текст у пам'ять WASM
            const encoder = new TextEncoder();
            const bytes = encoder.encode(text);
            const ptr = instance.exports.__heap_base;
            const buffer = new Uint8Array(memory.buffer, ptr, bytes.length);
            buffer.set(bytes);

            // Викликаємо функцію speak
            instance.exports.speak(ptr, bytes.length);
        },

        stop() {
            if (instance) {
                instance.exports.stop();
            }
        },

        isLoading() {
            return false;
        }
    };
})(); 