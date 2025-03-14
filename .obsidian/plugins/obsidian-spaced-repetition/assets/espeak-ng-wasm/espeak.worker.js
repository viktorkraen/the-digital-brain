// eSpeak WebAssembly worker
let instance = null;

self.onmessage = async function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            try {
                const { wasmBinary } = data;
                const result = await WebAssembly.instantiate(wasmBinary);
                instance = result.instance;
                self.postMessage({ type: 'initialized' });
            } catch (error) {
                self.postMessage({ type: 'error', error: error.message });
            }
            break;

        case 'speak':
            if (!instance) {
                self.postMessage({ type: 'error', error: 'eSpeak not initialized' });
                return;
            }

            try {
                const { text, options } = data;
                instance.exports.speak(text, options);
                self.postMessage({ type: 'speaking' });
            } catch (error) {
                self.postMessage({ type: 'error', error: error.message });
            }
            break;

        case 'stop':
            if (instance) {
                instance.exports.stop();
                self.postMessage({ type: 'stopped' });
            }
            break;
    }
}; 