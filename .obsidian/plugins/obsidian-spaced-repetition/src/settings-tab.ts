import { App, PluginSettingTab, Setting } from "obsidian";

import type SRPlugin from "src/main";
import { t } from "src/lang/helpers";

export class SRSettingTab extends PluginSettingTab {
    private plugin: SRPlugin;

    constructor(app: App, plugin: SRPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ... existing code ...
        // Remove TTS section
        // this.createTTSSection(containerEl);
        // ... existing code ...
    }
} 