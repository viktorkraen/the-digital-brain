import { PaneType, TFile, WorkspaceLeaf } from "obsidian";

import { SR_TAB_VIEW } from "src/constants";
import { OsrAppCore } from "src/core";
import { Deck } from "src/deck";
import { FlashcardReviewMode } from "src/flashcard-review-sequencer";
import { SRTabView } from "src/gui/sr-tab-view";
import SRPlugin from "src/main";
import { TabViewType } from "src/utils/types";

/**
 * Manages tab views for the Spaced Repetition plugin, allowing for the opening and closing
 * of tabbed views within the application. Handles the registration of different tab view types
 * and facilitates the creation of new tab views based on the specified review mode and optional
 * single note. Ensures that tab views are properly initialized and revealed within the workspace.
 *
 * @property {SRPlugin} plugin - The main plugin instance.
 *
 * @method openSRTabView - Opens a new tab view for the specified review mode and optional single note.
 * @method closeAllTabViews - Closes all tab views.
 */
export default class TabViewManager {
    private plugin: SRPlugin;
    private osrAppCore: OsrAppCore;
    private shouldOpenSingeNoteTabView: boolean;
    private chosenReviewModeForTabbedView: FlashcardReviewMode;
    private chosenSingleNoteForTabbedView: TFile;

    // Додаємо нові типи вкладок сюди, і вони автоматично реєструються
    private tabViewTypes: TabViewType[] = [
        {
            type: SR_TAB_VIEW,
            viewCreator: (leaf) =>
                new SRTabView(leaf, this.plugin, async () => {
                    // Вкладки не можуть отримати параметри при відкритті, тому робимо це тут
                    // Це дозволяє завантажити дані зсередини виду, коли викликається функція відкриття
                    if (this.shouldOpenSingeNoteTabView) {
                        // Отримуємо дані для огляду однієї нотатки
                        const singleNoteDeckData =
                            await this.plugin.getPreparedDecksForSingleNoteReview(
                                this.chosenSingleNoteForTabbedView,
                                this.chosenReviewModeForTabbedView,
                            );

                        // Повертаємо підготовлений послідовник огляду
                        return this.plugin.getPreparedReviewSequencer(
                            singleNoteDeckData.deckTree,
                            singleNoteDeckData.remainingDeckTree,
                            singleNoteDeckData.mode,
                        );
                    }

                    // Отримуємо повне дерево колод для огляду
                    const fullDeckTree: Deck = this.osrAppCore.reviewableDeckTree;
                    // Визначаємо залишкове дерево колод в залежності від режиму огляду
                    const remainingDeckTree: Deck =
                        this.chosenReviewModeForTabbedView === FlashcardReviewMode.Cram
                            ? this.osrAppCore.reviewableDeckTree
                            : this.osrAppCore.remainingDeckTree;

                    // Повертаємо підготовлений послідовник огляду
                    return this.plugin.getPreparedReviewSequencer(
                        fullDeckTree,
                        remainingDeckTree,
                        this.chosenReviewModeForTabbedView,
                    );
                }),
        },
    ];

    // Add any needed resourced
    constructor(plugin: SRPlugin) {
        this.plugin = plugin;
        this.shouldOpenSingeNoteTabView = false;

        this.registerAllTabViews();
    }

    /**
     * Opens the Spaced Repetition tab view in the application.
     *
     * This method sets up the necessary state for the tab view and invokes the
     * internal method to open the tab view with the specified parameters.
     *
     * @param osrAppCore - The core application instance used for managing reviewable decks.
     * @param reviewMode - The mode of flashcard review.
     * @param singleNote - Optional parameter specifying a single note to review.
     *                     If provided, the tab view will focus on this note.
     *
     * @returns {Promise<void>} - A promise that resolves when the tab view is opened.
     */
    public async openSRTabView(
        osrAppCore: OsrAppCore,
        reviewMode: FlashcardReviewMode,
        singleNote?: TFile,
    ) {
        this.osrAppCore = osrAppCore;
        this.chosenReviewModeForTabbedView = reviewMode;
        this.shouldOpenSingeNoteTabView = singleNote !== undefined;
        if (singleNote) this.chosenSingleNoteForTabbedView = singleNote;

        await this.openTabView(SR_TAB_VIEW, true);
    }

    /**
     * Закриває всі відкриті вкладки в додатку.
     *
     * Цей метод перебирає всі зареєстровані типи вкладок і від'єднує
     * їх відповідні листи від робочого простору, ефективно закриваючи їх.
     */
    public closeAllTabViews() {
        this.forEachTabViewType((viewType) => {
            // Закриває всі вклади по типу viewType.type та звертається
            // в списку до кожного viewType який в ньому є і до його атрибуту
            // type і викликає метод detachLeavesOfType
            this.plugin.app.workspace.detachLeavesOfType(viewType.type);
        });
    }

    /**
     * Викликає колбек для кожного типу вкладки в списку.
     *
     * @param callback - Функція, яка буде викликана для кожного типу вкладки.
     */
    public forEachTabViewType(callback: (type: TabViewType) => void) {
        this.tabViewTypes.forEach((type) => callback(type));
    }

    /**
     * Зареєструвати всі види вкладок.
     *
     * Цей метод перебирає всі зареєстровані типи вкладок і викликає
     * метод registerView для кожного з них, щоб зареєструвати їх у додатку.
     */
    public registerAllTabViews() {
        this.forEachTabViewType((viewType) =>
            this.plugin.registerView(viewType.type, viewType.viewCreator),
        );
    }

    public async openTabView(type: string, newLeaf?: PaneType | boolean) {
        const { workspace } = this.plugin.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(type);

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf as a tab
            leaf = workspace.getLeaf(newLeaf);
            if (leaf !== null) {
                await leaf.setViewState({ type: type, active: true });
            }
        }

        // "Reveal" the leaf in case it is in a collapsed sidebar
        if (leaf !== null) {
            workspace.revealLeaf(leaf);
        }
    }
}
