import { ISrsAlgorithm } from "src/algorithms/base/isrs-algorithm";
import { RepItemScheduleInfo } from "src/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/algorithms/base/repetition-item";
import { Card } from "src/card";
import { TICKS_PER_DAY } from "src/constants";
import { DataStore } from "src/data-stores/base/data-store";
import { CardListType, Deck, DeckTreeFilter } from "src/deck";
import { IDeckTreeIterator } from "src/deck-tree-iterator";
import { DueDateHistogram } from "src/due-date-histogram";
import { Note } from "src/note";
import { Question, QuestionText } from "src/question";
import { IQuestionPostponementList } from "src/question-postponement-list";
import { SRSettings } from "src/settings";
import { TopicPath } from "src/topic-path";
import { globalDateProvider } from "src/utils/dates";
import { Moment } from "moment";
import type SRPlugin from "src/main";

export interface IFlashcardReviewSequencer {
    get hasCurrentCard(): boolean;
    get currentCard(): Card;
    get currentQuestion(): Question;
    get currentNote(): Note;
    get currentDeck(): Deck;
    get originalDeckTree(): Deck;

    setDeckTree(originalDeckTree: Deck, remainingDeckTree: Deck): void;
    setCurrentDeck(topicPath: TopicPath): void;
    getDeckStats(topicPath: TopicPath): DeckStats;
    skipCurrentCard(): void;
    determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo;
    processReview(response: ReviewResponse): Promise<void>;
    updateCurrentQuestionText(text: string): Promise<void>;
    reloadCardsForDate(date: Moment): Promise<void>;
}

export class DeckStats {
    dueCount: number;
    newCount: number;
    totalCount: number;

    constructor(dueCount: number, newCount: number, totalCount: number) {
        this.dueCount = dueCount;
        this.newCount = newCount;
        this.totalCount = totalCount;
    }
}

export enum FlashcardReviewMode {
    Cram,
    Review,
}

export class FlashcardReviewSequencer implements IFlashcardReviewSequencer {
    // We need the original deck tree so that we can still provide the total cards in each deck
    private _originalDeckTree: Deck;

    // This is set by the caller, and must have the same deck hierarchy as originalDeckTree.
    private remainingDeckTree: Deck;

    private reviewMode: FlashcardReviewMode;
    private cardSequencer: IDeckTreeIterator;
    private settings: SRSettings;
    private srsAlgorithm: ISrsAlgorithm;
    private questionPostponementList: IQuestionPostponementList;
    private dueDateFlashcardHistogram: DueDateHistogram;
    private plugin: SRPlugin;

    constructor(
        reviewMode: FlashcardReviewMode,
        cardSequencer: IDeckTreeIterator,
        settings: SRSettings,
        srsAlgorithm: ISrsAlgorithm,
        questionPostponementList: IQuestionPostponementList,
        dueDateFlashcardHistogram: DueDateHistogram,
        plugin: SRPlugin,
    ) {
        this.reviewMode = reviewMode;
        this.cardSequencer = cardSequencer;
        this.settings = settings;
        this.srsAlgorithm = srsAlgorithm;
        this.questionPostponementList = questionPostponementList;
        this.dueDateFlashcardHistogram = dueDateFlashcardHistogram;
        this.plugin = plugin;
    }

    get hasCurrentCard(): boolean {
        return this.cardSequencer.currentCard != null;
    }

    get currentCard(): Card {
        return this.cardSequencer.currentCard;
    }

    get currentQuestion(): Question {
        return this.currentCard?.question;
    }

    get currentDeck(): Deck {
        return this.cardSequencer.currentDeck;
    }

    get currentNote(): Note {
        return this.currentQuestion.note;
    }

    // originalDeckTree isn't modified by the review process
    // Only remainingDeckTree
    setDeckTree(originalDeckTree: Deck, remainingDeckTree: Deck): void {
        this.cardSequencer.setBaseDeck(remainingDeckTree);
        this._originalDeckTree = originalDeckTree;
        this.remainingDeckTree = remainingDeckTree;
        this.setCurrentDeck(TopicPath.emptyPath);
    }

    setCurrentDeck(topicPath: TopicPath): void {
        this.cardSequencer.setIteratorTopicPath(topicPath);
        this.cardSequencer.nextCard();
    }

    get originalDeckTree(): Deck {
        return this._originalDeckTree;
    }

    getDeckStats(topicPath: TopicPath): DeckStats {
        const totalCount: number = this._originalDeckTree
            .getDeck(topicPath)
            .getDistinctCardCount(CardListType.All, true);
        const remainingDeck: Deck = this.remainingDeckTree.getDeck(topicPath);
        const newCount: number = remainingDeck.getDistinctCardCount(CardListType.NewCard, true);
        const dueCount: number = remainingDeck.getDistinctCardCount(CardListType.DueCard, true);
        return new DeckStats(dueCount, newCount, totalCount);
    }

    skipCurrentCard(): void {
        this.cardSequencer.deleteCurrentQuestionFromAllDecks();
    }

    private deleteCurrentCard(): void {
        this.cardSequencer.deleteCurrentCardFromAllDecks();
    }

    async processReview(response: ReviewResponse): Promise<void> {
        switch (this.reviewMode) {
            case FlashcardReviewMode.Review:
                await this.processReviewReviewMode(response);
                break;

            case FlashcardReviewMode.Cram:
                await this.processReviewCramMode(response);
                break;
        }
    }

    async processReviewReviewMode(response: ReviewResponse): Promise<void> {
        // Оновлюємо розклад для всіх випадків, крім Reset на новій картці
        if (!(response === ReviewResponse.Reset && !this.currentCard.hasSchedule)) {
            const oldSchedule = this.currentCard.scheduleInfo;
            const newSchedule = this.determineCardSchedule(response, this.currentCard);
            
            this.currentCard.scheduleInfo = newSchedule;

            // Update the source file with the updated schedule
            await DataStore.getInstance().questionWriteSchedule(this.currentQuestion);

            if (oldSchedule) {
                const today: number = globalDateProvider.today.valueOf();
                const nDays: number = Math.ceil(
                    (oldSchedule.dueDateAsUnix - today) / TICKS_PER_DAY,
                );

                this.dueDateFlashcardHistogram.decrement(nDays);
            }
            this.dueDateFlashcardHistogram.increment(this.currentCard.scheduleInfo.interval);
        }

        // Move/delete the card
        if (response == ReviewResponse.Reset || (response == ReviewResponse.Hard && !this.currentCard.hasSchedule)) {
            this.cardSequencer.moveCurrentCardToEndOfList();
            this.cardSequencer.nextCard();
        } else {
            if (this.settings.burySiblingCards) {
                await this.burySiblingCards();
                this.cardSequencer.deleteCurrentQuestionFromAllDecks();
            } else {
                this.deleteCurrentCard();
            }
        }
    }

    private async burySiblingCards(): Promise<void> {
        // We check if there are any sibling cards still in the deck,
        // We do this because otherwise we would be adding every reviewed card to the postponement list, even for a
        // question with a single card. That isn't consistent with the 1.10.1 behavior
        const remaining = this.currentDeck.getQuestionCardCount(this.currentQuestion);
        if (remaining > 1) {
            this.questionPostponementList.add(this.currentQuestion);
            await this.questionPostponementList.write();
        }
    }

    async processReviewCramMode(response: ReviewResponse): Promise<void> {
        if (response == ReviewResponse.Easy) this.deleteCurrentCard();
        else {
            this.cardSequencer.moveCurrentCardToEndOfList();
            this.cardSequencer.nextCard();
        }
    }

    determineCardSchedule(response: ReviewResponse, card: Card): RepItemScheduleInfo {
        let result: RepItemScheduleInfo;

        if (response == ReviewResponse.Reset) {
            // Resetting the card schedule
            result = this.srsAlgorithm.cardGetResetSchedule();
        } else {
            // scheduled card
            if (card.hasSchedule) {
                result = this.srsAlgorithm.cardCalcUpdatedSchedule(
                    response,
                    card.scheduleInfo,
                    this.dueDateFlashcardHistogram,
                );
            } else {
                const currentNote: Note = card.question.note;
                result = this.srsAlgorithm.cardGetNewSchedule(
                    response,
                    currentNote.filePath,
                    this.dueDateFlashcardHistogram,
                );
            }
        }
        return result;
    }

    async updateCurrentQuestionText(text: string): Promise<void> {
        const q: QuestionText = this.currentQuestion.questionText;

        q.actualQuestion = text;

        await DataStore.getInstance().questionWrite(this.currentQuestion);
    }

    async reloadCardsForDate(date: Moment): Promise<void> {
        // Зберігаємо поточну колоду
        const currentDeckPath = this.currentDeck?.getTopicPath() || TopicPath.emptyPath;
        
        // Клонуємо дерева колод
        const originalDeckTree = this._originalDeckTree.clone();
        const remainingDeckTree = DeckTreeFilter.filterForRemainingCards(
            this.questionPostponementList,
            originalDeckTree,
            this.reviewMode
        );
        
        // Оновлюємо дерево
        this.setDeckTree(originalDeckTree, remainingDeckTree);
        
        // Відновлюємо поточну колоду
        if (currentDeckPath) {
            this.setCurrentDeck(currentDeckPath);
        }
    }
}
