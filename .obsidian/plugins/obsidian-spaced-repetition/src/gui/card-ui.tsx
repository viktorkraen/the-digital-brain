import { now } from "moment";
import { App, Notice, Platform, setIcon } from "obsidian";

import { RepItemScheduleInfo } from "src/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { textInterval } from "src/algorithms/osr/note-scheduling";
import { Card } from "src/card";
import { CardListType, Deck } from "src/deck";
import {
    FlashcardReviewMode,
    IFlashcardReviewSequencer as IFlashcardReviewSequencer,
} from "src/flashcard-review-sequencer";
import { FlashcardMode } from "src/gui/sr-modal";
import { t } from "src/lang/helpers";
import type SRPlugin from "src/main";
import { Note } from "src/note";
import { CardType, Question } from "src/question";
import { SRSettings } from "src/settings";
import { RenderMarkdownWrapper } from "src/utils/renderers";

export class CardUI {
    public app: App;
    public plugin: SRPlugin;
    public contentEl: HTMLElement;
    public parentEl: HTMLElement;
    public mode: FlashcardMode;

    public view: HTMLDivElement;

    public header: HTMLDivElement;
    public titleWrapper: HTMLDivElement;
    public title: HTMLDivElement;
    public subTitle: HTMLDivElement;
    public backButton: HTMLDivElement;

    public controls: HTMLDivElement;
    public editButton: HTMLButtonElement;
    public resetButton: HTMLButtonElement;
    public infoButton: HTMLButtonElement;
    public skipButton: HTMLButtonElement;

    public content: HTMLDivElement;
    public context: HTMLElement;

    public response: HTMLDivElement;
    public hardButton: HTMLButtonElement;
    public goodButton: HTMLButtonElement;
    public answerButton: HTMLButtonElement;
    public lastPressed: number;

    private chosenDeck: Deck | null;
    private reviewSequencer: IFlashcardReviewSequencer;
    private settings: SRSettings;
    private reviewMode: FlashcardReviewMode;
    private backClickHandler: () => void;
    private editClickHandler: () => void;

    constructor(
        app: App,
        plugin: SRPlugin,
        settings: SRSettings,
        reviewSequencer: IFlashcardReviewSequencer,
        reviewMode: FlashcardReviewMode,
        contentEl: HTMLElement,
        parentEl: HTMLElement,
        backClickHandler: () => void,
        editClickHandler: () => void
    ) {
        // Init properties
        this.app = app;
        this.plugin = plugin;
        this.settings = settings;
        this.reviewSequencer = reviewSequencer;
        this.reviewMode = reviewMode;
        this.backClickHandler = backClickHandler;
        this.editClickHandler = editClickHandler;
        this.contentEl = contentEl;
        this.parentEl = parentEl;
        this.chosenDeck = null;

        // Build ui
        this.init();
    }

    /**
     * Initializes all static elements in the FlashcardView
     */
    init() {
        this._createBackButton();

        this.view = this.contentEl.createDiv();
        this.view.addClasses(["sr-flashcard", "sr-is-hidden"]);

        this.header = this.view.createDiv();
        this.header.addClass("sr-header");

        this.titleWrapper = this.header.createDiv();
        this.titleWrapper.addClass("sr-title-wrapper");

        this.title = this.titleWrapper.createDiv();
        this.title.addClass("sr-title");

        this.subTitle = this.titleWrapper.createDiv();
        this.subTitle.addClasses(["sr-sub-title", "sr-is-hidden"]);

        this.controls = this.header.createDiv();
        this.controls.addClass("sr-controls");

        this._createCardControls();

        if (this.settings.showContextInCards) {
            this.context = this.view.createDiv();
            this.context.addClass("sr-context");
        }

        this.content = this.view.createDiv();
        this.content.addClass("sr-content");

        this.response = this.view.createDiv();
        this.response.addClass("sr-response");

        this._createResponseButtons();
        this._addTTSStyles();
    }

    /**
     * Shows the FlashcardView if it is hidden
     */
    async show(chosenDeck: Deck) {
        if (!this.view.hasClass("sr-is-hidden")) {
            return;
        }
        this.chosenDeck = chosenDeck;

        await this._drawContent();

        // Prevents the following code, from running if this show is just a redraw and not an unhide
        this.view.removeClass("sr-is-hidden");
        this.backButton.removeClass("sr-is-hidden");
        document.addEventListener("keydown", this._keydownHandler);
    }

    /**
     * Refreshes all dynamic elements
     */
    async refresh() {
        await this._drawContent();
    }

    /**
     * Hides the FlashcardView if it is visible
     */
    hide() {
        // Prevents the following code, from running if this was executed multiple times after one another
        if (this.view.hasClass("sr-is-hidden")) {
            return;
        }

        document.removeEventListener("keydown", this._keydownHandler);
        this.view.addClass("sr-is-hidden");
        this.backButton.addClass("sr-is-hidden");
    }

    /**
     * Closes the FlashcardView
     */
    close() {
        this.hide();
        document.removeEventListener("keydown", this._keydownHandler);
    }

    // #region -> Functions & helpers

    private async _playAudioInContent(content: HTMLElement) {
        const audioElements = content.querySelectorAll('audio');
        for (const audio of audioElements) {
            try {
                await audio.play();
            } catch (error) {
                console.error('Error playing audio:', error);
            }
        }
    }

    private async _drawContent() {
        this.mode = FlashcardMode.Front;
        const currentDeck: Deck = this.reviewSequencer.currentDeck;

        // Setup title
        this._setTitle(this.chosenDeck);
        this._setSubTitle(this.chosenDeck, currentDeck);
        this.resetButton.disabled = true;

        // Setup context
        if (this.settings.showContextInCards) {
            this.context.setText(
                this._formatQuestionContextText(this._currentQuestion.questionContext),
            );
        }

        // Setup card content
        this.content.empty();
        const wrapper: RenderMarkdownWrapper = new RenderMarkdownWrapper(
            this.app,
            this.plugin,
            this._currentNote.filePath,
        );
        await wrapper.renderMarkdownWrapper(
            this._currentCard.front.trimStart(),
            this.content,
            this._currentQuestion.questionText.textDirection,
        );
        
        // Автоматично програємо аудіо на передній стороні картки
        await this._playAudioInContent(this.content);
        
        // Set scroll position back to top
        this.content.scrollTop = 0;

        // Setup response buttons
        this._resetResponseButtons();
    }

    private _keydownHandler = (e: KeyboardEvent) => {
        // Prevents any input, if the edit modal is open or if the view is not in focus
        if (
            document.activeElement.nodeName === "TEXTAREA" ||
            this.mode === FlashcardMode.Closed ||
            !this.plugin.getSRInFocusState()
        ) {
            return;
        }

        const consumeKeyEvent = () => {
            e.preventDefault();
            e.stopPropagation();
        };

        switch (e.code) {
            case "KeyS":
                this._skipCurrentCard();
                consumeKeyEvent();
                break;
            case "Space":
                if (this.mode === FlashcardMode.Front) {
                    this._showAnswer();
                    consumeKeyEvent();
                } else if (this.mode === FlashcardMode.Back) {
                    this._processReview(ReviewResponse.Good);
                    consumeKeyEvent();
                }
                break;
            case "Enter":
            case "NumpadEnter":
                if (this.mode !== FlashcardMode.Front) {
                    break;
                }
                this._showAnswer();
                consumeKeyEvent();
                break;
            case "Numpad1":
            case "Digit1":
                if (this.mode !== FlashcardMode.Back) {
                    break;
                }
                this._processReview(ReviewResponse.Hard);
                consumeKeyEvent();
                break;
            case "Numpad2":
            case "Digit2":
                if (this.mode !== FlashcardMode.Back) {
                    break;
                }
                this._processReview(ReviewResponse.Good);
                consumeKeyEvent();
                break;
            case "Numpad3":
            case "Digit3":
                if (this.mode !== FlashcardMode.Back) {
                    break;
                }
                this._processReview(ReviewResponse.Easy);
                consumeKeyEvent();
                break;
            case "Numpad0":
            case "Digit0":
                if (this.mode !== FlashcardMode.Back) {
                    break;
                }
                this._processReview(ReviewResponse.Reset);
                consumeKeyEvent();
                break;
            default:
                break;
        }
    };

    private _displayCurrentCardInfoNotice() {
        const schedule = this._currentCard.scheduleInfo;

        const currentEaseStr = t("CURRENT_EASE_HELP_TEXT") + (schedule?.latestEase ?? t("NEW"));
        const currentIntervalStr =
            t("CURRENT_INTERVAL_HELP_TEXT") + textInterval(schedule?.interval, false);
        const generatedFromStr = t("CARD_GENERATED_FROM", {
            notePath: this._currentQuestion.note.filePath,
        });

        new Notice(currentEaseStr + "\n" + currentIntervalStr + "\n" + generatedFromStr);
    }

    private get _currentCard(): Card {
        return this.reviewSequencer.currentCard;
    }

    private get _currentQuestion(): Question {
        return this.reviewSequencer.currentQuestion;
    }

    private get _currentNote(): Note {
        return this.reviewSequencer.currentNote;
    }

    private async _showAnswer() {
        const timeNow = now();
        if (
            this.lastPressed &&
            timeNow - this.lastPressed < this.plugin.data.settings.reviewButtonDelay
        ) {
            return;
        }
        this.lastPressed = timeNow;

        this.mode = FlashcardMode.Back;
        this.resetButton.disabled = false;

        try {
            if (this._currentQuestion.questionType !== CardType.Cloze) {
                const hr = document.createElement("hr");
                hr.addClass("sr-card-divide");
                this.content.appendChild(hr);
            } else {
                this.content.empty();
            }

            const wrapper = new RenderMarkdownWrapper(
                this.app,
                this.plugin,
                this._currentNote.filePath,
            );
            await wrapper.renderMarkdownWrapper(
                this._currentCard.back.trimStart(),
                this.content,
                this._currentQuestion.questionText.textDirection,
            );
            await this._playAudioInContent(this.content);

            this.answerButton.addClass("sr-is-hidden");
            this.hardButton.removeClass("sr-is-hidden");

            if (this.reviewMode === FlashcardReviewMode.Cram) {
                this.response.addClass("is-cram");
                this.hardButton.setText(`${this.settings.flashcardHardText}`);
            } else {
                this.goodButton.removeClass("sr-is-hidden");
                this._setupEaseButton(
                    this.hardButton,
                    this.settings.flashcardHardText,
                    ReviewResponse.Hard,
                );
                this._setupEaseButton(
                    this.goodButton,
                    this.settings.flashcardGoodText,
                    ReviewResponse.Good,
                );
            }
        } catch (error) {
            console.error('CardUI: Error showing answer:', error);
            // Make sure buttons are shown even if there's an error
            this.answerButton.addClass("sr-is-hidden");
            this.hardButton.removeClass("sr-is-hidden");
            if (this.reviewMode !== FlashcardReviewMode.Cram) {
                this.goodButton.removeClass("sr-is-hidden");
            }
        }
    }

    private async _processReview(response: ReviewResponse): Promise<void> {
        const timeNow = now();
        if (
            this.lastPressed &&
            timeNow - this.lastPressed < this.plugin.data.settings.reviewButtonDelay
        ) {
            return;
        }
        this.lastPressed = timeNow;

        await this.reviewSequencer.processReview(response);
        await this._handleSkipCard();
    }

    private async _skipCurrentCard(): Promise<void> {
        this.reviewSequencer.skipCurrentCard();
        await this._handleSkipCard();
    }

    private async _handleSkipCard(): Promise<void> {
        if (this._currentCard != null) await this.refresh();
        else this.backClickHandler();
    }

    private _formatQuestionContextText(questionContext: string[]): string {
        const separator: string = " > ";
        let result = this._currentNote.file.basename;
        questionContext.forEach((context) => {
            // Check for links trim [[ ]]
            if (context.startsWith("[[") && context.endsWith("]]")) {
                context = context.replace("[[", "").replace("]]", "");
                // Use replacement text if any
                if (context.contains("|")) {
                    context = context.split("|")[1];
                }
            }
            result += separator + context;
        });
        return result;
    }

    // -> Header

    private _createBackButton() {
        this.backButton = this.parentEl.createDiv();
        this.backButton.addClasses(["sr-back-button", "sr-is-hidden"]);
        setIcon(this.backButton, "arrow-left");
        this.backButton.setAttribute("aria-label", t("BACK"));
        this.backButton.addEventListener("click", () => {
            this.backClickHandler();
        });
    }

    private _setTitle(deck: Deck) {
        let text = deck.deckName;

        const deckStats = this.reviewSequencer.getDeckStats(deck.getTopicPath());
        const cardsInQueue = deckStats.dueCount + deckStats.newCount;
        text += `: ${cardsInQueue}`;

        this.title.setText(text);
    }

    private _setSubTitle(chosenDeck: Deck, currentDeck: Deck) {
        if (chosenDeck.subdecks.length === 0) {
            if (!this.subTitle.hasClass("sr-is-hidden")) {
                this.subTitle.addClass("sr-is-hidden");
            }
            return;
        }

        if (this.subTitle.hasClass("sr-is-hidden")) {
            this.subTitle.removeClass("sr-is-hidden");
        }

        let text = `${currentDeck.deckName}`;

        const isRandomMode = this.settings.flashcardCardOrder === "EveryCardRandomDeckAndCard";
        if (!isRandomMode) {
            const subDecksWithCardsInQueue = chosenDeck.subdecks.filter((subDeck) => {
                const deckStats = this.reviewSequencer.getDeckStats(subDeck.getTopicPath());
                return deckStats.dueCount + deckStats.newCount > 0;
            });

            text = `${t("DECKS")}: ${subDecksWithCardsInQueue.length} | ${text}`;
            text += `: ${currentDeck.getCardCount(CardListType.All, false)}`;
        }

        this.subTitle.setText(text);
    }

    // -> Controls

    private _createCardControls() {
        this._createEditButton();
        this._createResetButton();
        this._createCardInfoButton();
        this._createSkipButton();
    }

    private _createEditButton() {
        this.editButton = this.controls.createEl("button");
        this.editButton.addClasses(["sr-button", "sr-edit-button"]);
        setIcon(this.editButton, "edit");
        this.editButton.setAttribute("aria-label", t("EDIT_CARD"));
        this.editButton.addEventListener("click", async () => {
            this.editClickHandler();
        });
    }

    private _createResetButton() {
        this.resetButton = this.controls.createEl("button");
        this.resetButton.addClasses(["sr-button", "sr-reset-button"]);
        setIcon(this.resetButton, "refresh-cw");
        this.resetButton.setAttribute("aria-label", t("RESET_CARD_PROGRESS"));
        this.resetButton.addEventListener("click", () => {
            this._processReview(ReviewResponse.Reset);
        });
    }

    private _createCardInfoButton() {
        this.infoButton = this.controls.createEl("button");
        this.infoButton.addClasses(["sr-button", "sr-info-button"]);
        setIcon(this.infoButton, "info");
        this.infoButton.setAttribute("aria-label", "View Card Info");
        this.infoButton.addEventListener("click", async () => {
            this._displayCurrentCardInfoNotice();
        });
    }

    private _createSkipButton() {
        this.skipButton = this.controls.createEl("button");
        this.skipButton.addClasses(["sr-button", "sr-skip-button"]);
        setIcon(this.skipButton, "chevrons-right");
        this.skipButton.setAttribute("aria-label", t("SKIP"));
        this.skipButton.addEventListener("click", () => {
            this._skipCurrentCard();
        });
    }

    // -> Response

    private _createResponseButtons() {
        this._createShowAnswerButton();
        this._createHardButton();
        this._createGoodButton();
    }

    private _resetResponseButtons() {
        this.answerButton.removeClass("sr-is-hidden");
        this.hardButton.addClass("sr-is-hidden");
        this.goodButton.addClass("sr-is-hidden");
    }

    private _createShowAnswerButton() {
        this.answerButton = this.response.createEl("button");
        this.answerButton.addClasses(["sr-response-button", "sr-show-answer-button", "sr-bg-blue"]);
        this.answerButton.setText(t("SHOW_ANSWER"));
        this.answerButton.addEventListener("click", () => {
            this._showAnswer();
        });
    }

    private _createHardButton() {
        this.hardButton = this.response.createEl("button");
        this.hardButton.addClasses([
            "sr-response-button",
            "sr-hard-button",
            "sr-bg-red",
            "sr-is-hidden",
        ]);
        this.hardButton.setText(this.settings.flashcardHardText);
        this.hardButton.addEventListener("click", () => {
            this._processReview(ReviewResponse.Hard);
        });
    }

    private _createGoodButton() {
        this.goodButton = this.response.createEl("button");
        this.goodButton.addClasses([
            "sr-response-button",
            "sr-good-button",
            "sr-bg-blue",
            "sr-is-hidden",
        ]);
        this.goodButton.setText(this.settings.flashcardGoodText);
        this.goodButton.addEventListener("click", () => {
            this._processReview(ReviewResponse.Good);
        });
    }

    private _setupEaseButton(button: HTMLElement, buttonName: string, reviewResponse: ReviewResponse) {
        if (reviewResponse === ReviewResponse.Hard) {
            button.setText(`${buttonName} - Again`);
            return;
        }

        const schedule = this.reviewSequencer.determineCardSchedule(reviewResponse, this._currentCard);
        if (!schedule) {
            button.setText(buttonName);
            return;
        }

        const interval = schedule.interval;
        button.setText(`${buttonName} - ${interval}d`);
    }

    // Add CSS styles
    private _addTTSStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .sr-tts-button {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
                padding: 4px 8px;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                margin-left: 8px;
            }
            .sr-tts-button:hover {
                background: var(--interactive-accent-hover);
            }
        `;
        document.head.appendChild(style);
    }
}
