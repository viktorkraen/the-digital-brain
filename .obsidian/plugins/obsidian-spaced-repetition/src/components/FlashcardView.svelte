<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { SRSettings } from 'src/settings';

// ... existing props ...
export let settings: SRSettings;

onMount(() => {
    // Remove TTS initialization
    // ttsService = new TTSService(settings);
    // Check flashcard tags for TTS language code
    if (card?.question?.topicPathList) {
        for (const tag of card.question.topicPathList.list) {
            const langCode = TTSService.extractLanguageCode(tag.path);
            if (langCode) {
                // ttsLangCode = langCode;
                break;
            }
        }
    }
});

onDestroy(() => {
    // Remove TTS cleanup
    // if (ttsService) {
    //     ttsService.stop();
    // }
});

// Remove TTS methods and references
// async function playTTS() {
//     if (ttsService && ttsLangCode && card?.back) {
//         await ttsService.speak(card.back, ttsLangCode);
//     }
// }

// ... existing code ...
</script>

<!-- ... existing template ... -->
{#if showBack}
    <div class="back">
        {@html card.back}
        {#if ttsLangCode}
            <button 
                class="tts-button" 
                on:click={playTTS}
                title="Play TTS ({settings.ttsLanguages[ttsLangCode]})"
            >
                🔊
            </button>
        {/if}
    </div>
{/if}
<!-- ... existing code ... -->

<style>
/* ... existing styles ... */

.tts-button {
    position: absolute;
    bottom: 10px;
    right: 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.5em;
    opacity: 0.7;
    transition: opacity 0.2s;
}

.tts-button:hover {
    opacity: 1;
}
</style> 